import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { createApplication, digestPreviewUrl, listMatches, runMatch, sendDigest, updateMatch } from '../../api'
import { Loading, Spinner } from '../../components/Field'
import Notice from '../../components/Notice'
import StatusBadge, { ScoreBadge } from '../../components/StatusBadge'
import { atsLabel, formatDate, plural } from '../../format'
import { useHealth } from '../../healthContext'

const FILTERS = [
  { value: 'new', label: 'New' },
  { value: 'shortlisted', label: 'Shortlisted' },
  { value: 'dismissed', label: 'Dismissed' },
  { value: 'all', label: 'All' },
]

function byScore(a, b) {
  const sa = a.score == null ? -1 : Number(a.score)
  const sb = b.score == null ? -1 : Number(b.score)
  return sb - sa
}

function runSummary(r) {
  const parts = [
    plural(r.open_jobs ?? 0, 'open job'),
    `${r.passed_filters ?? 0} passed filters`,
  ]
  if (r.already_matched) parts.push(`${r.already_matched} already matched`)
  parts.push(`${r.screened ?? 0} scored by rules`)
  if (r.llm_rescored) parts.push(`${r.llm_rescored} re-scored by ${r.model || 'the model'}`)
  parts.push(`${r.above_threshold ?? 0} at or above threshold`)
  if (r.remaining) parts.push(`${r.remaining} more waiting for the next run`)
  return parts.join(', ')
}

