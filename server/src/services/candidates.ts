// Candidate profiles, their job preferences and their resume files.

import type { Selectable } from 'kysely'
import { z } from 'zod'
import { getDb, jsonb, type Candidate, type CandidatePreference, type CandidateResume, type Database } from '../db/client.js'
import { HttpError, iso, notFound, num, parseBody } from '../http.js'
import { buildProfile } from '../lib/llm.js'
import { compilePattern } from '../lib/prefilter.js'
import { pdfToText } from '../lib/pdf.js'
import { LLMError, resolve } from '../lib/providers.js'
import { readResumeText } from '../lib/rules.js'
import { deleteFile, getFile, putFile } from '../lib/storage.js'

// ------------------------------------------------------------ default user --

// There is no login yet, so every candidate belongs to one built-in recruiter.
const DEFAULT_USER = { email: 'recruiter@jobhunt.local', name: 'Recruiter' }

export async function defaultUserId(db: Database): Promise<string> {
  const found = await db.selectFrom('users').select('id').where('email', '=', DEFAULT_USER.email).executeTakeFirst()
  if (found) return found.id
  await db.insertInto('users').values(DEFAULT_USER).onConflict((oc) => oc.column('email').doNothing()).execute()
  const row = await db.selectFrom('users').select('id').where('email', '=', DEFAULT_USER.email).executeTakeFirstOrThrow()
  return row.id
}

// ---------------------------------------------------------------- schemas --

const text = (max: number) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().max(max).nullable())

const number = (schema: z.ZodNumber) =>
  z.preprocess((v) => (v === '' ? null : typeof v === 'string' ? Number(v) : v), schema.nullable())

const stringList = (maxItems: number, maxLen: number) =>
  z.array(z.string()).max(maxItems).default([])
    .transform((items) => [...new Set(items.map((s) => s.trim().slice(0, maxLen)).filter(Boolean))])

/** What screening is scored against. Same shape as profile.example.json. */
const profileSchema = z.object({
  core_skills: stringList(60, 80),
  domains: stringList(30, 120),
  notable_projects: stringList(30, 500),
  education: z.string().trim().max(500).nullish().transform((v) => v ?? ''),
  target_titles: stringList(30, 120),
})
export type ScoringProfile = z.infer<typeof profileSchema>

const candidateSchema = z.object({
  full_name: z.string().trim().min(1, 'full name is required').max(200),
  status: z.enum(['active', 'paused', 'archived']),
  email: text(254),
  phone: text(40),
  location: text(200),
  linkedin_url: text(500),
  github_url: text(500),
  portfolio_url: text(500),
  current_title: text(200),
  current_company: text(200),
  years_experience: number(z.number().min(0).max(80)),
  seniority: text(40),
  work_authorization: text(200),
  requires_sponsorship: z.boolean().nullable(),
  willing_to_relocate: z.boolean().nullable(),
  notice_period_days: number(z.number().int().min(0).max(3650)),
  current_salary: number(z.number().int().min(0).max(2_000_000_000)),
  expected_salary: number(z.number().int().min(0).max(2_000_000_000)),
  salary_currency: text(8),
  profile: profileSchema.nullable(),
})

const createSchema = candidateSchema.partial().required({ full_name: true })
const updateSchema = candidateSchema.partial()

const patternList = z.array(z.string()).max(60).default([])
  .transform((items) => items.map((s) => s.trim()).filter(Boolean))

const preferencesSchema = z.object({
  target_titles: stringList(30, 120),
  include_title_patterns: patternList,
  exclude_title_patterns: patternList,
  locations: stringList(40, 120),
  allow_remote: z.boolean().default(true),
  max_age_days: number(z.number().int().min(1).max(3650)).default(30),
  score_threshold: z.preprocess((v) => (typeof v === 'string' ? Number(v) : v), z.number().min(0).max(10)).default(7),
})

