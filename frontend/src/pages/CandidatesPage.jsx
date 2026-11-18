import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { deleteCandidate, listCandidates } from '../api'
import { Loading, Spinner } from '../components/Field'
import HealthBanner from '../components/HealthBanner'
import Notice from '../components/Notice'
import StatusBadge from '../components/StatusBadge'
import { formatDate, monogram, tintFor } from '../format'

export default function CandidatesPage() {
  const [candidates, setCandidates] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(null) // candidate id being deleted
  const [actionError, setActionError] = useState(null)

  const remove = async (c) => {
    if (!window.confirm(`Delete ${c.full_name}? Their resumes, matches and applications are deleted too. This cannot be undone.`)) return
    setBusy(c.id)
    setActionError(null)
    try {
      await deleteCandidate(c.id)
      setCandidates((list) => list.filter((x) => x.id !== c.id))
    } catch (e) {
      setActionError(e.message)
    } finally {
      setBusy(null)
    }
  }

  useEffect(() => {
    let live = true
    listCandidates()
      .then((d) => { if (live) setCandidates(d.candidates || []) })
      .catch((e) => { if (live) setError(e.message) })
    return () => { live = false }
  }, [])

  return (
    <main className="jh-wrap rc-page">
      <div className="rc-page-head">
        <div>
          <h1 className="rc-title">Candidates</h1>
          <p className="rc-sub">Each candidate has a profile, job preferences, and their own matches and applications.</p>
        </div>
        <Link className="jh-btn" to="/candidates/new">Add candidate</Link>
      </div>

      <HealthBanner />
      {actionError && <Notice tone="error" className="rc-banner" onClose={() => setActionError(null)}>{actionError}</Notice>}

      <div className="jh-panel">
        {error && <div className="jh-error">Could not load candidates: {error}</div>}
        {!error && candidates === null && <Loading label="Loading candidates" />}
        {!error && candidates?.length === 0 && (
          <div className="jh-empty">
            <div className="jh-empty-title">No candidates yet</div>
            Choose “Add candidate” and upload a resume to create the first profile.
          </div>
        )}
        {candidates?.length > 0 && (
          <div className="rc-table-wrap">
            <table className="rc-table">
              <thead>
                <tr>
                  <th>Candidate</th>
                  <th className="rc-hide-sm">Location</th>
                  <th>Status</th>
                  <th className="rc-hide-sm">Resume</th>
                  <th className="num">New matches</th>
                  <th className="num">Applications</th>
                  <th className="rc-hide-sm">Updated</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {candidates.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <div className="rc-person">
                        <div className={`jh-mono t${tintFor(c.full_name)}`} aria-hidden="true">{monogram(c.full_name)}</div>
                        <div>
                          <Link className="rc-cell-title" to={`/candidates/${c.id}`}>{c.full_name}</Link>
                          <div className="rc-cell-sub">
                            {[c.current_title, c.current_company].filter(Boolean).join(' at ') || 'No current role set'}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="rc-hide-sm">{c.location || <span className="rc-muted">—</span>}</td>
                    <td><StatusBadge status={c.status} /></td>
                    <td className="rc-hide-sm">
                      {c.has_resume ? <span className="jh-badge teal">On file</span> : <span className="rc-muted">None</span>}
                    </td>
                    <td className="num">
                      {c.new_matches ? <Link to={`/candidates/${c.id}/matches`}><strong>{c.new_matches}</strong></Link> : <span className="rc-muted">0</span>}
                    </td>
                    <td className="num">
                      {c.applications ? <Link to={`/candidates/${c.id}/applications`}>{c.applications}</Link> : <span className="rc-muted">0</span>}
                    </td>
                    <td className="rc-hide-sm rc-muted">{formatDate(c.updated_at)}</td>
                    <td>
                      <div className="rc-actions rc-end">
                        <Link className="jh-btn jh-btn-ghost jh-btn-sm" to={`/candidates/${c.id}`}>Edit</Link>
                        <button className="jh-btn jh-btn-ghost jh-btn-sm rc-danger" onClick={() => remove(c)} disabled={busy !== null}>
                          {busy === c.id ? <Spinner /> : 'Delete'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  )
}
