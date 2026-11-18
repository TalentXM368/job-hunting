// Two-stage LLM layer: a cheap screen over every surviving job, a rich draft
// for the few worth applying to.
//
//   screen  batch ~8 jobs per call, JD truncated to ~1400 chars, cheapest model
//   draft   one call per job, ~6000 chars of JD, best model
//
// Every function takes the provider + model as arguments so tests can inject a
// stub and so screening and drafting can run on different providers.

import { LLMError, type Provider } from './providers.js'

export const DRAFT_KEYS = ['fit_summary', 'tailored_bullets', 'gaps', 'cover_note', 'questions_to_ask'] as const

export interface DraftKit {
  fit_summary: string
  tailored_bullets: string[]
  gaps: string[]
  cover_note: string
  questions_to_ask: string[]
}

// Output ceilings. Deliberately generous: reasoning models spend output tokens
// before the answer starts, so a ceiling sized to the visible answer gets
// consumed and the reply arrives as truncated JSON.
export const SCREEN_MAX_TOKENS = 16_000
export const DRAFT_MAX_TOKENS = 16_000
export const PROFILE_MAX_TOKENS = 16_000

/**
 * Parse a model reply that is *supposed* to be JSON. Models wrap JSON in
 * fences, open with "Here is the JSON:", or return an object where an array
 * was asked for, so this strips fences, tries straight, then falls back to
 * the outermost bracketed span.
 */
