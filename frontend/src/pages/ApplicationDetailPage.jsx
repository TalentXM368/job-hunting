import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { applicationAction, deleteApplication, getApplication, updateApplication } from '../api'
import Field, { Loading, Section, Spinner } from '../components/Field'
import HealthBanner from '../components/HealthBanner'
import Notice from '../components/Notice'
import StatusBadge from '../components/StatusBadge'
import { atsLabel, formatDateLong, formatDateTime, linesToList, listToLines, monogram, textOrNull, tidyDescription, tintFor, wordCount } from '../format'
import { useHealth } from '../healthContext'
import { isEditable } from '../status'

function toForm(a) {
  return {
    fit_summary: a.fit_summary || '',
    tailored_bullets: listToLines(a.tailored_bullets),
    gaps: listToLines(a.gaps),
    cover_note: a.cover_note || '',
    questions_to_ask: listToLines(a.questions_to_ask),
    resume_id: a.resume_id || '',
  }
}

function toPayload(form) {
  return {
    fit_summary: textOrNull(form.fit_summary),
    tailored_bullets: linesToList(form.tailored_bullets),
    gaps: linesToList(form.gaps),
    cover_note: textOrNull(form.cover_note),
    questions_to_ask: linesToList(form.questions_to_ask),
    resume_id: form.resume_id || null,
  }
}

function hasKit(form) {
  return Boolean(form.fit_summary.trim() || form.tailored_bullets.trim() || form.gaps.trim() || form.cover_note.trim() || form.questions_to_ask.trim())
}

function eventTitle(type) {
  const t = (type || 'event').replace(/[._-]+/g, ' ')
  return t.charAt(0).toUpperCase() + t.slice(1)
}

function EventDetail({ detail }) {
  if (!detail || typeof detail !== 'object') return detail ? <div className="rc-event-detail">{String(detail)}</div> : null
  const entries = Object.entries(detail).filter(([, v]) => v != null && v !== '')
  if (entries.length === 0) return null
  return (
    <dl className="rc-event-detail">
      {entries.map(([k, v]) => (
        <div key={k}>
          <dt>{k.replace(/_/g, ' ')}</dt>
          <dd>{typeof v === 'object' ? JSON.stringify(v) : String(v)}</dd>
        </div>
      ))}
    </dl>
  )
}

function StatusNote({ application }) {
  const { status, failure_reason, submitted_at, proof_url } = application
  if (status === 'approved' || status === 'queued') {
    return <Notice tone="info">Approved. Automatic submission is not built yet: apply on the company site, then mark it submitted.</Notice>
  }
  if (status === 'needs_human') {
    return <Notice tone="warn">This application needs a person to finish it.{failure_reason ? ` ${failure_reason}` : ''}</Notice>
  }
  if (status === 'submitting') return <Notice tone="info">Submission is in progress.</Notice>
  if (status === 'submitted') {
    return (
      <Notice tone="success">
        Submitted{submitted_at ? ` on ${formatDateLong(submitted_at)}` : ''}.
        {proof_url && <> <a href={proof_url} target="_blank" rel="noreferrer">View proof of submission</a></>}
      </Notice>
    )
  }
  if (status === 'failed') return <Notice tone="error">Submission failed{failure_reason ? `: ${failure_reason}` : '.'}</Notice>
  if (status === 'withdrawn') return <Notice tone="info">This application was withdrawn. Reopen it to continue.</Notice>
  return null
}

