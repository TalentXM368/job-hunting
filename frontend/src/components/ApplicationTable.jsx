import { useState } from 'react'
import { Link } from 'react-router-dom'
import { deleteApplication } from '../api'
import { atsLabel, formatDate } from '../format'
import { Spinner } from './Field'
import StatusBadge, { ScoreBadge } from './StatusBadge'

// Shared by the all-applications page and a candidate's Applications tab.
// `onDeleted(id)` lets the parent drop the row; `onError(message)` shows a failure.
export default function ApplicationTable({ applications, showCandidate = true, onDeleted, onError }) {
  const [busy, setBusy] = useState(null)

  const remove = async (a) => {
    const what = `${a.job?.title || 'this application'}${a.candidate ? ` for ${a.candidate.full_name}` : ''}`
    if (!window.confirm(`Delete the application to ${what}? Its history is deleted too. This cannot be undone.`)) return
    setBusy(a.id)
    try {
      await deleteApplication(a.id)
      onDeleted?.(a.id)
    } catch (e) {
      onError?.(e.message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="rc-table-wrap">
      <table className="rc-table">
        <thead>
          <tr>
            <th>Role</th>
            {showCandidate && <th>Candidate</th>}
            <th>Status</th>
            <th className="num">Score</th>
            <th className="rc-hide-sm">Updated</th>
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {applications.map((a) => (
            <tr key={a.id}>
              <td>
                <Link className="rc-cell-title" to={`/applications/${a.id}`}>{a.job?.title || 'Untitled role'}</Link>
                <div className="rc-cell-sub">
                  {[a.job?.company, a.job?.location, atsLabel(a.job?.ats)].filter(Boolean).join(' · ')}
                </div>
              </td>
              {showCandidate && (
                <td>
                  {a.candidate ? <Link to={`/candidates/${a.candidate.id}`}>{a.candidate.full_name}</Link> : '—'}
                </td>
              )}
              <td><StatusBadge status={a.status} /></td>
              <td className="num"><ScoreBadge score={a.score} /></td>
              <td className="rc-hide-sm rc-muted">{formatDate(a.updated_at)}</td>
              <td>
                <div className="rc-actions rc-end">
                  <Link className="jh-btn jh-btn-ghost jh-btn-sm" to={`/applications/${a.id}`}>Open</Link>
                  {onDeleted && (
                    <button className="jh-btn jh-btn-ghost jh-btn-sm rc-danger" onClick={() => remove(a)} disabled={busy !== null}>
                      {busy === a.id ? <Spinner /> : 'Delete'}
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