export function parseJson(raw: string | null | undefined): unknown {
  if (raw == null) throw new Error('empty model reply')
  const cleaned = raw.replace(/^\s*```(?:json|JSON)?\s*/gm, '').replace(/\s*```\s*$/gm, '').trim()
  try {
    return JSON.parse(cleaned)
  } catch {
    // fall through to span extraction
  }
  const spans: { at: number; blob: string }[] = []
  for (const [open, close] of [['[', ']'], ['{', '}']] as const) {
    const i = cleaned.indexOf(open)
    const k = cleaned.lastIndexOf(close)
    if (i !== -1 && k > i) spans.push({ at: i, blob: cleaned.slice(i, k + 1) })
  }
  for (const { blob } of spans.sort((a, b) => a.at - b.at)) {
    try {
      return JSON.parse(blob)
    } catch {
      continue
    }
  }
  throw new Error(`could not parse JSON from model reply: ${JSON.stringify(cleaned.slice(0, 300))}`)
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Accept [ {...} ], { "jobs": [...] }, or a bare { ... }. */
export function asList(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload.filter(isObject)
  if (isObject(payload)) {
    for (const key of ['jobs', 'results', 'scores', 'items']) {
      const inner = payload[key]
      if (Array.isArray(inner)) return inner.filter(isObject)
    }
    return [payload]
  }
  throw new Error(`expected a JSON array of results, got ${payload === null ? 'null' : typeof payload}`)
}

// ---------------------------------------------------------------- profile --

export const PROFILE_PROMPT = `Extract a structured job-search profile from this resume.

Return ONLY a JSON object, no prose, no markdown fences:
{
  "name": str,
  "email": str | null,
  "phone": str | null,
  "location": str | null,       // city, country as written
  "linkedin_url": str | null,
  "github_url": str | null,
  "portfolio_url": str | null,
  "current_title": str,
  "current_company": str | null,
  "years_experience": number,
  "core_skills": [str],        // 10-20, most load-bearing first
  "domains": [str],            // e.g. "distributed systems", "CDN", "frontend"
  "notable_projects": [str],   // one line each, with impact if stated
  "education": str,
  "target_titles": [str],      // roles this person should realistically aim at
  "seniority": str             // intern | new-grad | junior | mid | senior | staff
}
Use null for anything the resume does not state. Never guess contact details.`

export type ResumeInput = { kind: 'pdf'; bytes: Uint8Array } | { kind: 'text'; text: string }

/** Resume (PDF or text) -> raw profile object as the model returned it. */
export async function buildProfile(resume: ResumeInput, provider: Provider, model: string): Promise<Record<string, unknown>> {
  let raw: string
  if (resume.kind === 'pdf') {
    try {
      raw = await provider.completeDocument(model, PROFILE_PROMPT, resume.bytes, PROFILE_MAX_TOKENS)
    } catch (e) {
      if (e instanceof LLMError) {
        throw new LLMError(`${e.message}\nTip: upload the resume as .txt, or set DRAFT_PROVIDER=anthropic|gemini for PDF support.`)
      }
      throw e
    }
  } else {
    raw = await provider.complete(model, '', `${PROFILE_PROMPT}\n\n--- RESUME ---\n${resume.text}`, PROFILE_MAX_TOKENS, true)
  }
  const profile = parseJson(raw)
  if (!isObject(profile)) throw new Error('profile extraction did not return a JSON object')
  return profile
}

// ----------------------------------------------------------------- screen --

export const SCREEN_SYSTEM = `You screen job postings for one candidate. You are strict.

Score 0-10 on genuine fit:
  9-10  strong match, candidate clears the bar and the role is a step up
  7-8   good match, worth applying
  5-6   plausible but real gaps
  0-4   wrong seniority, wrong stack, or a hard requirement the candidate lacks

Seniority mismatch is the most common failure: a 3-year engineer scoring an 8
on a Staff role is wrong. Penalise it hard, in both directions: a senior
engineer does not want an internship either. Do the same for hard requirements
the candidate plainly does not meet: security clearance, a specific degree, a
named technology with a year count they cannot hit, or a country they cannot
work in.

Do not inflate scores to be encouraging. Most postings are a 4.

Return ONLY a JSON array, one object per job, no prose:
[{"job_id": str, "score": number, "reason": str}]
Echo \`job_id\` back exactly as given. \`reason\` is one sentence, max 20 words,
concrete about the deciding factor.`

export interface ScreenJob {
  job_id: string
  company: string
  title: string
  location: string
  description: string
}

export interface ScreenResult {
  score: number
  reason: string
}

export interface ScreenOutcome {
  /** Keyed by job_id. A job missing here was not scored and should be retried. */
  results: Map<string, ScreenResult>
  failedBatches: number
  errors: string[]
}

export interface ScreenOptions {
  batchSize?: number
  jdChars?: number
}

/**
 * Stage 1: score every surviving job against the profile. A batch that fails
 * is recorded and skipped: one bad reply must not take down the whole run.
 */
export async function screen(jobs: ScreenJob[], profile: unknown, provider: Provider, model: string, opts: ScreenOptions = {}): Promise<ScreenOutcome> {
  const batchSize = Math.max(1, Math.trunc(opts.batchSize ?? 8))
  const jdChars = opts.jdChars ?? 1400
  const profileBlob = JSON.stringify(profile)
  const outcome: ScreenOutcome = { results: new Map(), failedBatches: 0, errors: [] }

  for (let start = 0; start < jobs.length; start += batchSize) {
    const batch = jobs.slice(start, start + batchSize)
    const payload = batch.map((j) => ({
      job_id: j.job_id,
      company: j.company,
      title: j.title,
      location: j.location,
      description: j.description.slice(0, jdChars),
    }))
    const byId = new Map<string, Record<string, unknown>>()
    try {
      const raw = await provider.complete(
        model, SCREEN_SYSTEM,
        `CANDIDATE PROFILE:\n${profileBlob}\n\nJOBS:\n${JSON.stringify(payload)}`,
        SCREEN_MAX_TOKENS, true,
      )
      for (const r of asList(parseJson(raw))) {
        if (r.job_id) byId.set(String(r.job_id), r)
      }
    } catch (e) {
      outcome.failedBatches++
      outcome.errors.push(`batch ${Math.floor(start / batchSize) + 1}: ${(e as Error).message}`)
      continue
    }
    for (const j of batch) {
      const r = byId.get(j.job_id)
      if (!r) continue
      const n = Number(r.score ?? 0)
      outcome.results.set(j.job_id, {
        score: Number.isFinite(n) ? Math.max(0, Math.min(10, n)) : 0,
        reason: String(r.reason ?? '').trim(),
      })
    }
  }
  return outcome
}

// ------------------------------------------------------------------ draft --

export const DRAFT_SYSTEM = `You prepare an application kit for one job.

Hard rule: never invent experience. Every claim must trace to something in the
candidate profile. If the profile does not support a claim, it goes in \`gaps\`,
not in a bullet.

Return ONLY a JSON object, no prose:
{
  "fit_summary": str,          // 2 sentences: why this is worth their time
  "tailored_bullets": [str],   // 3-4 resume bullets rewritten for THIS job,
                               // using only real experience from the profile,
                               // each with a concrete artefact or number
  "gaps": [str],               // 1-3 honest gaps, each with how to address it
  "cover_note": str,           // 120-160 words. Plain. No "I am writing to
                               // express my interest", no "I am excited to",
                               // no flattery about the company's mission.
                               // Open with a concrete reason they fit this role.
  "questions_to_ask": [str]    // 2 sharp questions that show they read the JD
}`

export interface DraftJob {
  title: string
  company: string
  location: string
  url: string
  description: string
}

const strList = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x)) : [])