/** Neutral starting point for a new candidate: nothing is filtered by title or place. */
export const DEFAULT_PREFERENCES = {
  target_titles: [] as string[],
  include_title_patterns: [] as string[],
  exclude_title_patterns: [] as string[],
  locations: [] as string[],
  allow_remote: true,
  max_age_days: 30 as number | null,
  score_threshold: 7,
}

// ------------------------------------------------------------- serialising --

export function serializeCandidate(c: Selectable<Candidate>) {
  return {
    id: c.id,
    status: c.status,
    full_name: c.full_name,
    email: c.email,
    phone: c.phone,
    location: c.location,
    linkedin_url: c.linkedin_url,
    github_url: c.github_url,
    portfolio_url: c.portfolio_url,
    current_title: c.current_title,
    current_company: c.current_company,
    years_experience: num(c.years_experience),
    seniority: c.seniority,
    work_authorization: c.work_authorization,
    requires_sponsorship: c.requires_sponsorship,
    willing_to_relocate: c.willing_to_relocate,
    notice_period_days: c.notice_period_days,
    current_salary: c.current_salary,
    expected_salary: c.expected_salary,
    salary_currency: c.salary_currency,
    profile: (c.profile ?? null) as ScoringProfile | null,
    created_at: iso(c.created_at),
    updated_at: iso(c.updated_at),
  }
}

export function serializePreferences(p: Selectable<CandidatePreference>) {
  return {
    candidate_id: p.candidate_id,
    target_titles: p.target_titles,
    include_title_patterns: p.include_title_patterns,
    exclude_title_patterns: p.exclude_title_patterns,
    locations: p.locations,
    allow_remote: p.allow_remote,
    max_age_days: p.max_age_days,
    score_threshold: num(p.score_threshold) ?? DEFAULT_PREFERENCES.score_threshold,
    updated_at: iso(p.updated_at),
  }
}

export function serializeResume(r: Selectable<CandidateResume>) {
  return {
    id: r.id,
    candidate_id: r.candidate_id,
    file_name: r.file_name,
    mime_type: r.mime_type,
    size_bytes: r.size_bytes,
    is_primary: r.is_primary,
    uploaded_at: iso(r.uploaded_at),
  }
}

// ------------------------------------------------------------- candidates --

/** Turn validated input into column values. Only keys that were sent are set. */
function toColumns(input: z.infer<typeof updateSchema>) {
  const { years_experience, profile, ...rest } = input
  return {
    ...rest,
    ...(years_experience !== undefined ? { years_experience: years_experience == null ? null : String(years_experience) } : {}),
    ...(profile !== undefined ? { profile: jsonb(profile) } : {}),
  }
}

export async function listCandidates() {
  const db = await getDb()
  const rows = await db.selectFrom('candidates as c')
    .select(['c.id', 'c.full_name', 'c.email', 'c.current_title', 'c.current_company', 'c.location', 'c.status', 'c.updated_at'])
    .select((eb) => [
      eb.selectFrom('candidate_resumes as r').select((e) => e.fn.countAll().as('n')).whereRef('r.candidate_id', '=', 'c.id').as('resumes'),
      eb.selectFrom('matches as m').select((e) => e.fn.countAll().as('n')).whereRef('m.candidate_id', '=', 'c.id').where('m.status', '=', 'new').as('new_matches'),
      eb.selectFrom('applications as a').select((e) => e.fn.countAll().as('n')).whereRef('a.candidate_id', '=', 'c.id').as('applications'),
    ])
    .orderBy('c.updated_at', 'desc').execute()
  return rows.map((r) => ({
    id: r.id,
    full_name: r.full_name,
    email: r.email,
    current_title: r.current_title,
    current_company: r.current_company,
    location: r.location,
    status: r.status,
    updated_at: iso(r.updated_at),
    has_resume: (num(r.resumes) ?? 0) > 0,
    new_matches: num(r.new_matches) ?? 0,
    applications: num(r.applications) ?? 0,
  }))
}

