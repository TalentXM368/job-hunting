// Label + control + optional hint. `wide` spans both columns of an rc-grid.
export default function Field({ label, hint, htmlFor, wide, children }) {
  return (
    <div className={`rc-field ${wide ? 'wide' : ''}`}>
      <label className="rc-label" htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && <div className="rc-hint">{hint}</div>}
    </div>
  )
}

// A titled block inside a panel.
export function Section({ title, sub, actions, children }) {
  return (
    <section className="rc-section">
      <div className="rc-section-head">
        <div>
          <h2 className="rc-section-title">{title}</h2>
          {sub && <p className="rc-section-sub">{sub}</p>}
        </div>
        {actions && <div className="rc-actions">{actions}</div>}
      </div>
      {children}
    </section>
  )
}

export function Spinner() {
  return <svg className="rc-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.2-8.56" /></svg>
}

export function Loading({ label = 'Loading' }) {
  return <div className="rc-loading" aria-busy="true"><Spinner /> {label}…</div>
}