export default function ApplicationDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { health } = useHealth()
  const [data, setData] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(null) // 'save' | 'draft' | 'approve' | 'reopen' | 'mark-submitted' | 'withdraw'
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)

  const load = useCallback(async () => {
    const fresh = await getApplication(id)
    setData(fresh)
    setForm(toForm(fresh.application))
  }, [id])

  useEffect(() => {
    setData(null)
    setForm(null)
    setLoadError(null)
    load().catch((e) => setLoadError(e.message))
  }, [load])

  const dirty = useMemo(
    () => Boolean(data && form && JSON.stringify(form) !== JSON.stringify(toForm(data.application))),
    [data, form],
  )

  if (loadError) {
    return (
      <main className="jh-wrap rc-page">
        <Link className="rc-back" to="/applications">← All applications</Link>
        <div className="jh-panel"><div className="jh-error">Could not load this application: {loadError}</div></div>
      </main>
    )
  }
  if (!data || !form) {
    return <main className="jh-wrap rc-page"><div className="jh-panel"><Loading label="Loading application" /></div></main>
  }

  const { application, candidate, job, resumes = [], events = [] } = data
  const editable = isEditable(application.status)
  const llmOk = Boolean(health?.llm?.configured)
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  // Runs one mutation, then re-reads the application so status and the event
  // timeline reflect what the server recorded.
  const run = async (key, fn, done) => {
    setBusy(key)
    setError(null)
    setNotice(null)
    try {
      await fn()
      await load()
      if (done) setNotice(done)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(null)
    }
  }

  const save = () => run('save', () => updateApplication(id, toPayload(form)), 'Kit saved.')

  // The template kit is free and instant; the AI kit costs tokens and reads better.
  const generate = (useLlm) => {
    if (hasKit(form) && !window.confirm('Generate a new kit? This replaces the summary, bullets, gaps, cover note and questions below.')) return
    run(useLlm ? 'ai' : 'draft', async () => {
      // Keep an unsaved resume choice: only resume_id survives a regenerate.
      if (dirty) await updateApplication(id, { resume_id: form.resume_id || null })
      await applicationAction(id, 'draft', useLlm ? { use_llm: true } : {})
    }, useLlm
      ? 'Kit drafted by the model. Check every claim against the candidate before approving.'
      : 'Template kit generated from the profile and the posting. Edit it into something a person would send.')
  }

  const approve = () => run('approve', async () => {
    if (dirty) await updateApplication(id, toPayload(form))
    await applicationAction(id, 'approve')
  })

  const act = (action, done, confirmText) => {
    if (confirmText && !window.confirm(confirmText)) return
    run(action, () => applicationAction(id, action), done)
  }

  const remove = async () => {
    if (!window.confirm('Delete this application and its history? The match stays, so it can be started again. This cannot be undone.')) return
    setBusy('delete')
    setError(null)
    try {
      await deleteApplication(id)
      navigate('/applications')
    } catch (e) {
      setError(e.message)
      setBusy(null)
    }
  }

  const label = (key, idle, working) => (busy === key ? <><Spinner /> {working}</> : idle)
  const coverWords = wordCount(form.cover_note)

  return (
    <main className="jh-wrap rc-page">
      <Link className="rc-back" to="/applications">← All applications</Link>
      <div className="rc-page-head">
        <div className="rc-person">
          <div className={`jh-mono lg t${tintFor(job?.company)}`} aria-hidden="true">{monogram(job?.company)}</div>
          <div>
            <h1 className="rc-title">{job?.title || 'Untitled role'}</h1>
            <p className="rc-sub">
              {[job?.company, job?.location, atsLabel(job?.ats)].filter(Boolean).join(' · ')}
            </p>
            <p className="rc-sub">
              For {candidate ? <Link to={`/candidates/${candidate.id}`}>{candidate.full_name}</Link> : 'an unknown candidate'}
              {job?.url && <> · <a href={job.url} target="_blank" rel="noreferrer">View posting ↗</a></>}
            </p>
          </div>
        </div>
        <StatusBadge status={application.status} />
      </div>

      <HealthBanner />

      <div className="rc-app-layout">
        <div className="rc-stack">
          <StatusNote application={application} />
          {error && <Notice tone="error" onClose={() => setError(null)}>{error}</Notice>}
          {notice && <Notice tone="success" onClose={() => setNotice(null)}>{notice}</Notice>}

          <div className="jh-panel rc-panel-pad">
            <Section
              title="Application kit"
              sub={editable
                ? 'Drafts are starting points. Check every claim is true of the candidate before approving.'
                : 'Read-only. Reopen the application to edit it.'}
            >
              <div className="rc-grid">
                <Field label="Why it fits" htmlFor="a-fit" wide>
                  <textarea id="a-fit" className="jh-input rc-textarea" rows={3} value={form.fit_summary} onChange={set('fit_summary')} readOnly={!editable} />
                </Field>
                <Field label="Resume bullets for this role" htmlFor="a-bullets" wide hint="One per line.">
                  <textarea id="a-bullets" className="jh-input rc-textarea" rows={5} value={form.tailored_bullets} onChange={set('tailored_bullets')} readOnly={!editable} />
                </Field>
                <Field label="Honest gaps" htmlFor="a-gaps" wide hint="One per line.">
                  <textarea id="a-gaps" className="jh-input rc-textarea" rows={3} value={form.gaps} onChange={set('gaps')} readOnly={!editable} />
                </Field>
                <Field
                  label="Cover note"
                  htmlFor="a-cover"
                  wide
                  hint={`${coverWords} ${coverWords === 1 ? 'word' : 'words'}. Aim for 120 to 160.`}
                >
                  <textarea id="a-cover" className="jh-input rc-textarea" rows={9} value={form.cover_note} onChange={set('cover_note')} readOnly={!editable} />
                </Field>
                <Field label="Questions to ask" htmlFor="a-questions" wide hint="One per line.">
                  <textarea id="a-questions" className="jh-input rc-textarea" rows={3} value={form.questions_to_ask} onChange={set('questions_to_ask')} readOnly={!editable} />
                </Field>
                <Field label="Resume to send" htmlFor="a-resume" wide hint={resumes.length === 0 ? 'This candidate has no resume on file. Upload one on their profile.' : undefined}>
                  <select id="a-resume" className="jh-input" value={form.resume_id} onChange={set('resume_id')} disabled={!editable || resumes.length === 0}>
                    <option value="">No resume selected</option>
                    {resumes.map((r) => <option key={r.id} value={r.id}>{r.file_name}{r.is_primary ? ' (primary)' : ''}</option>)}
                  </select>
                </Field>
              </div>
            </Section>

            <div className="rc-savebar">
              {editable ? (
                <>
                  <div className="rc-actions">
                    <button className="jh-btn jh-btn-ghost" onClick={() => generate(false)} disabled={busy !== null} title="Builds a kit from the profile and the posting with no LLM call.">
                      {label('draft', hasKit(form) ? 'Regenerate template' : 'Generate template kit', 'Generating')}
                    </button>
                    {llmOk && (
                      <button className="jh-btn jh-btn-ghost" onClick={() => generate(true)} disabled={busy !== null} title="Asks the LLM to write the kit. Costs tokens.">
                        {label('ai', 'Draft with AI', 'Drafting')}
                      </button>
                    )}
                  </div>
                  <div className="rc-actions">
                    {dirty && <span className="rc-muted">Unsaved changes</span>}
                    <button className="jh-btn jh-btn-ghost" onClick={save} disabled={busy !== null || !dirty}>{label('save', 'Save', 'Saving')}</button>
                    <button className="jh-btn" onClick={approve} disabled={busy !== null}>{label('approve', dirty ? 'Save and approve' : 'Approve', 'Approving')}</button>
                  </div>
                </>
              ) : (
                <>
                  <span />
                  <div className="rc-actions">
                    {(application.status === 'approved' || application.status === 'queued') && (
                      <>
                        {job?.url && <a className="jh-btn jh-btn-ghost" href={job.url} target="_blank" rel="noreferrer">Open posting</a>}
                        <button className="jh-btn jh-btn-ghost" onClick={() => act('withdraw', 'Application withdrawn.', 'Withdraw this application?')} disabled={busy !== null}>{label('withdraw', 'Withdraw', 'Withdrawing')}</button>
                        <button className="jh-btn jh-btn-ghost" onClick={() => act('reopen', 'Reopened as a draft.')} disabled={busy !== null}>{label('reopen', 'Reopen', 'Reopening')}</button>
                        <button className="jh-btn" onClick={() => act('mark-submitted', 'Marked as submitted.', 'Mark this as submitted? Do this only after you have applied on the company site.')} disabled={busy !== null}>{label('mark-submitted', 'Mark submitted', 'Saving')}</button>
                      </>
                    )}
                    {(application.status === 'failed' || application.status === 'withdrawn') && (
                      <button className="jh-btn" onClick={() => act('reopen', 'Reopened as a draft.')} disabled={busy !== null}>{label('reopen', 'Reopen', 'Reopening')}</button>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>

          <details className="jh-panel rc-details">
            <summary>Job description</summary>
            <div className="rc-details-body">{tidyDescription(job?.description) || 'No description was provided for this posting.'}</div>
          </details>
        </div>

        <aside className="jh-panel rc-panel-pad rc-side">
          <h2 className="rc-section-title">History</h2>
          {events.length === 0 ? (
            <p className="rc-empty-line">Nothing recorded yet.</p>
          ) : (
            <ol className="rc-timeline">
              {events.map((ev) => (
                <li key={ev.id}>
                  <div className="rc-event-title">{eventTitle(ev.type)}</div>
                  <div className="rc-cell-sub">{ev.actor || 'System'} · {formatDateTime(ev.created_at)}</div>
                  <EventDetail detail={ev.detail} />
                </li>
              ))}
            </ol>
          )}
          <div className="rc-actions" style={{ marginTop: 12 }}>
            <button className="jh-btn jh-btn-ghost jh-btn-sm rc-danger" onClick={remove} disabled={busy !== null}>
              {label('delete', 'Delete application', 'Deleting')}
            </button>
          </div>
          <dl className="rc-kv">
            <div><dt>Created</dt><dd>{formatDateTime(application.created_at)}</dd></div>
            {application.approved_at && <div><dt>Approved</dt><dd>{formatDateTime(application.approved_at)}</dd></div>}
            {application.submitted_at && <div><dt>Submitted</dt><dd>{formatDateTime(application.submitted_at)}</dd></div>}
            {job?.job_id && <div><dt>Job ID</dt><dd className="jh-code">{job.job_id}</dd></div>}
          </dl>
        </aside>
      </div>
    </main>
  )
}
