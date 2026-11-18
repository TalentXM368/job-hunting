// Shared display helpers.

export function formatDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10)
  const days = Math.floor((Date.now() - d.getTime()) / 86400000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 30) return `${days}d ago`
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function formatDateLong(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10)
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export function monogram(name) {
  const words = (name || '').trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

// Deterministic tint index (1..6) so a company always gets the same colour.
export function tintFor(name) {
  let h = 0
  for (const ch of name || '') h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return (h % 6) + 1
}

export function isRemote(location) {
  return /\b(remote|anywhere|distributed|work from home|wfh)\b/i.test(location || '')
}

export const ATS_LABEL = {
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  ashby: 'Ashby',
  workable: 'Workable',
  smartrecruiters: 'SmartRecruiters',
  mock: 'Sample data',
}

export function atsLabel(ats) {
  return ATS_LABEL[(ats || '').toLowerCase()] || ats || ''
}

export function formatDateTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function formatBytes(n) {
  if (n == null) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

export function wordCount(text) {
  const t = (text || '').trim()
  return t ? t.split(/\s+/).length : 0
}

// One-item-per-line textareas <-> string arrays.
export function listToLines(list) {
  return (list || []).join('\n')
}
export function linesToList(text) {
  return (text || '').split('\n').map((s) => s.trim()).filter(Boolean)
}

// '' -> null so the API clears the column instead of storing an empty string.
export function textOrNull(value) {
  const t = (value ?? '').toString().trim()
  return t ? t : null
}
export function numberOrNull(value) {
  if (value === '' || value == null) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

export function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many || `${one}s`}`
}

// Collapse runs of blank lines so pre-wrapped descriptions don't sprawl.
export function tidyDescription(text) {
  return (text || '').replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}