/** Stage 2: full kit for one job. Throws on a provider or parse failure. */
export async function draft(job: DraftJob, profile: unknown, provider: Provider, model: string, jdChars = 6000): Promise<DraftKit> {
  const raw = await provider.complete(
    model, DRAFT_SYSTEM,
    `CANDIDATE PROFILE:\n${JSON.stringify(profile)}\n\n` +
      `JOB: ${job.title} at ${job.company} (${job.location || 'location not stated'})\n` +
      `URL: ${job.url}\n\n${job.description.slice(0, jdChars)}`,
    DRAFT_MAX_TOKENS, true,
  )
  const kit = parseJson(raw)
  if (!isObject(kit)) throw new Error('draft did not return a JSON object')
  // Normalise so nothing downstream has to guess the shape.
  return {
    fit_summary: String(kit.fit_summary ?? ''),
    tailored_bullets: strList(kit.tailored_bullets),
    gaps: strList(kit.gaps),
    cover_note: String(kit.cover_note ?? ''),
    questions_to_ask: strList(kit.questions_to_ask),
  }
}

// --------------------------------------------- offline scorer (no API) ---

/**
 * DEV ONLY. Token-overlap stand-in so the pipeline runs with no API key.
 * It cannot tell a Staff role from a new-grad one and has no idea what the
 * words mean. Only used when SCORER=keyword is set explicitly.
 */
export function keywordScreen(jobs: ScreenJob[], profile: { core_skills?: unknown; target_titles?: unknown }): Map<string, ScreenResult> {
  const skills = [...new Set(strList(profile.core_skills).filter(Boolean).map((s) => s.toLowerCase()))]
  const titles = strList(profile.target_titles).filter(Boolean).map((t) => t.toLowerCase())
  const out = new Map<string, ScreenResult>()
  for (const j of jobs) {
    const blob = `${j.title} ${j.description}`.toLowerCase()
    const hits = skills.filter((s) => blob.includes(s)).sort()
    const overlap = hits.length / Math.max(skills.length, 1)
    const titleBonus = titles.some((t) => j.title.toLowerCase().includes(t)) ? 2.5 : 0
    out.set(j.job_id, {
      score: Math.round(Math.min(10, overlap * 12 + titleBonus) * 10) / 10,
      reason: hits.length > 0 ? `[keyword stub] matched: ${hits.slice(0, 5).join(', ')}` : '[keyword stub] no skill overlap',
    })
  }
  return out
}
