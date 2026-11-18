// Free-text title search with graded confidence. Ported from
// jobhunt/search_service.py::title_search, tier for tier.

import { ratio } from './difflib.js'
import { containsPhrase } from './prefilter.js'

export type MatchMode = 'all' | 'exact' | 'fuzzy' | 'related' | 'none'

export interface Searchable {
  title: string
  description: string
}

const Q_ALIASES: Record<string, string[]> = {
  sde: ['software development engineer', 'sde'],
  sre: ['site reliability engineer', 'sre'],
}

const TOKEN_ALIASES: Record<string, string[]> = {
  developer: ['developer', 'engineer'],
  engineer: ['engineer', 'developer'],
  engg: ['engineer', 'developer', 'engg'],
  eng: ['engineer', 'developer', 'eng'],
  engr: ['engineer', 'developer', 'engr'],
  aiml: ['aiml', 'ai ml', 'ai/ml', 'artificial intelligence', 'machine learning', 'ml', 'ai'],
  ml: ['ml', 'machine learning'],
  ai: ['ai', 'artificial intelligence'],
  sr: ['sr', 'senior'],
  golang: ['golang', 'go'],
  js: ['js', 'javascript'],
  nodejs: ['nodejs', 'node js', 'node'],
  k8s: ['k8s', 'kubernetes'],
  postgres: ['postgres', 'postgresql'],
}

const FUZZY_ALIASES: Record<string, string[]> = {
  ...TOKEN_ALIASES,
  sde: ['sde', 'software development engineer', 'software engineer'],
  sre: ['sre', 'site reliability engineer'],
}

const ROLE_TOKENS = new Set([
  'developer', 'engineer', 'engg', 'eng', 'engr', 'sde', 'sre', 'sr', 'analyst', 'architect',
  'scientist', 'designer', 'manager', 'consultant', 'specialist', 'intern',
])

// A one-word query ("python") only counts as an exact title hit when it is
// directly followed by a role word, optionally with one word in between.
const ALLOWED_SUFFIXES = [
  'analyst', 'architect', 'developer', 'devops', 'engineer', 'engineeringspecialist',
  'programmer', 'scientist', 'specialist', 'sre',
]

const FUZZY_TOKEN_MIN = 0.8 // per-word similarity that counts as "same word"
const FUZZY_WHOLE_MIN = 0.75 // whole-query similarity against the whole title

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const aliasesOf = (table: Record<string, string[]>, tok: string): string[] => table[tok] ?? [tok]

function hayContains(hay: string, term: string): boolean {
  const t = term.toLowerCase().trim()
  if (t.includes(' ')) return hay.includes(t)
  return new RegExp(`\\b${esc(t)}\\b`).test(hay)
}

function countOccurrences(hay: string, needle: string): number {
  if (!needle) return 0
  let n = 0
  for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + needle.length)) n++
  return n
}

/**
 * Rank jobs against a free-text title query. The mode tells the caller how
 * confident the match is:
 *
 *   all      no query, nothing filtered
 *   exact    strict title match
 *   fuzzy    title matched with typo tolerance or on most query words
 *   related  nothing close; same role family, or query found in the JD
 *   none     nothing at all
 *
 * Each tier only runs when the one above found nothing, so a precise query
 * never gets diluted with loose matches.
 */