export async function createCandidate(body: unknown) {
  const input = parseBody(createSchema, body)
  const db = await getDb()
  const owner_id = await defaultUserId(db)
  const { full_name, ...rest } = input
  const row = await db.transaction().execute(async (trx) => {
    const created = await trx.insertInto('candidates').values({ owner_id, full_name, ...toColumns(rest) })
      .returningAll().executeTakeFirstOrThrow()
    await trx.insertInto('candidate_preferences')
      .values({ candidate_id: created.id, ...DEFAULT_PREFERENCES, score_threshold: String(DEFAULT_PREFERENCES.score_threshold) })
      .execute()
    return created
  })
  return serializeCandidate(row)
}

export async function loadCandidate(db: Database, id: string): Promise<Selectable<Candidate>> {
  const row = await db.selectFrom('candidates').selectAll().where('id', '=', id).executeTakeFirst()
  if (!row) throw notFound('candidate')
  return row
}

export async function loadPreferences(db: Database, candidateId: string) {
  const row = await db.selectFrom('candidate_preferences').selectAll().where('candidate_id', '=', candidateId).executeTakeFirst()
  return row ? serializePreferences(row) : { candidate_id: candidateId, ...DEFAULT_PREFERENCES, updated_at: null }
}

export async function getCandidate(id: string) {
  const db = await getDb()
  const candidate = await loadCandidate(db, id)
  const resumes = await db.selectFrom('candidate_resumes').selectAll().where('candidate_id', '=', id)
    .orderBy('is_primary', 'desc').orderBy('uploaded_at', 'desc').execute()
  return {
    candidate: serializeCandidate(candidate),
    preferences: await loadPreferences(db, id),
    resumes: resumes.map(serializeResume),
  }
}

export async function updateCandidate(id: string, body: unknown) {
  const input = parseBody(updateSchema, body)
  const db = await getDb()
  const row = await db.updateTable('candidates').set({ ...toColumns(input), updated_at: new Date() })
    .where('id', '=', id).returningAll().executeTakeFirst()
  if (!row) throw notFound('candidate')
  return serializeCandidate(row)
}

export async function deleteCandidate(id: string): Promise<void> {
  const db = await getDb()
  const files = await db.selectFrom('candidate_resumes').select('storage_url').where('candidate_id', '=', id).execute()
  const res = await db.deleteFrom('candidates').where('id', '=', id).executeTakeFirst()
  if (Number(res.numDeletedRows) === 0) throw notFound('candidate')
  // Rows are gone (cascade); a file that fails to delete is only an orphan.
  await Promise.allSettled(files.map((f) => deleteFile(f.storage_url)))
}

export async function savePreferences(candidateId: string, body: unknown) {
  const input = parseBody(preferencesSchema, body)
  for (const key of ['include_title_patterns', 'exclude_title_patterns'] as const) {
    const bad = input[key].find((p) => compilePattern(p) === null)
    if (bad !== undefined) throw new HttpError(400, `${key}: "${bad}" is not a valid regular expression`)
  }
  const db = await getDb()
  await loadCandidate(db, candidateId)
  const values = { ...input, score_threshold: String(input.score_threshold), updated_at: new Date() }
  const row = await db.insertInto('candidate_preferences').values({ candidate_id: candidateId, ...values })
    .onConflict((oc) => oc.column('candidate_id').doUpdateSet(values))
    .returningAll().executeTakeFirstOrThrow()
  return serializePreferences(row)
}

// ----------------------------------------------------------------- resumes --

export const MAX_RESUME_BYTES = 4 * 1024 * 1024 // under Vercel's 4.5 MB request cap

const RESUME_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
}

interface ResumeFile {
  ext: string
  mime: string
  name: string
  bytes: Uint8Array
}

