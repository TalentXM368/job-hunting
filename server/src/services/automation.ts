// The automation: everything that happens without a recruiter clicking.
//
// One run = refresh every active board, screen the new postings for every
// active candidate, prepare a draft application (with a template kit) for
// each match at or above the candidate's score threshold, and email the
// digest where SMTP is configured. The run stops at "draft": a recruiter
// still reviews, approves and applies on the company site. Nothing is ever
// submitted automatically.
//
// Triggers: Vercel Cron (GET /cron/daily), the in-process scheduler on a
// developer machine (see startScheduler), and the "Run now" button.

import { getDb } from '../db/client.js'
import { HttpError } from '../http.js'
import { mailConfig } from '../lib/mailer.js'
import { prepareApplications } from './applications.js'
import * as companies from './companies.js'
import { sendCandidateDigest } from './digest.js'
import * as matching from './matching.js'

export type Trigger = 'cron' | 'schedule' | 'manual'

export interface CandidateRun {
  candidate_id: string
  full_name: string
  screened: number
  above_threshold: number
  prepared: number
  emailed: boolean
  error: string | null
}

export interface RunSummary {
  trigger: Trigger
  started_at: string
  finished_at: string
  duration_ms: number
  ingest: { scanned: number; inserted: number; updated: number; closed: number; error: string | null }
  candidates: CandidateRun[]
  totals: { candidates: number; screened: number; above_threshold: number; prepared: number; emailed: number; failed: number }
}

const MAX_CANDIDATES = 25
const JOBS_PER_CANDIDATE = 24

let current: Promise<RunSummary> | null = null
let lastRun: RunSummary | null = null

export interface RunOptions {
  trigger: Trigger
  /** Tests serve the boards from fixtures. */
  fetchImpl?: typeof fetch
  /** Skip the board refresh (the UI offers it separately on the Boards page). */
  ingest?: boolean
}

/** Run the pipeline once. A second call while one is running joins it. */
export function runDaily(opts: RunOptions): Promise<RunSummary> {
  if (current) return current
  current = execute(opts).finally(() => { current = null })
  return current
}

export function isRunning(): boolean {
  return current !== null
}

export function lastRunSummary(): RunSummary | null {
  return lastRun
}

async function execute(opts: RunOptions): Promise<RunSummary> {
  const started = new Date()
  const summary: RunSummary = {
    trigger: opts.trigger,
    started_at: started.toISOString(),
    finished_at: started.toISOString(),
    duration_ms: 0,
    ingest: { scanned: 0, inserted: 0, updated: 0, closed: 0, error: null },
    candidates: [],
    totals: { candidates: 0, screened: 0, above_threshold: 0, prepared: 0, emailed: 0, failed: 0 },
  }

  // 1. Boards. A board that fails is recorded per company by ingest(); only
  //    a total failure (database down) lands here, and then we still screen
  //    against whatever jobs are already stored.
  if (opts.ingest !== false) {
    try {
      const r = await companies.ingest(undefined, opts.fetchImpl)
      summary.ingest = { scanned: r.scanned, inserted: r.inserted, updated: r.updated, closed: r.closed, error: null }
    } catch (e) {
      summary.ingest.error = (e as Error).message
    }
  }

  // 2. Every active candidate, most recently updated first.
  const db = await getDb()
  const active = await db.selectFrom('candidates').select(['id', 'full_name']).where('status', '=', 'active')
    .orderBy('updated_at', 'desc').limit(MAX_CANDIDATES).execute()
  const mail = mailConfig()

  for (const cand of active) {
    const row: CandidateRun = { candidate_id: cand.id, full_name: cand.full_name, screened: 0, above_threshold: 0, prepared: 0, emailed: false, error: null }
    try {
      // Rules on every new job; the LLM on the best few per SCORING_MODE.
      const match = await matching.runMatch(cand.id, { limit: JOBS_PER_CANDIDATE })
      row.screened = match.screened
      row.above_threshold = match.above_threshold
      // 3. A draft application with a template kit for every match worth
      //    applying to, so the recruiter opens Applications and finds the
      //    work queued up instead of starting from the match list.
      row.prepared = await prepareApplications(cand.id)
      // 4. The digest, only when there is something to read.
      if (mail && (row.above_threshold > 0 || row.prepared > 0)) {
        row.emailed = (await sendCandidateDigest(cand.id)).sent
      }
    } catch (e) {
      // One candidate failing (no profile, provider down) must not stop the rest.
      row.error = e instanceof HttpError ? e.message : (e as Error).message
    }
    summary.candidates.push(row)
  }

  const t = summary.totals
  t.candidates = summary.candidates.length
  for (const r of summary.candidates) {
    t.screened += r.screened
    t.above_threshold += r.above_threshold
    t.prepared += r.prepared
    if (r.emailed) t.emailed += 1
    if (r.error) t.failed += 1
  }
  const finished = new Date()
  summary.finished_at = finished.toISOString()
  summary.duration_ms = finished.getTime() - started.getTime()
  lastRun = summary
  return summary
}

// --------------------------------------------------------------- schedule --

/**
 * Local daily schedule. AUTO_RUN_HOUR is the hour of the day (0-23, local
 * time) the pipeline runs while the API process is up; "off" disables it.
 * Vercel has its own cron (vercel.json), so this is only started by dev.ts.
 */
export function scheduleConfig(): { enabled: boolean; hour: number | null; next_run_at: string | null } {
  const raw = (process.env.AUTO_RUN_HOUR ?? '8').trim().toLowerCase()
  if (raw === 'off' || raw === 'false' || raw === '') return { enabled: false, hour: null, next_run_at: null }
  const hour = Number(raw)
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return { enabled: false, hour: null, next_run_at: null }
  const next = new Date()
  next.setHours(hour, 0, 0, 0)
  if (next.getTime() <= Date.now()) next.setDate(next.getDate() + 1)
  return { enabled: true, hour, next_run_at: next.toISOString() }
}

let timer: NodeJS.Timeout | null = null
let lastScheduledDay = ''

/** Start the minute tick that fires the daily run. Returns the config. */
export function startScheduler(log: (msg: string) => void = console.log) {
  const cfg = scheduleConfig()
  if (!cfg.enabled) {
    log('automation: daily schedule is off (set AUTO_RUN_HOUR=8 to run every day at 08:00)')
    return cfg
  }
  log(`automation: boards refresh, matching and application prep run daily at ${String(cfg.hour).padStart(2, '0')}:00 while this process is up`)
  timer = setInterval(() => {
    const now = new Date()
    const day = now.toDateString()
    if (now.getHours() !== cfg.hour || lastScheduledDay === day || isRunning()) return
    lastScheduledDay = day
    runDaily({ trigger: 'schedule' })
      .then((s) => log(`automation: run finished in ${Math.round(s.duration_ms / 1000)}s: ${s.totals.candidates} candidates, ${s.totals.screened} jobs screened, ${s.totals.prepared} applications prepared`))
      .catch((e) => log(`automation: run failed: ${(e as Error).message}`))
  }, 60_000)
  timer.unref()
  return cfg
}

export function stopScheduler(): void {
  if (timer) clearInterval(timer)
  timer = null
}

export function status() {
  return { running: isRunning(), schedule: scheduleConfig(), last_run: lastRun }
}
