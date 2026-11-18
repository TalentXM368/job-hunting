// Applications: the editable kit, the approval step and the audit trail.
//
// Nothing here submits anything. "approved" means a recruiter signed off; the
// submit worker that would take it from there is not built, so an approved
// application is applied to by hand and then marked submitted.

import type { Selectable } from 'kysely'
import { z } from 'zod'
import { getDb, jsonb, type Application, type ApplicationStatus, type Database } from '../db/client.js'
import { HttpError, iso, notFound, num, parseBody } from '../http.js'
import { draft } from '../lib/llm.js'
import { LLMError, resolve } from '../lib/providers.js'
import { ruleScore, templateKit, type RuleProfile } from '../lib/rules.js'
import { defaultUserId, loadCandidate, loadPreferences, serializeResume } from './candidates.js'
import { scoringProfile } from './matching.js'

type Status = ApplicationStatus

const EDITABLE: Status[] = ['draft', 'needs_human']

function serialize(a: Selectable<Application>) {
  return {
    id: a.id,
    candidate_id: a.candidate_id,
    job_id: a.job_id,
    match_id: a.match_id,
    resume_id: a.resume_id,
    status: a.status,
    fit_summary: a.fit_summary,
    tailored_bullets: a.tailored_bullets,
    gaps: a.gaps,
    cover_note: a.cover_note,
    questions_to_ask: a.questions_to_ask,
    approved_at: iso(a.approved_at),
    submitted_at: iso(a.submitted_at),
    failure_reason: a.failure_reason,
    proof_url: a.proof_url,
    created_at: iso(a.created_at),
    updated_at: iso(a.updated_at),
  }
}

async function load(db: Database, id: string): Promise<Selectable<Application>> {
  const row = await db.selectFrom('applications').selectAll().where('id', '=', id).executeTakeFirst()
  if (!row) throw notFound('application')
  return row
}

async function loadJob(db: Database, jobId: string) {
  const r = await db.selectFrom('jobs as j').innerJoin('companies as c', 'c.id', 'j.company_id')
    .select(['j.id', 'j.external_id', 'j.company_id', 'j.title', 'j.location', 'j.url', 'j.description',
      'j.salary', 'j.employment_type', 'j.posted_at', 'j.closed_at', 'c.ats', 'c.name as company'])
    .where('j.id', '=', jobId).executeTakeFirst()
  if (!r) throw notFound('job')
  return {
    id: r.id, job_id: r.external_id, ats: r.ats, company: r.company, company_id: r.company_id,
    title: r.title, location: r.location, url: r.url, description: r.description, salary: r.salary,
    employment_type: r.employment_type, posted_at: iso(r.posted_at), closed_at: iso(r.closed_at),
  }
}

/** Append to the audit trail. `actorId` is null when the system caused the event. */
async function logEvent(db: Database, applicationId: string, type: string, actorId: string | null, detail?: Record<string, unknown>): Promise<void> {
  await db.insertInto('application_events')
    .values({ application_id: applicationId, type, actor_id: actorId, detail: jsonb(detail ?? null) }).execute()
}

// ------------------------------------------------------------------- reads --

const listQuery = z.object({
  candidate_id: z.uuid().optional(),
  status: z.enum(['draft', 'approved', 'queued', 'submitting', 'submitted', 'needs_human', 'failed', 'withdrawn']).optional(),
})

export async function listApplications(query: Record<string, string | undefined>) {
  const filters = parseBody(listQuery, {
    candidate_id: query.candidate_id || undefined,
    status: query.status || undefined,
  })
  const db = await getDb()
  let q = db.selectFrom('applications as a')
    .innerJoin('candidates as cand', 'cand.id', 'a.candidate_id')
    .innerJoin('jobs as j', 'j.id', 'a.job_id')
    .innerJoin('companies as c', 'c.id', 'j.company_id')
    .leftJoin('matches as m', (join) => join.onRef('m.candidate_id', '=', 'a.candidate_id').onRef('m.job_id', '=', 'a.job_id'))
    .select([
      'a.id', 'a.status', 'a.created_at', 'a.updated_at', 'a.approved_at', 'a.submitted_at',
      'cand.id as candidate_id', 'cand.full_name',
      'j.id as job_uuid', 'j.external_id', 'j.title', 'j.location', 'j.url',
      'c.name as company', 'c.ats', 'm.score',
    ])
  if (filters.candidate_id) q = q.where('a.candidate_id', '=', filters.candidate_id)
  if (filters.status) q = q.where('a.status', '=', filters.status)
  const rows = await q.orderBy('a.updated_at', 'desc').limit(500).execute()
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at),
    approved_at: iso(r.approved_at),
    submitted_at: iso(r.submitted_at),
    score: num(r.score),
    candidate: { id: r.candidate_id, full_name: r.full_name },
    job: { id: r.job_uuid, job_id: r.external_id, title: r.title, company: r.company, location: r.location, url: r.url, ats: r.ats },
  }))
}

