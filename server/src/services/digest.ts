// The per-candidate digest: the best current matches, with the kit where an
// application has one. Previewed in the browser or emailed to the recruiter.

import { getDb } from '../db/client.js'
import { HttpError, num } from '../http.js'
import { buildDigest, type DigestItem } from '../lib/digest.js'
import { mailConfig, sendMail } from '../lib/mailer.js'
import { loadCandidate, loadPreferences } from './candidates.js'

const MAX_ITEMS = 10

export async function candidateDigest(candidateId: string) {
  const db = await getDb()
  const candidate = await loadCandidate(db, candidateId)
  const prefs = await loadPreferences(db, candidateId)

  const rows = await db.selectFrom('matches as m')
    .innerJoin('jobs as j', 'j.id', 'm.job_id')
    .innerJoin('companies as c', 'c.id', 'j.company_id')
    .leftJoin('applications as a', (join) => join.onRef('a.candidate_id', '=', 'm.candidate_id').onRef('a.job_id', '=', 'm.job_id'))
    .select([
      'm.score', 'm.reason', 'j.external_id', 'j.title', 'j.location', 'j.url', 'c.name as company', 'c.ats',
      'a.fit_summary', 'a.tailored_bullets', 'a.gaps', 'a.cover_note', 'a.questions_to_ask', 'a.id as application_id',
    ])
    .where('m.candidate_id', '=', candidateId)
    .where('m.status', '!=', 'dismissed')
    .where('j.closed_at', 'is', null)
    .where('m.score', '>=', String(prefs.score_threshold))
    .orderBy('m.score', 'desc').orderBy('m.created_at', 'desc')
    .limit(MAX_ITEMS).execute()

  const items: DigestItem[] = rows.map((r) => ({
    job_id: r.external_id,
    title: r.title,
    company: r.company,
    location: r.location,
    ats: r.ats,
    url: r.url,
    score: num(r.score),
    reason: r.reason,
    kit: r.application_id ? {
      fit_summary: r.fit_summary ?? '',
      tailored_bullets: r.tailored_bullets ?? [],
      gaps: r.gaps ?? [],
      cover_note: r.cover_note ?? '',
      questions_to_ask: r.questions_to_ask ?? [],
    } : null,
  }))

  const count = async (table: 'matches' | 'applications') =>
    Number((await db.selectFrom(table).select((eb) => eb.fn.countAll().as('n')).where('candidate_id', '=', candidateId).executeTakeFirstOrThrow()).n)
  const open = await db.selectFrom('jobs').select((eb) => eb.fn.countAll().as('n')).where('closed_at', 'is', null).executeTakeFirstOrThrow()

  const digest = buildDigest(candidate.full_name, items, {
    open_jobs: Number(open.n),
    matches: await count('matches'),
    applications: await count('applications'),
  })
  return { ...digest, count: items.length }
}

export async function sendCandidateDigest(candidateId: string) {
  const digest = await candidateDigest(candidateId)
  const cfg = mailConfig()
  if (!cfg) {
    throw new HttpError(503, 'Email is not configured. Set SMTP_USER, SMTP_PASS and MAIL_TO, then try again.')
  }
  try {
    await sendMail(cfg, digest.subject, digest.html)
  } catch (e) {
    throw new HttpError(502, `The mail server refused the message: ${(e as Error).message}`)
  }
  return { sent: true, to: cfg.to, subject: digest.subject, count: digest.count }
}