export default function MatchesTab({ candidateId }) {
  const navigate = useNavigate()
  const { health } = useHealth()
  const llmOk = Boolean(health?.llm?.configured)
  const [verify, setVerify] = useState(true)
  const [filter, setFilter] = useState('new')
  const [matches, setMatches] = useState(null)
  const [error, setError] = useState(null)

  const [limit, setLimit] = useState('')
  const [running, setRunning] = useState(false)
  const [runResult, setRunResult] = useState(null)
  const [runError, setRunError] = useState(null)

  const [digestBusy, setDigestBusy] = useState(false)
  const [digestNotice, setDigestNotice] = useState(null) // { tone, text }

  const [rowBusy, setRowBusy] = useState(null) // match id
  const [rowError, setRowError] = useState(null)

  const load = useCallback(async (status) => {
    setError(null)
    try {
      const d = await listMatches(candidateId, status)
      setMatches([...(d.matches || [])].sort(byScore))
    } catch (e) {
      setError(e.message)
      setMatches([])
    }
  }, [candidateId])

  useEffect(() => {
    setMatches(null)
    load(filter)
  }, [filter, load])

  const findMatches = async () => {
    const n = limit === '' ? undefined : Number(limit)
    if (n !== undefined && (!Number.isInteger(n) || n < 1 || n > 100)) {
      setRunError('“Max jobs to screen” must be a whole number from 1 to 100, or left empty for 40.')
      return
    }
    setRunning(true)
    setRunError(null)
    setRunResult(null)
    try {
      // Unticked: rules only for this run. Ticked: follow the server's scoring mode.
      setRunResult(await runMatch(candidateId, { ...(n ? { limit: n } : {}), ...(llmOk && !verify ? { use_llm: false } : {}) }))
      await load(filter)
    } catch (e) {
      setRunError(e.message)
    } finally {
      setRunning(false)
    }
  }

  const emailDigest = async () => {
    setDigestBusy(true)
    setDigestNotice(null)
    try {
      const r = await sendDigest(candidateId)
      setDigestNotice(r.sent
        ? { tone: 'success', text: `Digest sent to ${r.to || 'the configured address'}: “${r.subject}” (${plural(r.count ?? 0, 'job')}).` }
        : { tone: 'warn', text: `Digest was not sent${r.subject ? `: “${r.subject}”` : ''}. Check that email is configured on the server.` })
    } catch (e) {
      setDigestNotice({ tone: 'error', text: e.message })
    } finally {
      setDigestBusy(false)
    }
  }

  const setStatus = async (m, status) => {
    setRowBusy(m.id)
    setRowError(null)
    try {
      const { match } = await updateMatch(m.id, status)
      const next = match?.status || status
      setMatches((list) => (
        filter !== 'all' && next !== filter
          ? list.filter((x) => x.id !== m.id)
          : list.map((x) => (x.id === m.id ? { ...x, status: next } : x))
      ))
    } catch (e) {
      setRowError(e.message)
    } finally {
      setRowBusy(null)
    }
  }

  const startApplication = async (m) => {
    setRowBusy(m.id)
    setRowError(null)
    try {
      const { application } = await createApplication({ candidate_id: candidateId, job_id: m.job.id, match_id: m.id })
      navigate(`/applications/${application.id}`)
    } catch (e) {
      setRowError(e.message)
      setRowBusy(null)
    }
  }

  return (
    <div className="rc-stack">
      <div className="jh-panel rc-panel-pad">
        <div className="rc-runbar">
          <div className="rc-actions">
            <button className="jh-btn" onClick={findMatches} disabled={running}>
              {running ? <><Spinner /> Finding matches</> : 'Find matches'}
            </button>
            <label className="rc-inline-label">
              Max jobs to screen
              <input className="jh-input rc-num" type="number" min="1" max="100" step="1" value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="40" disabled={running} />
            </label>
            {llmOk && (
              <label className="rc-inline-label" title={`Rules score every job for free. The model then re-scores at most ${health?.llm?.rescore?.max ?? 10} of the best, those scoring ${health?.llm?.rescore?.min ?? 5} or more.`}>
                <input type="checkbox" checked={verify} onChange={(e) => setVerify(e.target.checked)} disabled={running} /> Verify top matches with AI
              </label>
            )}
          </div>
          <div className="rc-actions">
            <a className="jh-btn jh-btn-ghost jh-btn-sm" href={digestPreviewUrl(candidateId)} target="_blank" rel="noreferrer">Preview digest</a>
            <button className="jh-btn jh-btn-ghost jh-btn-sm" onClick={emailDigest} disabled={digestBusy}>
              {digestBusy ? <><Spinner /> Sending</> : 'Email digest'}
            </button>
          </div>
        </div>
        <p className="rc-hint rc-runbar-hint">
          Filters open jobs with this candidate’s preferences, then scores the ones not yet matched with rules (title fit, skills, seniority, blockers). AI verification, when on, only re-scores the best few.
        </p>
        {runError && <Notice tone="error" onClose={() => setRunError(null)}>{runError}</Notice>}
        {runResult && (
          <Notice tone={runResult.failed_batches ? 'warn' : 'success'} onClose={() => setRunResult(null)}>
            {runSummary(runResult)}.
            {runResult.failed_batches ? ` ${plural(runResult.failed_batches, 'screening batch', 'screening batches')} failed and will be retried on the next run.` : ''}
            {runResult.llm_error ? ` AI verification was skipped: ${runResult.llm_error}` : ''}
          </Notice>
        )}
        {digestNotice && <Notice tone={digestNotice.tone} onClose={() => setDigestNotice(null)}>{digestNotice.text}</Notice>}
      </div>

      <div className="jh-panel">
        <div className="jh-panel-head rc-panel-head-wrap">
          <span>{matches ? <><strong>{matches.length}</strong> {matches.length === 1 ? 'match' : 'matches'}</> : <strong>Matches</strong>}</span>
          <div className="rc-seg" role="group" aria-label="Filter matches by status">
            {FILTERS.map((f) => (
              <button key={f.value} className={`rc-seg-btn ${filter === f.value ? 'active' : ''}`} onClick={() => setFilter(f.value)} aria-pressed={filter === f.value}>
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {rowError && <Notice tone="error" className="rc-in-panel" onClose={() => setRowError(null)}>{rowError}</Notice>}
        {error && <div className="jh-error">Could not load matches: {error}</div>}
        {matches === null && <Loading label="Loading matches" />}
        {!error && matches?.length === 0 && (
          <div className="jh-empty">
            <div className="jh-empty-title">{filter === 'all' ? 'No matches yet' : `No ${filter} matches`}</div>
            {filter === 'all' || filter === 'new'
              ? 'Set the job preferences, then choose Find matches to score open jobs against this profile.'
              : 'Matches you move here will show up in this list.'}
          </div>
        )}

        {matches?.map((m) => {
          const busy = rowBusy === m.id
          const job = m.job || {}
          return (
            <div key={m.id} className="rc-match">
              <ScoreBadge score={m.score} />
              <div className="rc-match-main">
                <div className="rc-match-top">
                  <a className="rc-cell-title" href={job.url} target="_blank" rel="noreferrer">{job.title || 'Untitled role'}</a>
                  <StatusBadge status={m.status} />
                </div>
                <div className="rc-cell-sub">
                  {[job.company, job.location, job.posted_at ? formatDate(job.posted_at) : null, atsLabel(job.ats)].filter(Boolean).join(' · ')}
                </div>
                {m.reason && <p className="rc-match-reason">{m.reason}</p>}
                <div className="rc-actions rc-match-actions">
                  {m.application ? (
                    <Link className="jh-btn jh-btn-sm" to={`/applications/${m.application.id}`}>Open application</Link>
                  ) : (
                    <button className="jh-btn jh-btn-sm" onClick={() => startApplication(m)} disabled={busy}>
                      {busy ? <Spinner /> : 'Start application'}
                    </button>
                  )}
                  {m.application && <StatusBadge status={m.application.status} />}
                  {m.status !== 'shortlisted' && (
                    <button className="jh-btn jh-btn-ghost jh-btn-sm" onClick={() => setStatus(m, 'shortlisted')} disabled={busy}>Shortlist</button>
                  )}
                  {m.status !== 'dismissed' && (
                    <button className="jh-btn jh-btn-ghost jh-btn-sm" onClick={() => setStatus(m, 'dismissed')} disabled={busy}>Dismiss</button>
                  )}
                  {m.status !== 'new' && (
                    <button className="jh-btn jh-btn-ghost jh-btn-sm" onClick={() => setStatus(m, 'new')} disabled={busy}>Restore</button>
                  )}
                  <span className="rc-match-meta">
                    {m.model?.startsWith('rules+')
                      ? `AI-verified by ${m.model.slice(6)}${m.rule_score != null && m.rule_score !== m.score ? ` (rules said ${Number(m.rule_score).toFixed(1)})` : ''}`
                      : m.model === 'rules' ? 'Scored by rules' : m.model || ''}
                  </span>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