export function titleSearch<T extends Searchable>(jobs: T[], title: string): { jobs: T[]; mode: MatchMode } {
  if (!title || !title.trim()) return { jobs, mode: 'all' }
  const qNorm = norm(title)
  const tokens = qNorm.split(' ').filter(Boolean)
  if (tokens.length === 0) return { jobs, mode: 'all' }

  const alias = Q_ALIASES[qNorm]
  if (alias) {
    const hits = jobs.filter((j) => alias.some((a) => containsPhrase(j.title, a)))
    if (hits.length > 0) return { jobs: hits, mode: 'exact' }
  }

  const roleTokenIndices = tokens.map((t, i) => (ROLE_TOKENS.has(t) ? i : -1)).filter((i) => i >= 0)
  const expandedTokens = tokens.map((t) => aliasesOf(TOKEN_ALIASES, t))
  // Role synonyms stay title-only. Otherwise a description that mentions
  // "Python developer" would make every unrelated engineer role match.
  const descriptionTokens = tokens.map((t) => (ROLE_TOKENS.has(t) ? [t] : aliasesOf(TOKEN_ALIASES, t)))
  const wholeWord = new RegExp(`\\b${esc(qNorm)}\\b`)
  const oneWordRole = new RegExp(`\\b${esc(qNorm)}\\b\\s+(?:[a-z0-9]+\\s+)?(?:${ALLOWED_SUFFIXES.join('|')})\\b`)

  const scoreTitle = (j: T): number => {
    const tlNorm = norm(j.title)
    const hayNorm = norm(`${j.title} ${j.description || ''}`)

    if (tlNorm.includes(qNorm)) {
      if (qNorm === tlNorm) return 1
      if (tokens.length === 1) return oneWordRole.test(tlNorm) ? 1 : 0
      return wholeWord.test(tlNorm) ? 1 : 0
    }
    if (hayNorm.includes(qNorm) && roleTokenIndices.length === 0) return 0.98

    // Strong role match: every query word is in the title, allowing synonyms.
    if (expandedTokens.every((alts) => alts.some((a) => hayContains(tlNorm, a)))) return 0.9

    // Weaker: every word is somewhere in title + JD, and the role word itself
    // is in the title.
    const descHits = descriptionTokens.every((alts) => alts.some((a) => hayContains(hayNorm, a)))
    const roleHits = roleTokenIndices.every((i) => expandedTokens[i]!.some((a) => hayContains(tlNorm, a)))
    return descHits && roleHits ? 0.8 : 0
  }

  // ---- Tier 1: strict title match ----------------------------------------
  const exact: { s: number; j: T }[] = []
  for (const j of jobs) {
    const s = scoreTitle(j)
    if (s >= 0.85) exact.push({ s, j })
  }
  if (exact.length > 0) {
    exact.sort((a, b) => b.s - a.s)
    return { jobs: exact.map((x) => x.j), mode: 'exact' }
  }

  // ---- Tier 2: fuzzy title match -----------------------------------------
  // Tolerates typos ("enginer") and partial queries ("backend python engineer"
  // -> "Backend Engineer"). Still title-only, so a JD that merely mentions the
  // query cannot pull in an unrelated role.
  const canonicalRole = (tok: string): string | null => {
    if (ROLE_TOKENS.has(tok)) return tok
    if (tok.length >= 4) {
      for (const r of ROLE_TOKENS) {
        if (r.length >= 4 && ratio(tok, r) >= FUZZY_TOKEN_MIN) return r
      }
    }
    return null
  }
  const fTokens = tokens.map((t) => canonicalRole(t) ?? t)
  const fRoleIndices = fTokens.map((t, i) => (ROLE_TOKENS.has(t) ? i : -1)).filter((i) => i >= 0)
  const fRoleSet = new Set(fRoleIndices)

  const tokenScore = (tok: string, tlNorm: string, tlTokens: string[]): number => {
    let best = 0
    for (const a of aliasesOf(FUZZY_ALIASES, tok)) {
      if (a.includes(' ')) {
        if (` ${tlNorm} `.includes(` ${a} `)) return 1
        continue
      }
      for (const t of tlTokens) {
        if (t === a) return 1
        // Short words ("go", "ai", "c") are too easy to confuse; only fuzz
        // words long enough for a typo to be unambiguous.
        if (a.length >= 4 && t.length >= 4) best = Math.max(best, ratio(a, t))
      }
    }
    return best >= FUZZY_TOKEN_MIN ? best : 0
  }

  const nonRoleCount = fTokens.length - fRoleIndices.length
  const fuzzy: { s: number; j: T }[] = []
  const related: { s: number; j: T }[] = []
  for (const j of jobs) {
    const tlNorm = norm(j.title)
    const tlTokens = tlNorm.split(' ')
    const scores = fTokens.map((t) => tokenScore(t, tlNorm, tlTokens))
    const whole = ratio(qNorm, tlNorm)
    const matched = scores.filter((s) => s > 0).length
    const rolesOk = fRoleIndices.every((i) => scores[i]! > 0)
    const nonRoleHits = scores.filter((s, i) => s > 0 && !fRoleSet.has(i)).length
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length
    const nonRoleOk = nonRoleCount === 0 || nonRoleHits >= 1

    // Whole-string similarity alone is not enough: a shared role word
    // ("engineer") inflates it, so "react engineer" would match "Capacity
    // Engineer". At least one non-role query word must also be in the title.
    if (whole >= FUZZY_WHOLE_MIN && nonRoleOk) {
      fuzzy.push({ s: Math.max(whole, mean), j })
    } else if (rolesOk && nonRoleOk && matched / fTokens.length >= 0.5) {
      fuzzy.push({ s: mean, j })
    } else if (fRoleIndices.length > 0 && rolesOk) {
      // Same role family but none of the other words. Kept for tier 3 so
      // "python developer" with no Python titles still shows engineering roles.
      related.push({ s: mean, j })
    }
  }
  if (fuzzy.length > 0) {
    fuzzy.sort((a, b) => b.s - a.s)
    return { jobs: fuzzy.map((x) => x.j), mode: 'fuzzy' }
  }

  // ---- Tier 3: related ----------------------------------------------------
  if (fRoleIndices.length > 0) {
    // Real boards rarely title a role "Python Developer"; they post "Software
    // Engineer, X" and ask for Python in the JD. So among same-family roles,
    // prefer those whose description mentions every non-role query word.
    const nonRoleTokens = fTokens.filter((_, i) => !fRoleSet.has(i))
    if (nonRoleTokens.length > 0 && related.length > 0) {
      const skillMentions = (j: T): number => {
        const hay = norm(j.description || '')
        const words = hay.split(' ')
        let min = Infinity
        for (const tok of nonRoleTokens) {
          let n = 0
          for (const a of aliasesOf(FUZZY_ALIASES, tok)) {
            n += a.includes(' ') ? countOccurrences(` ${hay} `, ` ${a} `) : words.filter((w) => w === a).length
          }
          if (n === 0) return 0
          min = Math.min(min, n)
        }
        return min
      }
      const skilled = related.map((r) => ({ ...r, m: skillMentions(r.j) })).filter((r) => r.m > 0)
      if (skilled.length > 0) {
        skilled.sort((a, b) => b.s - a.s || b.m - a.m)
        return { jobs: skilled.map((x) => x.j), mode: 'related' }
      }
    }
    related.sort((a, b) => b.s - a.s)
    return { jobs: related.map((x) => x.j), mode: related.length > 0 ? 'related' : 'none' }
  }

  // No role word in the query ("golang", "kafka"): look for every word in the
  // title + description instead.
  const fallback = jobs.filter((j) => {
    const hay = ` ${norm(j.title)} ${norm(j.description || '')} `
    return tokens.every((tok) => aliasesOf(TOKEN_ALIASES, tok).some((a) => hayContains(hay, a)))
  })
  if (fallback.length > 0) return { jobs: fallback.slice(0, 200), mode: 'related' }
  return { jobs: [], mode: 'none' }
}

/**
 * Does a job title fit one of a candidate's target titles? Every word of the
 * target must appear in the job title, with developer/engineer treated as the
 * same word, so "Backend Engineer" accepts "Software Engineer, Backend".
 */
export function matchesTargetTitle(jobTitle: string, targetTitles: string[]): boolean {
  const tl = norm(jobTitle)
  return targetTitles.some((target) => {
    const tokens = norm(target).split(' ').filter(Boolean)
    if (tokens.length === 0) return false
    const alias = Q_ALIASES[tokens.join(' ')]
    if (alias && alias.some((a) => containsPhrase(jobTitle, a))) return true
    return tokens.every((tok) => aliasesOf(TOKEN_ALIASES, tok).some((a) => hayContains(tl, a)))
  })
}
