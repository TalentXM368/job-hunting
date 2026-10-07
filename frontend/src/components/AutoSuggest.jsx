import { useEffect, useRef, useState } from 'react'

export default function AutoSuggest({ value, onSelect, onFetch, placeholder, suggestions, icon }) {
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(-1)
  const wrapRef = useRef(null)

  useEffect(() => {
    const h = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const handleFocus = () => {
    onFetch('')
    setOpen(true)
  }

  const handleChange = (e) => {
    const v = e.target.value
    onSelect(v)
    onFetch(v)
    setOpen(true)
    setHighlight(-1)
  }

  const choose = (s) => {
    onSelect(s)
    setOpen(false)
  }

  const onKeyDown = (e) => {
    if (!open || !suggestions?.length) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight((h) => Math.min(h + 1, suggestions.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)) }
    else if (e.key === 'Enter' && highlight >= 0) { e.preventDefault(); choose(suggestions[highlight]) }
    else if (e.key === 'Escape') setOpen(false)
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative', flex: 1 }}>
      <div style={{ position: 'relative' }}>
        {icon && <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--li-muted)' }}>{icon}</span>}
        <input
          value={value}
          onChange={handleChange}
          onFocus={handleFocus}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          style={{ width: '100%', background: 'var(--li-input, #edf3f8)', border: '1px solid var(--li-border)', borderRadius: 8, padding: icon ? '10px 14px 10px 36px' : '10px 14px', fontSize: 14, outline: 'none', color: 'var(--li-text)' }}
        />
      </div>
      {open && suggestions && suggestions.length > 0 && (
        <div style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0, background: 'var(--li-card)', border: '1px solid var(--li-border)', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.15)', zIndex: 20, overflow: 'hidden' }}>
          {suggestions.map((s, i) => (
            <div
              key={s}
              onMouseDown={() => choose(s)}
              onMouseEnter={() => setHighlight(i)}
              style={{ padding: '9px 12px', fontSize: 13, cursor: 'pointer', background: i === highlight ? 'var(--li-bg)' : 'var(--li-card)', color: 'var(--li-text)', borderBottom: i < suggestions.length - 1 ? '1px solid var(--li-border)' : 'none', display: 'flex', alignItems: 'center', gap: 8 }}
            >
              <span style={{ color: 'var(--li-muted)', fontSize: 12 }}>🔍</span> {s}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
