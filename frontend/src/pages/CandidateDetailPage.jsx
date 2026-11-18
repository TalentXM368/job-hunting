import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getCandidate } from '../api'
import { Loading } from '../components/Field'
import HealthBanner from '../components/HealthBanner'
import StatusBadge from '../components/StatusBadge'
import Tabs from '../components/Tabs'
import { monogram, tintFor } from '../format'
import CandidateApplicationsTab from './candidate/CandidateApplicationsTab'
import MatchesTab from './candidate/MatchesTab'
import PreferencesTab from './candidate/PreferencesTab'
import ProfileTab from './candidate/ProfileTab'

const TABS = ['profile', 'preferences', 'matches', 'applications']

export default function CandidateDetailPage() {
  const { id, tab: tabParam } = useParams()
  const tab = TABS.includes(tabParam) ? tabParam : 'profile'

  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    try {
      setData(await getCandidate(id))
      setError(null)
    } catch (e) {
      setError(e.message)
    }
  }, [id])

  useEffect(() => {
    setData(null)
    setError(null)
    load()
  }, [load])

  // Resume actions refresh only the resume list, so unsaved form edits survive.
  const reloadResumes = useCallback(async () => {
    const fresh = await getCandidate(id)
    setData((d) => (d ? { ...d, resumes: fresh.resumes } : fresh))
  }, [id])

  if (error) {
    return (
      <main className="jh-wrap rc-page">
        <Link className="rc-back" to="/candidates">← All candidates</Link>
        <div className="jh-panel"><div className="jh-error">Could not load this candidate: {error}</div></div>
      </main>
    )
  }
  if (!data) {
    return <main className="jh-wrap rc-page"><div className="jh-panel"><Loading label="Loading candidate" /></div></main>
  }

  const { candidate, preferences, resumes } = data
  const base = `/candidates/${id}`

  return (
    <main className="jh-wrap rc-page">
      <Link className="rc-back" to="/candidates">← All candidates</Link>
      <div className="rc-page-head">
        <div className="rc-person">
          <div className={`jh-mono lg t${tintFor(candidate.full_name)}`} aria-hidden="true">{monogram(candidate.full_name)}</div>
          <div>
            <h1 className="rc-title">{candidate.full_name}</h1>
            <p className="rc-sub">
              {[candidate.current_title, candidate.current_company].filter(Boolean).join(' at ') || 'No current role set'}
              {candidate.location ? ` · ${candidate.location}` : ''}
            </p>
          </div>
        </div>
        <StatusBadge status={candidate.status} />
      </div>

      <HealthBanner />

      <Tabs
        label="Candidate sections"
        items={[
          { to: base, label: 'Profile', end: true },
          { to: `${base}/preferences`, label: 'Job preferences' },
          { to: `${base}/matches`, label: 'Matches' },
          { to: `${base}/applications`, label: 'Applications' },
        ]}
      />

      {tab === 'profile' && (
        <ProfileTab
          key={candidate.id}
          candidate={candidate}
          resumes={resumes || []}
          onSaved={(c) => setData((d) => ({ ...d, candidate: c }))}
          onResumesChanged={reloadResumes}
        />
      )}
      {tab === 'preferences' && (
        <PreferencesTab
          key={candidate.id}
          candidateId={candidate.id}
          preferences={preferences}
          onSaved={(p) => setData((d) => ({ ...d, preferences: p }))}
        />
      )}
      {tab === 'matches' && <MatchesTab key={candidate.id} candidateId={candidate.id} />}
      {tab === 'applications' && <CandidateApplicationsTab key={candidate.id} candidateId={candidate.id} />}
    </main>
  )
}
