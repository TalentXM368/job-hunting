import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { listApplications } from '../api'
import ApplicationTable from '../components/ApplicationTable'
import { Loading } from '../components/Field'
import HealthBanner from '../components/HealthBanner'
import Notice from '../components/Notice'
import { APPLICATION_STATUSES, statusLabel } from '../status'

export default function ApplicationsPage() {
  const [status, setStatus] = useState('')
  const [applications, setApplications] = useState(null)
  const [error, setError] = useState(null)
  const [deleteError, setDeleteError] = useState(null)

  useEffect(() => {
    let live = true
    setApplications(null)
    setError(null)
    listApplications({ status })
      .then((d) => { if (live) setApplications(d.applications || []) })
      .catch((e) => { if (live) setError(e.message) })
    return () => { live = false }
  }, [status])

  return (
    <main className="jh-wrap rc-page">
      <div className="rc-page-head">
        <div>
          <h1 className="rc-title">Applications</h1>
          <p className="rc-sub">Every application across all candidates. Nothing is sent until a recruiter approves it.</p>
        </div>
        <label className="rc-inline-label">
          Status
          <select className="jh-input rc-select" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {APPLICATION_STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
          </select>
        </label>
      </div>

      <HealthBanner />

      <div className="jh-panel">
        {error && <div className="jh-error">Could not load applications: {error}</div>}
        {!error && applications === null && <Loading label="Loading applications" />}
        {!error && applications?.length === 0 && (
          <div className="jh-empty">
            <div className="jh-empty-title">{status ? `No ${statusLabel(status).toLowerCase()} applications` : 'No applications yet'}</div>
            {status
              ? 'Choose a different status to see the others.'
              : <>Applications start from a candidate’s matches. Open a <Link to="/candidates">candidate</Link>, find matches, then choose “Start application”.</>}
          </div>
        )}
        {deleteError && <Notice tone="error" className="rc-in-panel" onClose={() => setDeleteError(null)}>{deleteError}</Notice>}
        {applications?.length > 0 && (
          <ApplicationTable
            applications={applications}
            onDeleted={(id) => setApplications((list) => list.filter((a) => a.id !== id))}
            onError={setDeleteError}
          />
        )}
      </div>
    </main>
  )
}
