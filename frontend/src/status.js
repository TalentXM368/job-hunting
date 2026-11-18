// Labels and colour tones for every status the API returns.
// Tones map to `.rc-status.<tone>` in Recruiter.css.

export const APPLICATION_STATUSES = ['draft', 'approved', 'queued', 'submitting', 'submitted', 'needs_human', 'failed', 'withdrawn']

export const STATUS_META = {
  // candidates
  active: { label: 'Active', tone: 'good' },
  paused: { label: 'Paused', tone: 'warn' },
  archived: { label: 'Archived', tone: 'muted' },
  // matches
  new: { label: 'New', tone: 'info' },
  shortlisted: { label: 'Shortlisted', tone: 'good' },
  dismissed: { label: 'Dismissed', tone: 'muted' },
  // applications
  draft: { label: 'Draft', tone: 'info' },
  approved: { label: 'Approved', tone: 'good' },
  queued: { label: 'Queued', tone: 'good' },
  submitting: { label: 'Submitting', tone: 'warn' },
  submitted: { label: 'Submitted', tone: 'done' },
  needs_human: { label: 'Needs attention', tone: 'warn' },
  failed: { label: 'Failed', tone: 'bad' },
  withdrawn: { label: 'Withdrawn', tone: 'muted' },
}

export function statusLabel(status) {
  return STATUS_META[status]?.label || status || ''
}

// The kit can only be edited before approval, or when the worker handed it back.
export function isEditable(status) {
  return status === 'draft' || status === 'needs_human'
}
