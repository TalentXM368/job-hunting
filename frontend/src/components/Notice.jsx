// Boxed inline message. tone: 'info' | 'success' | 'warn' | 'error'.
const ICON = {
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 8h.01M11 12h1v4h1" /></>,
  success: <><circle cx="12" cy="12" r="9" /><path d="M8.5 12.5l2.5 2.5 4.5-5" /></>,
  warn: <><path d="M12 3l9.5 17h-19z" /><path d="M12 10v4M12 17h.01" /></>,
  error: <><circle cx="12" cy="12" r="9" /><path d="M15 9l-6 6M9 9l6 6" /></>,
}

export default function Notice({ tone = 'info', children, onClose, className = '' }) {
  if (!children) return null
  return (
    <div className={`rc-alert ${tone} ${className}`} role={tone === 'error' ? 'alert' : 'status'}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICON[tone] || ICON.info}</svg>
      <div className="rc-alert-body">{children}</div>
      {onClose && (
        <button className="rc-alert-x" onClick={onClose} aria-label="Dismiss">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      )}
    </div>
  )
}
