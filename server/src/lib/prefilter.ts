// Deterministic filter that runs BEFORE any LLM call: title regexes, location
// phrases and posting age. It is free, and it is what keeps the LLM bill small.

export const REMOTE_HINTS = ['remote', 'anywhere', 'work from home', 'wfh', 'distributed']

export interface Filterable {
  title: string
  location: string
  posted_at: string | null
}

export interface FilterConfig {
  /** Regexes; a title must match at least one. Empty means "match everything". */
  include_titles?: string[]
  /** Regexes; a title matching any of these is dropped. */
  exclude_titles?: string[]
  /** Phrases matched against the location field. Empty accepts every location. */
  locations?: string[]
  allow_remote?: boolean
  /** Null or undefined disables the freshness gate. */
  max_age_days?: number | null
}

export interface FilterStats {
  title: number
  location: number
  age: number
}

/** Compile a user-supplied pattern. Returns null when it is not a valid regex. */
export function compilePattern(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern, 'i')
  } catch {
    return null
  }
}

function anyMatch(patterns: RegExp[], text: string): boolean {
  return patterns.some((p) => p.test(text))
}

export function normalizePhrase(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

/** Whole-phrase containment on word boundaries: "india" must not match "indiana". */
export function containsPhrase(text: string, phrase: string): boolean {
  const p = normalizePhrase(phrase)
  return Boolean(p) && ` ${normalizePhrase(text)} `.includes(` ${p} `)
}

/** Accepts ISO timestamps and bare dates. A value with no zone is read as UTC. */
export function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null
  let v = value.trim()
  if (/^\d{4}-\d{2}-\d{2}T/.test(v) && !/(Z|[+-]\d{2}:?\d{2})$/i.test(v)) v += 'Z'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

export function prefilter<T extends Filterable>(jobs: T[], cfg: FilterConfig, now: Date = new Date()): { kept: T[]; stats: FilterStats } {
  const inc = (cfg.include_titles ?? []).map(compilePattern).filter((p): p is RegExp => p !== null)
  const exc = (cfg.exclude_titles ?? []).map(compilePattern).filter((p): p is RegExp => p !== null)
  const locs = cfg.locations ?? []
  const allowRemote = cfg.allow_remote ?? true
  const cutoff = cfg.max_age_days != null ? new Date(now.getTime() - cfg.max_age_days * 86_400_000) : null

  const kept: T[] = []
  const stats: FilterStats = { title: 0, location: 0, age: 0 }
  for (const j of jobs) {
    if ((inc.length > 0 && !anyMatch(inc, j.title)) || anyMatch(exc, j.title)) {
      stats.title++
      continue
    }
    if (locs.length > 0) {
      const location = j.location || ''
      const isRemote = allowRemote && REMOTE_HINTS.some((h) => containsPhrase(location, h))
      if (!isRemote && !locs.some((l) => containsPhrase(location, l))) {
        stats.location++
        continue
      }
    }
    if (cutoff) {
      // A posting with no parseable date passes: boards omit it too often to punish.
      const posted = parseDate(j.posted_at)
      if (posted && posted < cutoff) {
        stats.age++
        continue
      }
    }
    kept.push(j)
  }
  return { kept, stats }
}
