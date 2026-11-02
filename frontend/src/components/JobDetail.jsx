import { useEffect, useState } from 'react'
import { atsLabel, formatDate, formatDateLong, isRemote, monogram, tidyDescription, tintFor } from '../format'
import { BoardIcon, ClockIcon, PinIcon } from './JobCard'

function ExternalIcon() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17L17 7M8 7h9v9" /></svg>
}
function LinkIcon() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.07 0l2.83-2.83a5 5 0 0 0-7.07-7.07L11 4.93" /><path d="M14 11a5 5 0 0 0-7.07 0L4.1 13.83a5 5 0 0 0 7.07 7.07L13 20.07" /></svg>
}

export default function JobDetail({ job }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => { setCopied(false) }, [job?.job_id])

  if (!job) {
    return (
      <aside className="jh-panel jh-detail">
        <div className="jh-empty" style={{ padding: '88px 28px' }}>
          <div className="jh-empty-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18" /></svg>
          </div>
          <div className="jh-empty-title">No role selected</div>
          Pick a posting from the list to read the full description and apply on the company's own site.
        </div>
      </aside>
    )
  }

  const copy = async () => {
    try { await navigator.clipboard.writeText(job.url); setCopied(true); setTimeout(() => setCopied(false), 1800) } catch {}
  }
  const remote = isRemote(job.location)

  return (
    <aside className="jh-panel jh-detail">
      <div className="jh-detail-head">
        <div className="jh-detail-top">
          <div className={`jh-mono lg t${tintFor(job.company)}`} aria-hidden="true">{monogram(job.company)}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 className="jh-detail-title">{job.title}</h1>
            <div className="jh-detail-company">{job.company}</div>
            <div className="jh-detail-meta">
              {job.location && <span className="m"><PinIcon />{job.location}</span>}
              {job.posted_at && <span className="m" title={formatDateLong(job.posted_at)}><ClockIcon />Posted {formatDate(job.posted_at).toLowerCase()}</span>}
              {job.ats && <span className="m"><BoardIcon />{atsLabel(job.ats)}</span>}
            </div>
            {(remote || job.salary) && (
              <div className="jh-detail-badges">
                {remote && <span className="jh-badge teal">Remote friendly</span>}
                {job.salary && <span className="jh-badge soft">{job.salary}</span>}
              </div>
            )}
          </div>
        </div>
        <div className="jh-detail-actions">
          <a href={job.url} target="_blank" rel="noreferrer" className="jh-btn" style={{ textDecoration: 'none' }}>
            Apply on company site <ExternalIcon />
          </a>
          <button className="jh-btn jh-btn-ghost" onClick={copy}>
            <LinkIcon /> {copied ? 'Link copied' : 'Copy link'}
          </button>
        </div>
      </div>
      <div className="jh-detail-body">
        <h3>About the role</h3>
        {tidyDescription(job.description) || 'No description was provided for this posting.'}
      </div>
      <div className="jh-detail-foot">
        <span>Source: {atsLabel(job.ats)} career board</span>
        <span className="jh-code">{job.job_id}</span>
      </div>
    </aside>
  )
}