/** The checks every uploaded resume passes before anything reads it. */
async function validateResumeFile(file: unknown): Promise<ResumeFile> {
  if (!(file instanceof File)) throw new HttpError(400, 'file: attach the resume as multipart field "file"')
  const ext = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : ''
  const mime = RESUME_TYPES[ext]
  if (!mime) throw new HttpError(415, 'Unsupported file type. Upload a .pdf, .txt or .md resume.')
  if (file.size === 0) throw new HttpError(400, 'The file is empty.')
  if (file.size > MAX_RESUME_BYTES) throw new HttpError(413, 'The file is larger than 4 MB.')
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (ext === 'pdf' && new TextDecoder('latin1').decode(bytes.subarray(0, 5)) !== '%PDF-') {
    throw new HttpError(415, 'That file has a .pdf name but is not a PDF.')
  }
  return { ext, mime, name: file.name, bytes }
}

/** Plain text of a resume, so rules and text-only providers can read it. A scanned PDF yields null. */
async function resumeText(ext: string, bytes: Uint8Array): Promise<string | null> {
  if (ext !== 'pdf') return new TextDecoder().decode(bytes).replace(/\u0000/g, '')
  const text = await pdfToText(bytes).catch(() => null)
  return text ? text : null
}

export async function addResume(candidateId: string, file: unknown) {
  const db = await getDb()
  await loadCandidate(db, candidateId)
  const { ext, mime, name, bytes } = await validateResumeFile(file)
  const extracted_text = await resumeText(ext, bytes)
  const storage_url = await putFile(name, bytes, mime)
  const existing = await db.selectFrom('candidate_resumes').select((eb) => eb.fn.countAll().as('n'))
    .where('candidate_id', '=', candidateId).executeTakeFirstOrThrow()
  const row = await db.insertInto('candidate_resumes').values({
    candidate_id: candidateId,
    file_name: name.slice(-200),
    mime_type: mime,
    size_bytes: bytes.byteLength,
    storage_url,
    extracted_text,
    is_primary: Number(existing.n) === 0,
  }).returningAll().executeTakeFirstOrThrow()
  return serializeResume(row)
}

async function loadResume(db: Database, candidateId: string, resumeId: string) {
  const row = await db.selectFrom('candidate_resumes').selectAll()
    .where('id', '=', resumeId).where('candidate_id', '=', candidateId).executeTakeFirst()
  if (!row) throw notFound('resume')
  return row
}

export async function readResumeFile(candidateId: string, resumeId: string) {
  const db = await getDb()
  const row = await loadResume(db, candidateId, resumeId)
  return { file_name: row.file_name, mime_type: row.mime_type, bytes: await getFile(row.storage_url) }
}

export async function setPrimaryResume(candidateId: string, resumeId: string) {
  const db = await getDb()
  await loadResume(db, candidateId, resumeId)
  const row = await db.transaction().execute(async (trx) => {
    await trx.updateTable('candidate_resumes').set({ is_primary: false }).where('candidate_id', '=', candidateId).execute()
    return trx.updateTable('candidate_resumes').set({ is_primary: true }).where('id', '=', resumeId)
      .returningAll().executeTakeFirstOrThrow()
  })
  return serializeResume(row)
}

export async function deleteResume(candidateId: string, resumeId: string): Promise<void> {
  const db = await getDb()
  const row = await loadResume(db, candidateId, resumeId)
  await db.deleteFrom('candidate_resumes').where('id', '=', resumeId).execute()
  if (row.is_primary) {
    const next = await db.selectFrom('candidate_resumes').select('id').where('candidate_id', '=', candidateId)
      .orderBy('uploaded_at', 'desc').executeTakeFirst()
    if (next) await db.updateTable('candidate_resumes').set({ is_primary: true }).where('id', '=', next.id).execute()
  }
  await deleteFile(row.storage_url).catch(() => undefined)
}

// -------------------------------------------------------------- extraction --

const optionalText = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined)

