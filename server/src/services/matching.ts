// Score open jobs against one candidate and keep the results.
//
//   open jobs -> title gate -> location/age gate -> not yet screened -> LLM
//
// Everything before the LLM is deterministic and free. A (candidate, job)
// pair is screened once; the matches table is the record of that.

import type { Selectable } from 'kysely'
import { z } from 'zod'
import { getDb, type Candidate } from '../db/client.js'
import { HttpError, iso, notFound, num, parseBody } from '../http.js'
import { screen, type ScreenResult } from '../lib/llm.js'
import { compilePattern, prefilter } from '../lib/prefilter.js'
import { LLMError, resolve } from '../lib/providers.js'
import { ruleScore, type RuleProfile } from '../lib/rules.js'
import { matchesTargetTitle } from '../lib/titleSearch.js'
import { loadCandidate, loadPreferences, type ScoringProfile } from './candidates.js'
import { loadOpenJobs, sortByDate, type OpenJob } from './jobs.js'

export type Scorer = 'rules' | 'hybrid' | 'llm'

/**
 * SCORING_MODE decides what the LLM does:
 *   rules   never called; every job keeps its rule score
 *   hybrid  (default) rules on every job, then the LLM re-scores the top few
 *   llm     the LLM scores every screened job (the most tokens)
 */
export function scorerMode(): Scorer {
  const v = (process.env.SCORING_MODE ?? '').trim().toLowerCase()
  if (v === 'rules' || v === 'llm') return v
  if ((process.env.SCORER ?? '').trim().toLowerCase() === 'keyword') return 'rules'
  return 'hybrid'
}

/** In hybrid mode: how many of the best rule-scored jobs the LLM re-scores, and the floor they must clear. */
export function rescoreLimits(): { max: number; min: number } {
  const max = Number(process.env.LLM_RESCORE_MAX)
  const min = Number(process.env.LLM_RESCORE_MIN)
  return {
    max: Number.isFinite(max) && max >= 0 ? Math.min(40, Math.trunc(max)) : 10,
    min: Number.isFinite(min) && min >= 0 ? Math.min(10, min) : 5,
  }
}

/** The blob the screening model reads. Nulls are left out to save tokens. */
export function scoringProfile(c: Selectable<Candidate>, fallbackTargets: string[] = []): Record<string, unknown> {
  const p = (c.profile ?? {}) as Partial<ScoringProfile>
  const targets = p.target_titles?.length ? p.target_titles : fallbackTargets
  const all: Record<string, unknown> = {
    name: c.full_name,
    current_title: c.current_title,
    current_company: c.current_company,
    years_experience: num(c.years_experience),
    seniority: c.seniority,
    location: c.location,
    work_authorization: c.work_authorization,
    requires_sponsorship: c.requires_sponsorship,
    willing_to_relocate: c.willing_to_relocate,
    core_skills: p.core_skills ?? [],
    domains: p.domains ?? [],
    notable_projects: p.notable_projects ?? [],
    education: p.education || null,
    target_titles: targets,
  }
  return Object.fromEntries(Object.entries(all).filter(([, v]) => v != null && !(Array.isArray(v) && v.length === 0)))
}

export interface Gates {
  target_titles: string[]
  include_title_patterns: string[]
  exclude_title_patterns: string[]
  locations: string[]
  allow_remote: boolean
  max_age_days: number | null
}

/**
 * The free gates. A title passes when it matches an include regex or fits a
 * target title; with neither configured, every title passes. Exclusions,
 * location and age then apply as in prefilter.
 */
export function applyGates<T extends { title: string; location: string; posted_at: string | null }>(jobs: T[], g: Gates): T[] {
  const include = g.include_title_patterns.map(compilePattern).filter((p): p is RegExp => p !== null)
  const gated = include.length === 0 && g.target_titles.length === 0
    ? jobs
    : jobs.filter((j) => include.some((p) => p.test(j.title)) || matchesTargetTitle(j.title, g.target_titles))
  return prefilter(gated, {
    exclude_titles: g.exclude_title_patterns,
    locations: g.locations,
    allow_remote: g.allow_remote,
    max_age_days: g.max_age_days,
  }).kept
}

const matchRequest = z.object({
  limit: z.number().int().min(1).max(100).nullish().transform((v) => v ?? 40),
  /** Per-run override of the LLM step. Omit to follow SCORING_MODE. */
  use_llm: z.boolean().nullish(),
})

