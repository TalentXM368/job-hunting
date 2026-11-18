import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { listApplications } from '../../api'
import ApplicationTable from '../../components/ApplicationTable'
import { Loading } from '../../components/Field'
import Notice from '../../components/Notice'

export default function CandidateApplicationsTab({ candidateId }) {
  const [applications, setApplications] = useState(null)
  const [error, setError] = useState(null)
  const [deleteError, setDeleteError] = useState(null)

  useEffect(() => {
    let live = true
    listApplications({ candidate_id: candidateId })
      .then((d) => { if (live) setApplications(d.applications || []) })
      .catch((e) => { if (live) setError(e.message) })
    return () => { live = false }
  }, [candidateId])

  return (
    <div className="jh-panel">
      {error && <div className="jh-error">Could not load applications: {error}</div>}
      {!error && applications === null && <Loading label="Loading applications" />}
      {!error && applications?.length === 0 && (
        <div className="jh-empty">
          <div className="jh-empty-title">No applications yet</div>
          Open the <Link to={`/candidates/${candidateId}/matches`}>Matches</Link> tab and choose “Start application” on a role.
        </div>
      )}
      {deleteError && <Notice tone="error" className="rc-in-panel" onClose={() => setDeleteError(null)}>{deleteError}</Notice>}
      {applications?.length > 0 && (
        <ApplicationTable
          applications={applications}
          showCandidate={false}
          onDeleted={(id) => setApplications((list) => list.filter((a) => a.id !== id))}
          onError={setDeleteError}
        />
      )}
    </div>
  )
}
