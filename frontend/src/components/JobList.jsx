import JobCard from './JobCard'

const EXAMPLES = ['Backend Engineer', 'Site Reliability Engineer', 'Platform Engineer']

const BANNER = {
  fuzzy: (q) => <>No exact title match for <b>“{q}”</b>. Showing close matches, including typos and partial titles.</>,
  related: (q) => <>No close title match for <b>“{q}”</b>. Showing related roles instead.</>,
}

function InfoIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 8h.01M11 12h1v4h1" /></svg>
}

function Skeleton() {
  return (
    <div aria-busy="true" aria-label="Loading results">
      {[0, 1, 2, 3, 4].map((i) => (
        <div className="jh-skel-row" key={i}>
          <div className="jh-skel ava" />
          <div style={{ flex: 1 }}>
            <div className="jh-skel line" style={{ width: `${62 + (i % 3) * 10}%`, marginTop: 4 }} />
            <div className="jh-skel line" style={{ width: '38%' }} />
            <div className="jh-skel line" style={{ width: '85%', marginTop: 12 }} />
          </div>
        </div>
      ))}
    </div>
  )
}

function Empty({ icon, title, children }) {
  return (
    <div className="jh-empty">
      {icon && <div className="jh-empty-icon">{icon}</div>}
      <div className="jh-empty-title">{title}</div>
      {children}
    </div>
  )
}

export default function JobList({ jobs, meta, query, loading, error, offset, onPage, selected, onSelect, onExample }) {
  if (loading) return <Skeleton />
  if (error) return <div className="jh-error">Something went wrong while searching: {error}</div>
  if (!jobs || jobs.length === 0) {
    if (!meta) {
      return (
        <Empty
          title="Start with a job title"
          icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>}
        >
          Type a role above, or leave the box empty and press Search to browse every open posting.
          {onExample && (
            <div className="jh-examples">
              {EXAMPLES.map((q) => <button key={q} className="jh-example" onClick={() => onExample(q)}>{q}</button>)}
            </div>
          )}
        </Empty>
      )
    }
    if (meta.after_title === 0 || meta.match_mode === 'none') {
      return (
        <Empty title="No matching titles">
          Scanned {meta.scanned} postings and none had a title like <b>“{query}”</b>. Try a broader term such as “engineer” or “developer”.
        </Empty>
      )
    }
    return (
      <Empty title="Everything was filtered out">
        {meta.after_title} postings matched <b>“{query || 'your search'}”</b> but none passed your location or date filters. Remove a location, choose “Any time”, or turn Remote on.
      </Empty>
    )
  }
  const total = meta?.total ?? jobs.length
  const limit = meta?.limit ?? 50
  const pages = Math.ceil(total / limit)
  const page = Math.floor((offset || 0) / limit) + 1
  const banner = meta?.match_mode && BANNER[meta.match_mode]
  return (
    <>
      {banner && <div className="jh-notice"><InfoIcon /><span>{banner(query)}</span></div>}
      <div className="jh-list">
        {jobs.map((j) => <JobCard key={j.job_id} job={j} selected={selected?.job_id === j.job_id} onSelect={onSelect} />)}
      </div>
      {pages > 1 && (
        <div className="jh-pager">
          <button className="jh-btn jh-btn-ghost jh-btn-sm" disabled={page <= 1} onClick={() => onPage(offset - limit)}>Previous</button>
          <span>Page {page} of {pages}</span>
          <button className="jh-btn jh-btn-ghost jh-btn-sm" disabled={page >= pages} onClick={() => onPage(offset + limit)}>Next</button>
        </div>
      )}
    </>
  )
}
