export default function JobCard({ job, selected, onSelect }) {
  const logo = (job.company || '?').slice(0, 2).toUpperCase()
  const ago = job.posted_at ? job.posted_at.slice(0, 10) : ''
  return (
    <div className={`li-job-item ${selected ? 'selected' : ''}`} onClick={() => onSelect(job)}>
      <div className="li-company-logo">{logo}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="li-job-title">{job.title}</div>
        <div className="li-job-company">{job.company} · {job.ats}</div>
        <div className="li-job-loc">{job.location || '—'} · {ago}</div>
        <div className="li-job-desc">{(job.description || '').slice(0, 140)}</div>
      </div>
    </div>
  )
}
