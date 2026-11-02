import { atsLabel, formatDate, isRemote, monogram, tintFor } from '../format'

export function PinIcon() {
  return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 21s-6-5.3-6-10a6 6 0 1 1 12 0c0 4.7-6 10-6 10z" /><circle cx="12" cy="11" r="2" /></svg>
}
export function ClockIcon() {
  return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
}
export function BoardIcon() {
  return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M9 20V10" /></svg>
}

export default function JobCard({ job, selected, onSelect }) {
  const remote = isRemote(job.location)
  return (
    <div
      className={`jh-row ${selected ? 'selected' : ''}`}
      onClick={() => onSelect(job)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(job) } }}
      aria-pressed={selected}
    >
      <div className={`jh-mono t${tintFor(job.company)}`} aria-hidden="true">{monogram(job.company)}</div>
      <div className="jh-row-main">
        <div className="jh-row-top">
          <div className="jh-row-title">{job.title}</div>
          <div className="jh-row-date">{formatDate(job.posted_at)}</div>
        </div>
        <div className="jh-row-company">{job.company}</div>
        <div className="jh-row-meta">
          {job.location && <span className="m"><PinIcon />{job.location}</span>}
          {job.ats && <span className="m"><BoardIcon />{atsLabel(job.ats)}</span>}
        </div>
        {(remote || job.salary) && (
          <div className="jh-row-badges">
            {remote && <span className="jh-badge teal">Remote</span>}
            {job.salary && <span className="jh-badge">{job.salary}</span>}
          </div>
        )}
        {job.description && <div className="jh-row-desc">{job.description.replace(/\s+/g, ' ').slice(0, 170)}</div>}
      </div>
    </div>
  )
}