export async function getApplication(id: string) {
  const db = await getDb()
  const app = await load(db, id)
  const candidate = await loadCandidate(db, app.candidate_id)
  const resumes = await db.selectFrom('candidate_resumes').selectAll().where('candidate_id', '=', app.candidate_id)
    .orderBy('is_primary', 'desc').orderBy('uploaded_at', 'desc').execute()
  const events = await db.selectFrom('application_events as e').leftJoin('users as u', 'u.id', 'e.actor_id')
    .select(['e.id', 'e.type', 'e.detail', 'e.created_at', 'u.name as actor'])
    .where('e.application_id', '=', id).orderBy('e.created_at', 'desc').execute()
  return {
    application: serialize(app),
    candidate: { id: candidate.id, full_name: candidate.full_name, email: candidate.email },
    job: await loadJob(db, app.job_id),
    resumes: resumes.map(serializeResume),
    events: events.map((e) => ({ id: e.id, type: e.type, actor: e.actor, detail: e.detail ?? null, created_at: iso(e.created_at) })),
  }
}

// ------------------------------------------------------------------ writes --

const createSchema = z.object({
  candidate_id: z.uuid(),
  job_id: z.uuid(),
  match_id: z.uuid().nullish(),
})

/** Start a draft application. Returns the existing one if the pair already has it. */
export async function createApplication(body: unknown): Promise<{ application: ReturnType<typeof serialize>; created: boolean }> {
  const input = parseBody(createSchema, body)
  const db = await getDb()
  const existing = await db.selectFrom('applications').selectAll()
    .where('candidate_id', '=', input.candidate_id).where('job_id', '=', input.job_id).executeTakeFirst()
  if (existing) return { application: serialize(existing), created: false }

  await loadCandidate(db, input.candidate_id)
  await loadJob(db, input.job_id)
  const match = await db.selectFrom('matches').select('id')
    .where('candidate_id', '=', input.candidate_id).where('job_id', '=', input.job_id).executeTakeFirst()
  const resume = await db.selectFrom('candidate_resumes').select('id').where('candidate_id', '=', input.candidate_id)
    .orderBy('is_primary', 'desc').orderBy('uploaded_at', 'desc').executeTakeFirst()
  const actor = await defaultUserId(db)
  const row = await db.insertInto('applications').values({
    candidate_id: input.candidate_id,
    job_id: input.job_id,
    match_id: match?.id ?? null,
    resume_id: resume?.id ?? null,
    tailored_bullets: [],
    gaps: [],
    questions_to_ask: [],
  }).returningAll().executeTakeFirstOrThrow()
  await logEvent(db, row.id, 'created', actor)
  return { application: serialize(row), created: true }
}

const lines = z.array(z.string()).max(30).transform((items) => items.map((s) => s.trim().slice(0, 2000)).filter(Boolean))
const longText = z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().max(20_000).nullable())

const editSchema = z.object({
  fit_summary: longText,
  tailored_bullets: lines,
  gaps: lines,
  cover_note: longText,
  questions_to_ask: lines,
  resume_id: z.uuid().nullable(),
}).partial()

function requireStatus(app: Selectable<Application>, allowed: Status[], action: string): void {
  if (!allowed.includes(app.status)) {
    throw new HttpError(409, `Cannot ${action} an application that is ${app.status.replace('_', ' ')}.`)
  }
}

export async function updateApplication(id: string, body: unknown) {
  const input = parseBody(editSchema, body)
  const db = await getDb()
  const app = await load(db, id)
  requireStatus(app, EDITABLE, 'edit')
  if (input.resume_id) {
    const owned = await db.selectFrom('candidate_resumes').select('id')
      .where('id', '=', input.resume_id).where('candidate_id', '=', app.candidate_id).executeTakeFirst()
    if (!owned) throw new HttpError(400, 'resume_id: that resume does not belong to this candidate')
  }
  const row = await db.updateTable('applications').set({ ...input, updated_at: new Date() })
    .where('id', '=', id).returningAll().executeTakeFirstOrThrow()
  await logEvent(db, id, 'kit_edited', await defaultUserId(db), { fields: Object.keys(input).join(', ').replace(/_/g, ' ') })
  return serialize(row)
}

const draftRequest = z.object({ use_llm: z.boolean().nullish() })

/**
 * Generate the kit. Overwrites what is there. The default is a template built
 * from the rule scorer's evidence and costs nothing; `use_llm: true` asks the
 * draft-stage model for a written one.
 */
export async function draftApplication(id: string, body: unknown) {
  const { use_llm } = parseBody(draftRequest, body)
  const db = await getDb()
  const app = await load(db, id)
  requireStatus(app, EDITABLE, 'regenerate the kit for')
  const candidate = await loadCandidate(db, app.candidate_id)
  const job = await loadJob(db, app.job_id)
  const profile = scoringProfile(candidate) as RuleProfile

  let kit
  let model: string
  if (use_llm) {
    let resolved
    try {
      resolved = resolve('draft')
    } catch (e) {
      if (e instanceof LLMError) throw new HttpError(503, e.message)
      throw e
    }
    try {
      kit = await draft(job, profile, resolved.provider, resolved.model)
    } catch (e) {
      throw new HttpError(502, `Could not draft the kit: ${(e as Error).message}`)
    }
    model = `${resolved.provider.name}/${resolved.model}`
  } else {
    kit = templateKit(job, profile, ruleScore(job, profile))
    model = 'template'
  }
  const row = await db.updateTable('applications').set({ ...kit, updated_at: new Date() })
    .where('id', '=', id).returningAll().executeTakeFirstOrThrow()
  await logEvent(db, id, 'kit_generated', null, { model })
  return serialize(row)
}

