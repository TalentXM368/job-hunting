// Open jobs as the search page and the matcher see them.

import { z } from 'zod'
import { getDb } from '../db/client.js'
import { iso, parseBody } from '../http.js'
import { parseDate, prefilter } from '../lib/prefilter.js'
import { locationSuggestions, titleSuggestions } from '../lib/suggest.js'
import { titleSearch, type MatchMode } from '../lib/titleSearch.js'

export interface OpenJob {
  id: string
  /** External id, "{ats}:{slug}:{id}". */
  job_id: string
  ats: string
  company: string
  company_id: string
  title: string
  location: string
  url: string
  description: string
  salary: string | null
  employment_type: string | null
  posted_at: string | null
}

// The title search ranks in memory and reads descriptions, so every search
// needs the full open set. Cache it per warm instance; ingest invalidates it.
const CACHE_TTL_MS = 5 * 60_000
let cache: { at: number; jobs: Promise<OpenJob[]> } | null = null

export function invalidateJobsCache(): void {
  cache = null
}

async function queryOpenJobs(): Promise<OpenJob[]> {
  const db = await getDb()
  const rows = await db.selectFrom('jobs').innerJoin('companies', 'companies.id', 'jobs.company_id')
    .select([
      'jobs.id', 'jobs.external_id', 'jobs.company_id', 'jobs.title', 'jobs.location', 'jobs.url',
      'jobs.description', 'jobs.salary', 'jobs.employment_type', 'jobs.posted_at',
      'companies.ats', 'companies.name as company',
    ])
    .where('jobs.closed_at', 'is', null).where('companies.is_active', '=', true)
    .execute()
  return rows.map((r) => ({
    id: r.id,
    job_id: r.external_id,
    ats: r.ats,
    company: r.company,
    company_id: r.company_id,
    title: r.title,
    location: r.location,
    url: r.url,
    description: r.description,
    salary: r.salary,
    employment_type: r.employment_type,
    posted_at: iso(r.posted_at),
  }))
}

export function loadOpenJobs(): Promise<OpenJob[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.jobs
  const entry = { at: Date.now(), jobs: queryOpenJobs() }
  cache = entry
  // A failed load must not be served from cache for five minutes.
  entry.jobs.catch(() => {
    if (cache === entry) cache = null
  })
  return entry.jobs
}

/** Newest first; postings with no date go last. */
export function sortByDate<T extends { posted_at: string | null }>(jobs: T[]): T[] {
  const time = (j: T) => parseDate(j.posted_at)?.getTime() ?? -Infinity
  return [...jobs].sort((a, b) => time(b) - time(a))
}

function employmentMatch(job: OpenJob, types: string[]): boolean {
  if (types.length === 0) return true
  const declared = (job.employment_type ?? '').toLowerCase()
  const hay = `${job.title} ${job.description}`.toLowerCase()
  return types.some((t) => {
    const tl = t.toLowerCase()
    if (declared && declared === tl) return true
    if (tl === 'full-time' && (hay.includes('full-time') || hay.includes('full time'))) return true
    return hay.includes(tl)
  })
}

const strings = z.array(z.string()).nullish().transform((v) => (v ?? []).map((s) => s.trim()).filter(Boolean))

const searchSchema = z.object({
  title: z.string().nullish().transform((v) => v ?? ''),
  locations: strings,
  allow_remote: z.boolean().nullish().transform((v) => v ?? true),
  max_age_days: z.number().int().min(0).max(3650).nullish().transform((v) => v ?? null),
  include_titles: strings,
  exclude_titles: strings,
  ats: strings,
  companies: strings,
  employment_types: strings,
  apply_include: z.boolean().nullish().transform((v) => v ?? false),
  apply_exclude: z.boolean().nullish().transform((v) => v ?? true),
  limit: z.number().int().nullish().transform((v) => Math.max(1, Math.min(100, v ?? 50))),
  offset: z.number().int().nullish().transform((v) => Math.max(0, v ?? 0)),
})

/**
 * The job search behind the search page. Nothing is filtered unless the
 * request asks for it: there are no hidden profile defaults.
 */
export async function search(body: unknown) {
  const p = parseBody(searchSchema, body)
  const all = await loadOpenJobs()
  const scanned = all.length
  const perBoard: Record<string, number> = {}
  for (const j of all) {
    const key = `${j.ats}:${j.company}`
    perBoard[key] = (perBoard[key] ?? 0) + 1
  }

  let jobs = all
  if (p.ats.length > 0) {
    const allowed = new Set(p.ats.map((a) => a.toLowerCase()))
    jobs = jobs.filter((j) => allowed.has(j.ats.toLowerCase()))
  }

  let matchMode: MatchMode = 'all'
  let afterTitle = scanned
  if (p.title.trim()) {
    const res = titleSearch(jobs, p.title)
    jobs = res.jobs
    matchMode = res.mode
    afterTitle = jobs.length
  }

  if (p.companies.length > 0) {
    const wanted = new Set(p.companies.map((c) => c.toLowerCase()))
    jobs = jobs.filter((j) => wanted.has(j.company.trim().toLowerCase()))
  }
  if (p.employment_types.length > 0) jobs = jobs.filter((j) => employmentMatch(j, p.employment_types))

  jobs = prefilter(jobs, {
    include_titles: p.apply_include ? p.include_titles : [],
    exclude_titles: p.apply_exclude ? p.exclude_titles : [],
    locations: p.locations,
    allow_remote: p.allow_remote,
    max_age_days: p.max_age_days,
  }).kept
  const afterPrefilter = jobs.length

  jobs = sortByDate(jobs)
  return {
    jobs: jobs.slice(p.offset, p.offset + p.limit),
    meta: {
      scanned,
      deduped: scanned,
      after_title: afterTitle,
      match_mode: matchMode,
      after_prefilter: afterPrefilter,
      total: jobs.length,
      limit: p.limit,
      offset: p.offset,
      per_board: perBoard,
    },
  }
}

const clampLimit = (limit: unknown): number => {
  const n = Number(limit)
  return Number.isFinite(n) ? Math.max(1, Math.min(10, Math.trunc(n))) : 6
}

export async function suggestTitles(q: string, limit: unknown): Promise<string[]> {
  const jobs = await loadOpenJobs().catch(() => [])
  return titleSuggestions(jobs.map((j) => j.title), q, clampLimit(limit))
}

export async function suggestLocations(q: string, limit: unknown): Promise<string[]> {
  const jobs = await loadOpenJobs().catch(() => [])
  return locationSuggestions(jobs.map((j) => j.location), q, clampLimit(limit))
}
