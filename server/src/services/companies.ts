// Career boards to poll, and the ingest that copies their postings into the
// database so search and matching never wait on twelve HTTP calls.

import { sql, type Selectable } from 'kysely'
import { z } from 'zod'
import { getDb, type Company, type Database } from '../db/client.js'
import { HttpError, iso, mapLimit, notFound, num, parseBody } from '../http.js'
import { fetchBoard, type Ats, type Job } from '../lib/fetch.js'
import { parseDate } from '../lib/prefilter.js'
import { invalidateJobsCache } from './jobs.js'

// Seeded into an empty database. These are examples: companies migrate between
// ATS vendors and slugs go dead, which the Boards page shows as a non-200.
const DEFAULT_COMPANIES: { ats: Ats; slug: string; name: string }[] = [
  { ats: 'greenhouse', slug: 'stripe', name: 'Stripe' },
  { ats: 'greenhouse', slug: 'databricks', name: 'Databricks' },
  { ats: 'greenhouse', slug: 'cloudflare', name: 'Cloudflare' },
  { ats: 'greenhouse', slug: 'figma', name: 'Figma' },
  { ats: 'greenhouse', slug: 'dropbox', name: 'Dropbox' },
  { ats: 'greenhouse', slug: 'coinbase', name: 'Coinbase' },
  { ats: 'greenhouse', slug: 'reddit', name: 'Reddit' },
  { ats: 'lever', slug: 'voleon', name: 'Voleon' },
  { ats: 'ashby', slug: 'openai', name: 'OpenAI' },
  { ats: 'ashby', slug: 'ramp', name: 'Ramp' },
  { ats: 'ashby', slug: 'linear', name: 'Linear' },
  { ats: 'ashby', slug: 'vanta', name: 'Vanta' },
]

let seeded: Promise<void> | undefined

/** First run only: an empty companies table gets the default boards. */
export function ensureSeeded(db: Database): Promise<void> {
  seeded ??= (async () => {
    const row = await db.selectFrom('companies').select((eb) => eb.fn.countAll().as('n')).executeTakeFirstOrThrow()
    if (Number(row.n) > 0) return
    await db.insertInto('companies').values(DEFAULT_COMPANIES)
      .onConflict((oc) => oc.columns(['ats', 'slug']).doNothing()).execute()
  })()
  return seeded
}

/** Tests reset this between databases. */
export function resetSeedState(): void {
  seeded = undefined
}

type CompanyRow = Selectable<Company> & { open_jobs?: unknown }

function serialize(c: CompanyRow) {
  return {
    id: c.id,
    ats: c.ats,
    slug: c.slug,
    name: c.name,
    is_active: c.is_active,
    last_fetched_at: iso(c.last_fetched_at),
    last_http_status: c.last_http_status,
    last_job_count: c.last_job_count,
    open_jobs: num(c.open_jobs) ?? 0,
    created_at: iso(c.created_at),
  }
}

export async function listCompanies() {
  const db = await getDb()
  await ensureSeeded(db)
  const rows = await db.selectFrom('companies').selectAll('companies')
    .select((eb) => eb.selectFrom('jobs').select((e) => e.fn.countAll().as('n'))
      .whereRef('jobs.company_id', '=', 'companies.id').where('jobs.closed_at', 'is', null).as('open_jobs'))
    .orderBy('name').execute()
  return rows.map(serialize)
}

const createSchema = z.object({
  ats: z.enum(['greenhouse', 'lever', 'ashby']),
  // The slug goes into a URL path; keep it to what real board slugs contain.
  slug: z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9._-]+$/, 'use only letters, digits, dot, dash and underscore'),
  name: z.string().trim().max(120).optional(),
})

export async function createCompany(body: unknown) {
  const input = parseBody(createSchema, body)
  const db = await getDb()
  await ensureSeeded(db)
  const existing = await db.selectFrom('companies').select('id')
    .where('ats', '=', input.ats).where('slug', '=', input.slug).executeTakeFirst()
  if (existing) throw new HttpError(409, `${input.ats}/${input.slug} is already tracked`)
  const row = await db.insertInto('companies')
    .values({ ats: input.ats, slug: input.slug, name: input.name || input.slug })
    .returningAll().executeTakeFirstOrThrow()
  return serialize(row)
}

const updateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  is_active: z.boolean().optional(),
})

export async function updateCompany(id: string, body: unknown) {
  const input = parseBody(updateSchema, body)
  const db = await getDb()
  const patch: { name?: string; is_active?: boolean } = {}
  if (input.name !== undefined) patch.name = input.name
  if (input.is_active !== undefined) patch.is_active = input.is_active
  const row = Object.keys(patch).length > 0
    ? await db.updateTable('companies').set(patch).where('id', '=', id).returningAll().executeTakeFirst()
    : await db.selectFrom('companies').selectAll().where('id', '=', id).executeTakeFirst()
  if (!row) throw notFound('board')
  invalidateJobsCache()
  return serialize(row)
}