/** At most this many drafts are prepared per candidate per daily run, best scores first. */
const PREPARE_MAX = 10

/**
 * The daily run's prep step: a draft application with a template kit for
 * every open, non-dismissed match at or above the candidate's score threshold
 * that has no application yet. Free (no LLM). Stops at draft: nothing is
 * approved or submitted. Returns how many drafts were created.
 */
export async function prepareApplications(candidateId: string): Promise<number> {
  const db = await getDb()
  const candidate = await loadCandidate(db, candidateId)
  const prefs = await loadPreferences(db, candidateId)
  const rows = await db.selectFrom('matches as m')
    .innerJoin('jobs as j', 'j.id', 'm.job_id')
    .leftJoin('applications as a', (join) => join.onRef('a.candidate_id', '=', 'm.candidate_id').onRef('a.job_id', '=', 'm.job_id'))
    .select(['m.id as match_id', 'm.job_id'])
    .where('m.candidate_id', '=', candidateId)
    .where('m.status', '!=', 'dismissed')
    .where('j.closed_at', 'is', null)
    .where('m.score', '>=', String(prefs.score_threshold))
    .where('a.id', 'is', null)
    .orderBy('m.score', 'desc').orderBy('m.created_at', 'desc')
    .limit(PREPARE_MAX).execute()
  if (rows.length === 0) return 0

  const resume = await db.selectFrom('candidate_resumes').select('id').where('candidate_id', '=', candidateId)
    .orderBy('is_primary', 'desc').orderBy('uploaded_at', 'desc').executeTakeFirst()
  const profile = scoringProfile(candidate) as RuleProfile

  let created = 0
  for (const r of rows) {
    const job = await loadJob(db, r.job_id)
    const kit = templateKit(job, profile, ruleScore(job, profile))
    // A recruiter may have started one for this pair since the query ran.
    const row = await db.insertInto('applications').values({
      candidate_id: candidateId,
      job_id: r.job_id,
      match_id: r.match_id,
      resume_id: resume?.id ?? null,
      ...kit,
    }).onConflict((oc) => oc.doNothing()).returning('id').executeTakeFirst()
    if (!row) continue
    await logEvent(db, row.id, 'created', null, { by: 'daily run' })
    await logEvent(db, row.id, 'kit_generated', null, { model: 'template' })
    created += 1
  }
  return created
}

/** Remove an application and its history. The match it came from stays. */
export async function deleteApplication(id: string): Promise<void> {
  const db = await getDb()
  const res = await db.deleteFrom('applications').where('id', '=', id).executeTakeFirst()
  if (Number(res.numDeletedRows) === 0) throw notFound('application')
}

interface Transition {
  from: Status[]
  to: Status
  event: string
  verb: string
}

const TRANSITIONS: Record<string, Transition> = {
  approve: { from: ['draft', 'needs_human'], to: 'approved', event: 'approved', verb: 'approve' },
  reopen: { from: ['approved', 'queued', 'needs_human', 'failed', 'withdrawn'], to: 'draft', event: 'reopened', verb: 'reopen' },
  'mark-submitted': { from: ['approved', 'queued', 'needs_human'], to: 'submitted', event: 'marked_submitted', verb: 'mark as submitted' },
  withdraw: { from: ['draft', 'approved', 'queued', 'needs_human', 'failed', 'submitted'], to: 'withdrawn', event: 'withdrawn', verb: 'withdraw' },
}

export const TRANSITION_ACTIONS = Object.keys(TRANSITIONS)

export async function transition(id: string, action: string) {
  const t = TRANSITIONS[action]
  if (!t) throw notFound('action')
  const db = await getDb()
  const actor = await defaultUserId(db)
  const row = await db.transaction().execute(async (trx) => {
    const app = await trx.selectFrom('applications').selectAll().where('id', '=', id).forUpdate().executeTakeFirst()
    if (!app) throw notFound('application')
    requireStatus(app, t.from, t.verb)
    const now = new Date()
    const patch =
      action === 'approve' ? { approved_by: actor, approved_at: now }
      : action === 'reopen' ? { approved_by: null, approved_at: null, failure_reason: null }
      : action === 'mark-submitted' ? { submitted_at: now }
      : {}
    const updated = await trx.updateTable('applications').set({ ...patch, status: t.to, updated_at: now })
      .where('id', '=', id).returningAll().executeTakeFirstOrThrow()
    await trx.insertInto('application_events').values({
      application_id: id,
      type: t.event,
      actor_id: actor,
      // Recorded so the trail shows a person, not the system, did the submitting.
      detail: jsonb(action === 'mark-submitted' ? { method: 'manual', from: app.status } : { from: app.status }),
    }).execute()
    return updated
  })
  return serialize(row)
}