export async function runMatch(candidateId: string, body: unknown) {
  const { limit, use_llm } = parseBody(matchRequest, body)
  const db = await getDb()
  const candidate = await loadCandidate(db, candidateId)
  const prefs = await loadPreferences(db, candidateId)
  const profileTargets = ((candidate.profile ?? {}) as Partial<ScoringProfile>).target_titles ?? []
  const targets = prefs.target_titles.length > 0 ? prefs.target_titles : profileTargets

  const open = await loadOpenJobs()
  const passed = applyGates(open, { ...prefs, target_titles: targets })
  const seen = new Set((await db.selectFrom('matches').select('job_id').where('candidate_id', '=', candidateId).execute()).map((r) => r.job_id))
  const fresh = sortByDate(passed.filter((j) => !seen.has(j.id)))
  const batch = fresh.slice(0, limit)

  // Every job gets the free rule score first.
  const mode = scorerMode()
  const profile = scoringProfile(candidate, prefs.target_titles)
  const ruled = batch.map((job) => ({ job, rule: ruleScore(job, profile as RuleProfile) }))

  // Then the LLM, only where it earns its tokens: all jobs in "llm" mode, the
  // best few in "hybrid", none in "rules" or when no provider is configured.
  let llmJobs: typeof ruled = []
  const wantLlm = use_llm ?? mode !== 'rules'
  if (wantLlm && ruled.length > 0) {
    if (mode === 'llm') llmJobs = ruled
    else {
      const { max, min } = rescoreLimits()
      llmJobs = [...ruled].filter((r) => r.rule.score >= min).sort((a, b) => b.rule.score - a.rule.score).slice(0, max)
    }
  }

  let llmResults = new Map<string, ScreenResult>()
  let failedBatches = 0
  let llmModel: string | null = null
  let llmError: string | null = null
  if (llmJobs.length > 0) {
    let resolved
    try {
      resolved = resolve('screen')
    } catch (e) {
      if (!(e instanceof LLMError)) throw e
      // An explicit request for the LLM fails loudly; the default quietly keeps the rule scores.
      if (use_llm === true) throw new HttpError(503, e.message)
      llmError = e.message
      llmJobs = []
    }
    if (resolved) {
      llmModel = `${resolved.provider.name}/${resolved.model}`
      const outcome = await screen(llmJobs.map((r) => r.job), profile, resolved.provider, resolved.model)
      llmResults = outcome.results
      failedBatches = outcome.failedBatches
      if (outcome.errors.length > 0) llmError = outcome.errors[0] ?? null
    }
  }

  const now = new Date()
  const rows = ruled.map(({ job, rule }) => {
    const llm = llmResults.get(job.job_id)
    return {
      candidate_id: candidateId,
      job_id: job.id,
      rule_score: rule.score.toFixed(1),
      rule_reason: rule.reason,
      score: (llm ? llm.score : rule.score).toFixed(1),
      reason: llm ? llm.reason : rule.reason,
      model: llm ? `rules+${llmModel}` : 'rules',
      screened_at: now,
    }
  })
  if (rows.length > 0) {
    await db.insertInto('matches').values(rows)
      .onConflict((oc) => oc.columns(['candidate_id', 'job_id']).doNothing()).execute()
  }

  return {
    open_jobs: open.length,
    passed_filters: passed.length,
    already_matched: passed.length - fresh.length,
    screened: batch.length,
    scored: rows.length,
    llm_rescored: llmResults.size,
    llm_candidates: llmJobs.length,
    above_threshold: rows.filter((r) => Number(r.score) >= prefs.score_threshold).length,
    remaining: fresh.length - batch.length,
    failed_batches: failedBatches,
    scorer: mode,
    model: llmModel,
    llm_error: llmError,
  }
}

const STATUSES = ['new', 'shortlisted', 'dismissed'] as const

export async function listMatches(candidateId: string, status: string | undefined) {
  const db = await getDb()
  await loadCandidate(db, candidateId)
  let q = db.selectFrom('matches as m')
    .innerJoin('jobs as j', 'j.id', 'm.job_id')
    .innerJoin('companies as c', 'c.id', 'j.company_id')
    .leftJoin('applications as a', (join) => join.onRef('a.candidate_id', '=', 'm.candidate_id').onRef('a.job_id', '=', 'm.job_id'))
    .select([
      'm.id', 'm.candidate_id', 'm.status', 'm.score', 'm.reason', 'm.model', 'm.rule_score', 'm.rule_reason', 'm.screened_at', 'm.created_at',
      'j.id as job_uuid', 'j.external_id', 'j.company_id', 'j.title', 'j.location', 'j.url', 'j.description',
      'j.salary', 'j.employment_type', 'j.posted_at', 'j.closed_at',
      'c.ats', 'c.name as company',
      'a.id as application_id', 'a.status as application_status',
    ])
    .where('m.candidate_id', '=', candidateId)
  const wanted = STATUSES.find((s) => s === status)
  if (wanted) q = q.where('m.status', '=', wanted)
  const rows = await q.orderBy('m.score', (ob) => ob.desc().nullsLast()).orderBy('m.created_at', 'desc').limit(300).execute()
  return rows.map((r) => ({
    id: r.id,
    candidate_id: r.candidate_id,
    status: r.status,
    score: num(r.score),
    reason: r.reason,
    model: r.model,
    rule_score: num(r.rule_score),
    rule_reason: r.rule_reason,
    screened_at: iso(r.screened_at),
    created_at: iso(r.created_at),
    job: {
      id: r.job_uuid,
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
      closed_at: iso(r.closed_at),
    },
    application: r.application_id ? { id: r.application_id, status: r.application_status } : null,
  }))
}

const statusSchema = z.object({ status: z.enum(STATUSES) })

export async function updateMatch(matchId: string, body: unknown) {
  const { status } = parseBody(statusSchema, body)
  const db = await getDb()
  const row = await db.updateTable('matches').set({ status }).where('id', '=', matchId)
    .returning(['id', 'candidate_id', 'job_id', 'status', 'score', 'reason', 'model', 'screened_at', 'created_at'])
    .executeTakeFirst()
  if (!row) throw notFound('match')
  return { ...row, score: num(row.score), screened_at: iso(row.screened_at), created_at: iso(row.created_at) }
}