export async function deleteCompany(id: string): Promise<void> {
  const db = await getDb()
  const used = await db.selectFrom('applications').innerJoin('jobs', 'jobs.id', 'applications.job_id')
    .select((eb) => eb.fn.countAll().as('n')).where('jobs.company_id', '=', id).executeTakeFirstOrThrow()
  if (Number(used.n) > 0) {
    throw new HttpError(409, 'This board has jobs with applications. Deactivate it instead of deleting it.')
  }
  const res = await db.deleteFrom('companies').where('id', '=', id).executeTakeFirst()
  if (Number(res.numDeletedRows) === 0) throw notFound('board')
  invalidateJobsCache()
}

// ------------------------------------------------------------------ ingest --

export interface BoardIngest {
  company_id: string
  name: string
  ats: Ats
  slug: string
  ok: boolean
  http_status: number | null
  fetched: number
  error: string | null
  inserted: number
  updated: number
  closed: number
}

async function ingestOne(db: Database, c: Selectable<Company>, fetchImpl: typeof fetch): Promise<BoardIngest> {
  const runStart = new Date()
  const base = { company_id: c.id, name: c.name, ats: c.ats as Ats, slug: c.slug }
  const res = await fetchBoard(c.ats as Ats, c.slug, c.name, fetchImpl)
  if (!res.ok) {
    // A failed poll must not close the board's jobs: the board may be fine tomorrow.
    await db.updateTable('companies').set({ last_fetched_at: runStart, last_http_status: res.http_status })
      .where('id', '=', c.id).execute()
    return { ...base, ok: false, http_status: res.http_status, fetched: 0, error: res.error, inserted: 0, updated: 0, closed: 0 }
  }

  const unique = new Map<string, Job>()
  for (const j of res.jobs) {
    if (j.title && !unique.has(j.job_id)) unique.set(j.job_id, j)
  }
  const jobs = [...unique.values()]
  let inserted = 0
  let updated = 0
  for (let i = 0; i < jobs.length; i += 100) {
    const rows = await db.insertInto('jobs')
      .values(jobs.slice(i, i + 100).map((j) => ({
        external_id: j.job_id,
        company_id: c.id,
        title: j.title,
        location: j.location,
        url: j.url,
        description: j.description,
        salary: j.salary,
        employment_type: j.employment_type,
        posted_at: parseDate(j.posted_at),
        last_seen_at: runStart,
      })))
      .onConflict((oc) => oc.column('external_id').doUpdateSet((eb) => ({
        company_id: eb.ref('excluded.company_id'),
        title: eb.ref('excluded.title'),
        location: eb.ref('excluded.location'),
        url: eb.ref('excluded.url'),
        description: eb.ref('excluded.description'),
        salary: eb.ref('excluded.salary'),
        employment_type: eb.ref('excluded.employment_type'),
        posted_at: eb.ref('excluded.posted_at'),
        last_seen_at: eb.ref('excluded.last_seen_at'),
        closed_at: null,
      })))
      // xmax is 0 only for a row this statement inserted.
      .returning(sql<boolean>`(xmax = 0)`.as('inserted'))
      .execute()
    for (const r of rows) {
      if (r.inserted) inserted++
      else updated++
    }
  }
  // Anything this poll did not see has left the board.
  const closedRes = await db.updateTable('jobs').set({ closed_at: runStart })
    .where('company_id', '=', c.id).where('closed_at', 'is', null).where('last_seen_at', '<', runStart)
    .executeTakeFirst()
  await db.updateTable('companies')
    .set({ last_fetched_at: runStart, last_http_status: 200, last_job_count: jobs.length })
    .where('id', '=', c.id).execute()
  return { ...base, ok: true, http_status: 200, fetched: jobs.length, error: null, inserted, updated, closed: Number(closedRes.numUpdatedRows) }
}

export async function ingest(companyId?: string, fetchImpl: typeof fetch = fetch) {
  const db = await getDb()
  await ensureSeeded(db)
  const started = Date.now()
  const companies = companyId
    ? await db.selectFrom('companies').selectAll().where('id', '=', companyId).execute()
    : await db.selectFrom('companies').selectAll().where('is_active', '=', true).orderBy('name').execute()
  if (companyId && companies.length === 0) throw notFound('board')

  const boards = await mapLimit(companies, 4, (c) => ingestOne(db, c, fetchImpl))
  invalidateJobsCache()
  const sum = (key: 'fetched' | 'inserted' | 'updated' | 'closed') => boards.reduce((a, b) => a + b[key], 0)
  return {
    boards: boards.map(({ inserted: _i, updated: _u, closed: _c, ...b }) => b),
    scanned: sum('fetched'),
    inserted: sum('inserted'),
    updated: sum('updated'),
    closed: sum('closed'),
    duration_ms: Date.now() - started,
  }
}
