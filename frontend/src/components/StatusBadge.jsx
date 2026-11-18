import { STATUS_META } from '../status'

export default function StatusBadge({ status }) {
  if (!status) return null
  const meta = STATUS_META[status] || { label: status, tone: 'muted' }
  return <span className={`rc-status ${meta.tone}`}>{meta.label}</span>
}

// 0-10 match score. Thresholds mirror the email digest: 8.5+ strong, 7+ good.
export function ScoreBadge({ score }) {
  if (score == null) return <span className="rc-score none" title="Not scored yet">–</span>
  const n = Number(score)
  const tone = n >= 8.5 ? 'high' : n >= 7 ? 'mid' : 'low'
  return <span className={`rc-score ${tone}`} title="Match score out of 10">{n.toFixed(1)}</span>
}