/** Models often return "linkedin.com/in/x" without a scheme; the form expects a URL. */
const optionalUrl = (v: unknown): string | undefined => {
  const s = optionalText(v)
  if (!s) return undefined
  return /^https?:\/\//i.test(s) ? s : `https://${s.replace(/^\/+/, '')}`
}

interface ResumeSource {
  mime_type: string
  text: string | null
  /** The original bytes; only fetched when a PDF goes to the model. */
  bytes: () => Promise<Uint8Array>
}

/**
 * Read a resume into profile fields. Nothing is saved: the recruiter reviews
 * the result in the form and saves it themselves. The default reads the text
 * with rules and costs nothing; `useLlm` asks the draft-stage model instead.
 */
async function extractProfile(src: ResumeSource, useLlm: boolean | null | undefined) {
  if (!useLlm) {
    const text = src.text ?? ''
    if (text.trim().length < 40) {
      throw new HttpError(422, src.mime_type === 'application/pdf'
        ? 'This PDF has no readable text layer (it may be a scan). Use "Extract with AI", or upload a .txt export.'
        : 'This resume has almost no text to read.')
    }
    return { ...readResumeText(text), model: 'rules' }
  }
  let resolved
  try {
    resolved = resolve('draft')
  } catch (e) {
    if (e instanceof LLMError) throw new HttpError(503, e.message)
    throw e
  }
  let raw: Record<string, unknown>
  try {
    raw = src.mime_type === 'application/pdf'
      ? await buildProfile({ kind: 'pdf', bytes: await src.bytes() }, resolved.provider, resolved.model)
      : await buildProfile({ kind: 'text', text: src.text ?? '' }, resolved.provider, resolved.model)
  } catch (e) {
    throw new HttpError(502, `Could not read the resume: ${(e as Error).message}`)
  }
  const years = Number(raw.years_experience)
  // Coerce before validating: one number in a list must not discard the lot.
  const strs = (v: unknown, max: number): string[] => (Array.isArray(v) ? v.map((x) => String(x)).slice(0, max) : [])
  const profile = profileSchema.safeParse({
    core_skills: strs(raw.core_skills, 60),
    domains: strs(raw.domains, 30),
    notable_projects: strs(raw.notable_projects, 30),
    education: typeof raw.education === 'string' ? raw.education.slice(0, 500) : '',
    target_titles: strs(raw.target_titles, 30),
  })
  return {
    fields: {
      full_name: optionalText(raw.name),
      email: optionalText(raw.email),
      phone: optionalText(raw.phone),
      location: optionalText(raw.location),
      linkedin_url: optionalUrl(raw.linkedin_url),
      github_url: optionalUrl(raw.github_url),
      portfolio_url: optionalUrl(raw.portfolio_url),
      current_title: optionalText(raw.current_title),
      current_company: optionalText(raw.current_company),
      years_experience: raw.years_experience != null && Number.isFinite(years) ? years : undefined,
      seniority: optionalText(raw.seniority),
    },
    profile: profile.success ? profile.data : profileSchema.parse({}),
    model: `${resolved.provider.name}/${resolved.model}`,
  }
}

const extractRequest = z.object({ use_llm: z.boolean().nullish() })

/** Read a stored resume. */
export async function extractFromResume(candidateId: string, resumeId: string, body: unknown) {
  const { use_llm } = parseBody(extractRequest, body)
  const db = await getDb()
  const row = await loadResume(db, candidateId, resumeId)
  return extractProfile({ mime_type: row.mime_type, text: row.extracted_text, bytes: () => getFile(row.storage_url) }, use_llm)
}

/** Read an uploaded file without keeping it: the "new candidate" form fills itself from this. */
export async function readResumeUpload(file: unknown, useLlm: unknown) {
  const { mime, ext, bytes } = await validateResumeFile(file)
  return extractProfile({ mime_type: mime, text: await resumeText(ext, bytes), bytes: async () => bytes }, useLlm === true || useLlm === 'true')
}
