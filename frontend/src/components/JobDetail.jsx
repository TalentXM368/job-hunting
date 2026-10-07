export default function JobDetail({ job, onClose }) {
  if (!job) {
    return (
      <div className="li-card li-detail" style={{ padding: 32, textAlign: 'center', color: '#666' }}>
        <div style={{ fontSize: 16, fontWeight: 600 }}>Select a job to view details</div>
        <div style={{ fontSize: 13, marginTop: 6 }}>Choose any posting from the left list — like LinkedIn.</div>
      </div>
    )
  }
  const logo = (job.company || '?').slice(0, 2).toUpperCase()
  return (
    <div className="li-card li-detail">
      <div className="li-detail-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div className="li-detail-title">{job.title}</div>
            <div className="li-detail-meta">{job.company} · {job.location || '—'} · {job.ats} · {job.posted_at ? job.posted_at.slice(0, 10) : ''}</div>
            <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
              <span className="li-badge">Easy Apply via ATS</span>
              <span style={{ fontSize: 12, color: '#666' }}>{job.job_id}</span>
            </div>
          </div>
          {onClose && <button onClick={onClose} style={{ border: 'none', background: '#eee', borderRadius: 20, width: 32, height: 32, cursor: 'pointer' }}>✕</button>}
        </div>
        <a href={job.url} target="_blank" rel="noreferrer">
          <button className="li-apply-btn">Apply on company site →</button>
        </a>
      </div>
      <div className="li-detail-body">
        <h3>About the job</h3>
        {job.description || 'No description'}
      </div>
    </div>
  )
}
