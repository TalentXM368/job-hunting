import JobCard from './JobCard'

export default function JobList({ jobs, meta, loading, error, offset, onPage, selected, onSelect }) {
  if (loading) return <div className="li-empty">Loading jobs…</div>
  if (error) return <div className="li-empty" style={{ color: '#b42318', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, margin: 12 }}>Error: {error}</div>
  if (!jobs || jobs.length === 0) {
    if (!meta) return <div className="li-empty">No search yet — try “Backend Engineer” or clear title.</div>
    return <div className="li-empty">Scanned {meta.scanned} postings · after title {meta.after_title} · after filters {meta.after_prefilter} — no match. Uncheck <b>Mock mode</b> for live 3000+ jobs or disable “Apply exclude titles”.</div>
  }
  const total = meta?.total ?? jobs.length
  const limit = meta?.limit ?? 50
  const pages = Math.ceil(total / limit)
  const page = Math.floor((offset || 0) / limit) + 1
  return (
    <>
   
      <div className="li-job-list">
        {jobs.map((j) => <JobCard key={j.job_id} job={j} selected={selected?.job_id === j.job_id} onSelect={onSelect} />)}
      </div>
      {pages > 1 && (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', padding: 12, borderTop: '1px solid #e8e8e8' }}>
          <button className="li-pill" disabled={page <= 1} onClick={() => onPage(offset - limit)}>Prev</button>
          <span style={{ fontSize: 13, alignSelf: 'center', color: '#666' }}>Page {page} / {pages}</span>
          <button className="li-pill" disabled={page >= pages} onClick={() => onPage(offset + limit)}>Next</button>
        </div>
      )}
    </>
  )
}
