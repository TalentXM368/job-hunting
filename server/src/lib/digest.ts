// Build the HTML digest for one candidate. Inline CSS only: Gmail strips
// <style> blocks.

import type { DraftKit } from './llm.js'

const BG = '#0f1115'
const CARD = '#171a21'
const LINE = '#262b36'
const TEXT = '#e6e8ec'
const MUTED = '#8b93a3'
const ACCENT = '#7c9cff'

export interface DigestItem {
  job_id: string
  title: string
  company: string
  location: string
  ats: string
  url: string
  score: number | null
  reason: string | null
  kit: Partial<DraftKit> | null
}

export interface DigestStats {
  open_jobs: number
  matches: number
  applications: number
}

const esc = (s: unknown): string =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;')

/** Only http(s) links may reach an href; anything else becomes "#". */
const safeUrl = (u: string): string => (/^https?:\/\//i.test(u) ? esc(u) : '#')

function badge(score: number | null): string {
  const s = score ?? 0
  const color = s >= 8.5 ? '#3fb950' : s >= 7 ? '#d29922' : '#8b949e'
  return `<span style="background:${color};color:#0f1115;font-weight:700;padding:3px 9px;border-radius:999px;font-size:13px;">${s.toFixed(1)}</span>`
}

function bullets(items: string[] | undefined): string {
  if (!items || items.length === 0) return ''
  const lis = items.map((i) => `<li style="margin:0 0 6px 0;color:${TEXT};font-size:14px;line-height:1.5;">${esc(i)}</li>`).join('')
  return `<ul style="margin:8px 0 0 0;padding-left:18px;">${lis}</ul>`
}

function section(label: string, body: string): string {
  if (!body) return ''
  return `<div style="margin-top:14px;"><div style="color:${MUTED};font-size:11px;letter-spacing:.09em;text-transform:uppercase;font-weight:700;">${label}</div>${body}</div>`
}

const para = (t: string | null | undefined): string =>
  t ? `<p style="margin:8px 0 0 0;color:${TEXT};font-size:14px;line-height:1.6;">${esc(t)}</p>` : ''

function card(j: DigestItem): string {
  const d = j.kit ?? {}
  const meta = [j.company, j.location || '—', j.ats].filter(Boolean).join(' · ')
  const cover = d.cover_note
    ? section('Cover note (edit before sending)',
        `<div style="margin-top:8px;padding:12px;background:#0d1017;border:1px solid ${LINE};border-radius:8px;color:${TEXT};font-size:14px;line-height:1.6;white-space:pre-wrap;">${esc(d.cover_note)}</div>`)
    : ''
  return `
<div style="background:${CARD};border:1px solid ${LINE};border-radius:12px;padding:18px;margin-bottom:14px;">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;">
    <div style="font-size:17px;font-weight:700;color:${TEXT};">${esc(j.title)}</div>
    <div style="padding-left:12px;">${badge(j.score)}</div>
  </div>
  <div style="color:${MUTED};font-size:13px;margin-top:5px;">${esc(meta)}</div>
  ${para(j.reason)}
  ${section('Why it fits', para(d.fit_summary))}
  ${section('Resume bullets for this role', bullets(d.tailored_bullets))}
  ${section('Honest gaps', bullets(d.gaps))}
  ${cover}
  ${section('Ask them', bullets(d.questions_to_ask))}
  <div style="margin-top:16px;">
    <a href="${safeUrl(j.url)}" style="display:inline-block;background:${ACCENT};color:#0f1115;font-weight:700;font-size:14px;text-decoration:none;padding:10px 18px;border-radius:8px;">Open posting →</a>
    <span style="color:${MUTED};font-size:11px;margin-left:10px;">${esc(j.job_id)}</span>
  </div>
</div>`
}

export function buildDigest(candidateName: string, items: DigestItem[], stats: DigestStats, now: Date = new Date()): { subject: string; html: string } {
  const today = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  const n = items.length
  const subject = n > 0
    ? `${n} job${n !== 1 ? 's' : ''} worth applying to for ${candidateName} — ${today}`
    : `No new matches for ${candidateName} — ${today}`

  const body = n > 0
    ? items.map(card).join('')
    : `<div style="background:${CARD};border:1px solid ${LINE};border-radius:12px;padding:24px;color:${MUTED};font-size:14px;">Nothing cleared the score threshold. Run matching again after the boards refresh, or lower the threshold in this candidate's job preferences.</div>`

  const html = `<!doctype html><html><body style="margin:0;padding:20px;background:${BG};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<div style="max-width:640px;margin:0 auto;">
  <div style="color:${TEXT};font-size:22px;font-weight:800;">Job digest: ${esc(candidateName)}</div>
  <div style="color:${MUTED};font-size:13px;margin:6px 0 20px 0;">
    ${today} · ${stats.open_jobs} open postings tracked · ${n} made the cut<br>
    ${stats.matches} jobs screened for this candidate · ${stats.applications} applications
  </div>
  ${body}
  <div style="color:${MUTED};font-size:11px;line-height:1.6;margin-top:18px;border-top:1px solid ${LINE};padding-top:14px;">
    Drafts are starting points, not send-ready. Read the JD, check every claim
    against the candidate's real experience, then approve the application.
  </div>
</div></body></html>`
  return { subject, html }
}
