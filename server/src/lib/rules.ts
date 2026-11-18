// The no-LLM path: a deterministic job scorer, a rule-based resume reader and
// a template application kit. These run on every job and every resume for
// free; the LLM is only called on top of them where a recruiter asks for it
// or where a few high-scoring jobs deserve a second opinion.
//
// Limits, stated plainly: the scorer counts evidence (skills, titles, levels,
// blockers); it cannot read nuance. The resume reader finds what a resume
// states in a recognisable form; it guesses nothing. The kit is a template.

import { matchesTargetTitle } from './titleSearch.js'
import { candidateLevel, displaySkill, DOMAIN_SIGNALS, LEVEL_NAMES, SKILL_ALIASES, SKILL_LOOKUP, titleLevel } from './vocab.js'

export interface RuleProfile {
  name?: string | null
  current_title?: string | null
  current_company?: string | null
  years_experience?: number | null
  seniority?: string | null
  location?: string | null
  requires_sponsorship?: boolean | null
  core_skills?: string[]
  domains?: string[]
  notable_projects?: string[]
  education?: string | null
  target_titles?: string[]
}

export interface RuleJob {
  title: string
  company: string
  location: string
  description: string
}

// ------------------------------------------------------------ text utils --

/** Lower-case, one space between tokens, with the symbols skills need (c++, c#, node.js, ci/cd) kept. */
function normalize(text: string): string {
  return ` ${text.toLowerCase().replace(/[^a-z0-9+#./-]+/g, ' ').replace(/\s+/g, ' ').trim()} `
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Whole-term match: "go" must not hit "google", "c" must not hit "c++". */
function hasTerm(hayNorm: string, term: string): boolean {
  return new RegExp(`(?<![a-z0-9+#])${escapeRe(term)}(?![a-z0-9+#])`).test(hayNorm)
}

// Two-letter skills ("go", "ml", "c") are ordinary words too. They only count
// when the original text has them in their usual capitalised form.
const SHORT_FORMS: Record<string, RegExp> = {
  go: /(?<![A-Za-z0-9+#])Go(?![A-Za-z0-9+#])/,
  c: /(?<![A-Za-z0-9+#])C(?![A-Za-z0-9+#])/,
  r: /(?<![A-Za-z0-9+#])R(?![A-Za-z0-9+#])/,
  ml: /(?<![A-Za-z0-9+#])ML(?![A-Za-z0-9+#])/,
  js: /(?<![A-Za-z0-9+#])JS(?![A-Za-z0-9+#])/,
  ts: /(?<![A-Za-z0-9+#])TS(?![A-Za-z0-9+#])/,
  ai: /(?<![A-Za-z0-9+#])AI(?![A-Za-z0-9+#])/,
}

/** Canonical skills found in a text, with how often each is mentioned. */
export function detectSkills(text: string): Map<string, number> {
  const hay = normalize(text)
  const found = new Map<string, number>()
  for (const [canon, spellings] of Object.entries(SKILL_ALIASES)) {
    let count = 0
    for (const s of spellings) {
      const short = SHORT_FORMS[s]
      if (short) {
        if (short.test(text)) count += (text.match(new RegExp(short.source, 'g')) ?? []).length
        continue
      }
      const re = new RegExp(`(?<![a-z0-9+#])${escapeRe(s)}(?![a-z0-9+#])`, 'g')
      count += (hay.match(re) ?? []).length
    }
    if (count > 0) found.set(canon, count)
  }
  return found
}

/** A candidate's skills as canonical names where the vocabulary knows them, else as typed. */
export function canonicalSkills(skills: string[] | undefined): string[] {
  const out = new Set<string>()
  for (const raw of skills ?? []) {
    const s = raw.trim().toLowerCase()
    if (!s) continue
    out.add(SKILL_LOOKUP.get(s) ?? s)
  }
  return [...out]
}

function detectDomains(text: string): Map<string, number> {
  const hay = text.toLowerCase()
  const found = new Map<string, number>()
  for (const [domain, signals] of Object.entries(DOMAIN_SIGNALS)) {
    const n = signals.reduce((acc, s) => acc + (hay.split(s).length - 1), 0)
    if (n > 0) found.set(domain, n)
  }
  return found
}

const YEARS_RE = /(\d{1,2})\s*\+?\s*(?:-|–|to)?\s*(\d{1,2})?\s*\+?\s*(?:years?|yrs?)\b/gi

/** Minimum years a posting asks for, from phrases like "5+ years" or "3-5 years". */
export function yearsRequired(description: string): number | null {
  const hits: number[] = []
  for (const m of description.matchAll(YEARS_RE)) {
    const n = Number(m[1])
    if (n >= 1 && n <= 25) hits.push(n)
  }
  return hits.length > 0 ? Math.min(...hits) : null
}

// ------------------------------------------------------------- scoring ---

export interface RuleResult {
  /** 0 to 10 in steps of 0.5. */
  score: number
  reason: string
  title_fit: 'target' | 'family' | 'none'
  matched_skills: string[]
  missing_skills: string[]
  job_level: number | null
  candidate_level: number | null
  years_required: number | null
  blockers: string[]
}

const ROLE_WORDS = /\b(engineer|developer|sde|programmer|architect|scientist|analyst|manager|consultant|designer|intern|administrator|lead|researcher)\b/i

export function ruleScore(job: RuleJob, profile: RuleProfile): RuleResult {
  const text = `${job.title}\n${job.description}`
  const hay = normalize(text)
  const parts: string[] = []
  let score = 2

  // Title fit (0..3).
  const targets = profile.target_titles?.length ? profile.target_titles : profile.current_title ? [profile.current_title] : []
  let titleFit: RuleResult['title_fit'] = 'none'
  if (targets.length > 0 && matchesTargetTitle(job.title, targets)) {
    titleFit = 'target'
    score += 3
    parts.push(`Title fits "${targets.find((t) => matchesTargetTitle(job.title, [t]))}"`)
  } else {
    const jobRole = job.title.match(ROLE_WORDS)?.[0]?.toLowerCase()
    const candRole = (profile.current_title ?? '').match(ROLE_WORDS)?.[0]?.toLowerCase()
    const same = jobRole && candRole && (jobRole === candRole || (['engineer', 'developer', 'sde', 'programmer'].includes(jobRole) && ['engineer', 'developer', 'sde', 'programmer'].includes(candRole)))
    if (same) {
      titleFit = 'family'
      score += 1
      parts.push('Same role family as the current title')
    } else {
      parts.push('Title does not fit the target titles')
    }
  }

  // Skills (0..4): how much of the candidate shows up, and how much of the posting is covered.
  const profileSkills = canonicalSkills(profile.core_skills)
  const jobSkills = detectSkills(text)
  const matched = profileSkills.filter((s) => jobSkills.has(s) || (!SKILL_ALIASES[s] && hasTerm(hay, s)))
  const missing = [...jobSkills.entries()].filter(([s]) => !profileSkills.includes(s)).sort((a, b) => b[1] - a[1]).map(([s]) => s)
  if (profileSkills.length > 0) {
    const presence = Math.min(1, matched.length / Math.max(3, Math.min(profileSkills.length, 6)))
    // A posting that names no known skills earns nothing here: silence is not a match.
    const coverage = jobSkills.size > 0 ? Math.min(1, matched.length / Math.min(jobSkills.size, 8)) : 0
    score += 4 * (0.6 * presence + 0.4 * coverage)
    parts.push(matched.length > 0 ? `Skills: ${matched.slice(0, 5).join(', ')}` : 'None of the profile skills appear in the posting')
    if (missing.length > 0) parts.push(`asks for ${missing.slice(0, 3).join(', ')}`)
  } else {
    parts.push('No skills on the profile to compare')
  }

  // Seniority: title level and years asked for, against the candidate.
  const jobLevel = titleLevel(job.title)
  const candLevel = candidateLevel(profile.seniority, profile.years_experience)
  const required = yearsRequired(job.description)
  let seniorityPts = 0
  if (jobLevel != null && candLevel != null) {
    const d = jobLevel - candLevel
    if (jobLevel === 6 && candLevel !== 6) {
      seniorityPts = -3
      parts.push('Management role (−3)')
    } else if (d === 0) {
      seniorityPts = 1
      parts.push(`${LEVEL_NAMES[jobLevel]} role, same level (+1)`)
    } else if (d === 1) {
      // A step up is a stretch. The model consistently marks these down, so
      // the rules do too, mildly, and the LLM pass goes to closer fits first.
      seniorityPts = -1
      parts.push(`${LEVEL_NAMES[jobLevel]} role, one step up (-1)`)
    } else if (d === -1) {
      seniorityPts = 0
    } else {
      seniorityPts = Math.abs(d) === 2 ? -2 : -3
      parts.push(`${LEVEL_NAMES[jobLevel]} role vs ${LEVEL_NAMES[candLevel]} candidate (${seniorityPts})`)
    }
  }
  if (required != null && profile.years_experience != null && required > profile.years_experience + 1) {
    const yearsPts = -Math.min(3, required - profile.years_experience - 1)
    if (yearsPts < seniorityPts) {
      seniorityPts = yearsPts
      parts.push(`Asks for ${required}+ years, candidate has ${profile.years_experience} (${yearsPts})`)
    }
  }
  score += seniorityPts

  // Domain overlap (0..1).
  const jobDomains = detectDomains(text)
  const domainHit = (profile.domains ?? []).find((d) => jobDomains.has(d.toLowerCase()) || hay.includes(` ${d.toLowerCase()} `))
  if (domainHit) {
    score += 1
    parts.push(`Domain: ${domainHit}`)
  }

  // Hard blockers.
  const blockers: string[] = []
  if (/\b(security clearance|ts\/sci|top secret|public trust clearance)\b/i.test(text)) blockers.push('asks for a security clearance')
  if (/\b(u\.?s\.? citizen(ship)?\s+(is\s+)?required|must be a u\.?s\.? citizen)\b/i.test(text)) blockers.push('requires US citizenship')
  if (profile.requires_sponsorship === true && /\b(without (the need for )?(visa )?sponsorship|not able to (provide|offer) (visa )?sponsorship|unable to sponsor|will not sponsor)\b/i.test(text)) {
    blockers.push('no visa sponsorship, candidate needs it')
  }
  if (/\bph\.?d\.?\s+(is\s+)?required\b|\brequires a ph\.?d\b/i.test(text) && !/ph\.?d/i.test(profile.education ?? '')) blockers.push('requires a PhD')
  score -= blockers.length > 0 ? Math.min(4, 3 * blockers.length) : 0
  if (blockers.length > 0) parts.push(`Blocker: ${blockers.join('; ')}`)

  score = Math.max(0, Math.min(10, Math.round(score * 2) / 2))
  return {
    score,
    reason: `[rules] ${parts.join('. ')}.`,
    title_fit: titleFit,
    matched_skills: matched,
    missing_skills: missing.slice(0, 5),
    job_level: jobLevel,
    candidate_level: candLevel,
    years_required: required,
    blockers,
  }
}

// -------------------------------------------------------- resume reading ---

export interface ReadResume {
  fields: {
    full_name?: string
    email?: string
    phone?: string
    location?: string
    linkedin_url?: string
    github_url?: string
    portfolio_url?: string
    current_title?: string
    current_company?: string
    years_experience?: number
    seniority?: string
  }
  profile: {
    core_skills: string[]
    domains: string[]
    notable_projects: string[]
    education: string
    target_titles: string[]
  }
}

const SENIORITY_WORDS = ['', 'intern', 'junior', 'mid', 'senior', 'staff', 'manager'] as const
const LEVEL_WORDS_RE = /\b(senior|sr\.?|junior|jr\.?|staff|principal|lead|associate|intern|i{1,3}|[123])\b/gi
const HEADING_RE = /^(experience|work experience|education|skills|summary|projects|profile|objective|contact|certifications?)\b/i
const TITLE_RE = /\b(engineer|developer|sde|programmer|architect|scientist|analyst|manager|consultant|designer|intern|administrator|lead|researcher)\b/i

/** Read what a resume states outright. Anything not found is left out, never guessed. */
export function readResumeText(text: string): ReadResume {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean)
  const fields: ReadResume['fields'] = {}

  const email = text.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/)?.[0]
  if (email) fields.email = email
  const phone = [...text.matchAll(/\+?\d[\d\s().-]{7,}\d/g)].map((m) => m[0]).find((p) => p.replace(/\D/g, '').length >= 10)
  if (phone) fields.phone = phone.trim()
  const linkedin = text.match(/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[\w-]+/i)?.[0]
  if (linkedin) fields.linkedin_url = linkedin.startsWith('http') ? linkedin : `https://${linkedin}`
  const github = text.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/[\w-]+/i)?.[0]
  if (github) fields.github_url = github.startsWith('http') ? github : `https://${github}`
  const site = [...text.matchAll(/https?:\/\/[^\s)]+/g)].map((m) => m[0]).find((u) => !/linkedin\.com|github\.com/i.test(u))
  if (site) fields.portfolio_url = site

  // Name: an early short line of capitalised words with nothing else on it.
  const name = lines.slice(0, 5).find((l) => /^[A-Z][a-zA-Z'.-]+(?: [A-Z][a-zA-Z'.-]+){1,3}$/.test(l) && !TITLE_RE.test(l) && !HEADING_RE.test(l))
  if (name) fields.full_name = name

  // Title: the first title-looking line near the top that is not a heading.
  const titleLine = lines.slice(0, 30).find((l) => TITLE_RE.test(l) && !HEADING_RE.test(l) && !l.includes('@') && l.length <= 80 && !/\d{4}/.test(l))
  if (titleLine) {
    const split = titleLine.split(/\s+(?:at|@)\s+|\s*[|•·]\s*|,\s+/)
    fields.current_title = (split[0] ?? titleLine).trim()
    const company = split.slice(1).find((p) => p.trim() && !TITLE_RE.test(p))
    if (company && company.trim().length <= 60) fields.current_company = company.trim()
  }

  const yearsStated = [...text.matchAll(/(\d{1,2}(?:\.\d)?)\+?\s*(?:years?|yrs?)(?:\s+of)?\s+(?:professional\s+|work\s+|industry\s+)?(?:experience|exp\b)/gi)]
    .map((m) => Number(m[1])).filter((n) => n >= 0 && n <= 40)
  if (yearsStated.length > 0) fields.years_experience = Math.max(...yearsStated)

  const level = (fields.current_title ? titleLevel(fields.current_title) : null) ?? candidateLevel(null, fields.years_experience ?? null)
  if (level != null && SENIORITY_WORDS[level]) fields.seniority = SENIORITY_WORDS[level]

  const location = lines.slice(0, 8).map((l) => l.match(/\b([A-Z][a-zA-Z]+(?: [A-Z][a-zA-Z]+)?,\s*(?:India|USA|UK|Canada|Germany|Singapore|Australia|[A-Z]{2}))\b/)?.[1]).find(Boolean)
  if (location) fields.location = location

  const skills = [...detectSkills(text).entries()].sort((a, b) => b[1] - a[1]).map(([s]) => displaySkill(s)).slice(0, 20)
  const domains = [...detectDomains(text).entries()].sort((a, b) => b[1] - a[1]).map(([d]) => d).slice(0, 6)
  const education = lines.find((l) => /\b(b\.?e\.?|b\.?tech|b\.?sc|bachelor|m\.?s\.?|m\.?tech|m\.?sc|master|mba|ph\.?d|diploma)\b/i.test(l) && l.length <= 120) ?? ''
  const projects = lines
    .map((l) => l.replace(/^[•\-*·▪●○■]\s*/, ''))
    .filter((l) => l.length >= 25 && l.length <= 220 && /\d/.test(l) && /\b((?:re)?built|reduced|improved|increased|cut|led|designed|migrated|shipped|scaled|owned|launched|automated|delivered|developed|implemented|created|optimi[sz]ed|achieved|drove|grew|saved|maintained)\b/i.test(l))
    .slice(0, 6)
  const stripped = (fields.current_title ?? '').replace(LEVEL_WORDS_RE, ' ').replace(/\s+/g, ' ').replace(/^[\s,|-]+|[\s,|-]+$/g, '').trim()

  return {
    fields,
    profile: {
      core_skills: skills,
      domains,
      notable_projects: projects,
      education,
      target_titles: stripped && TITLE_RE.test(stripped) ? [stripped] : [],
    },
  }
}

// ----------------------------------------------------------- template kit --

export interface TemplateKit {
  fit_summary: string
  tailored_bullets: string[]
  gaps: string[]
  cover_note: string
  questions_to_ask: string[]
}

const list = (items: string[]): string => {
  const shown = items.map(displaySkill)
  return shown.length <= 1 ? shown.join('') : `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`
}

/** A kit built only from the profile, the posting and the rule result. Reads like a template, because it is one. */
export function templateKit(job: RuleJob, profile: RuleProfile, rule: RuleResult): TemplateKit {
  const name = (profile.name ?? 'The candidate').trim()
  const first = name.split(' ')[0] ?? name
  const matched = rule.matched_skills
  const missing = rule.missing_skills
  const jobText = normalize(`${job.title} ${job.description}`)

  const levelNote =
    rule.job_level != null && rule.candidate_level != null && rule.job_level - rule.candidate_level >= 2
      ? ` The role is pitched at ${LEVEL_NAMES[rule.job_level]} level, above ${first}'s current ${LEVEL_NAMES[rule.candidate_level]} level.`
      : rule.job_level != null && rule.candidate_level != null && rule.job_level === rule.candidate_level
        ? ' The level matches.'
        : ''
  const fit_summary = matched.length > 0
    ? `${first}'s profile covers ${matched.length} of the skills this ${job.title} posting at ${job.company} names (${list(matched.slice(0, 4))}).${levelNote}`
    : `${first}'s profile does not name the skills this ${job.title} posting at ${job.company} asks for; check the resume before applying.${levelNote}`

  const projects = profile.notable_projects ?? []
  const relevant = projects.filter((p) => [...detectSkills(p).keys()].some((s) => jobText.includes(` ${s} `) || matched.includes(s)))
  const tailored_bullets = [...relevant, ...projects.filter((p) => !relevant.includes(p))].slice(0, 3)
  if (tailored_bullets.length < 3 && matched.length > 0) {
    tailored_bullets.push(`Hands-on with ${list(matched.slice(0, 4))}, which this posting lists as requirements.`)
  }

  const gaps = missing.slice(0, 3).map((s) => `The posting asks for ${displaySkill(s)}; it is not on the profile. Add any exposure, or say how quickly it can be picked up.`)
  if (rule.job_level != null && rule.candidate_level != null && rule.job_level - rule.candidate_level >= 2) {
    gaps.push(`Seniority: a ${LEVEL_NAMES[rule.job_level]} role for a ${LEVEL_NAMES[rule.candidate_level]} candidate. Lead with scope and ownership in the note.`)
  }
  if (rule.years_required != null && profile.years_experience != null && rule.years_required > profile.years_experience + 1) {
    gaps.push(`Years: the posting asks for ${rule.years_required}+, the profile shows ${profile.years_experience}.`)
  }
  for (const b of rule.blockers) gaps.push(`Blocker: the posting ${b}.`)

  const years = profile.years_experience != null ? `${profile.years_experience} years` : 'several years'
  const role = profile.current_title ? `as a ${profile.current_title}` : 'in engineering'
  const where = profile.current_company ? ` at ${profile.current_company}` : ''
  const project = projects[0] ? ` Recent work includes: ${projects[0].replace(/\.$/, '')}.` : ''
  const tools = matched.length > 0 ? ` The posting asks for ${list(matched.slice(0, 4))}; those are tools ${first} uses day to day.` : ''
  const gap = missing[0] ? ` ${displaySkill(missing[0])} is newer ground for ${first}, and the overlap with the rest of the stack makes it a short ramp.` : ''
  const based = profile.location ? ` ${first} is based in ${profile.location} and` : ` ${first}`
  const cover_note = `${job.company} is hiring a ${job.title}, and ${first}'s background fits the core of it. ${first} has spent ${years} ${role}${where}, working mostly with ${list((profile.core_skills ?? []).slice(0, 3)) || 'the stack this role names'}.${project}${tools}${gap}${based} would welcome a conversation about the team, the problems it owns this year, and where this role sits in them.`

  const questions_to_ask = [
    `What does the first 90 days look like for this ${job.title} role, and how is success measured?`,
    /on-call|oncall|incident/.test(jobText)
      ? 'How is on-call and incident response shared across the team?'
      : `Which parts of the stack (${list([...detectSkills(job.description).keys()].slice(0, 2)) || 'the systems named in the posting'}) would this role own end to end?`,
  ]

  return { fit_summary, tailored_bullets, gaps, cover_note, questions_to_ask }
}
