import { useEffect, useRef, useState } from 'react'

function SearchGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
  )
}

// `inline` renders the list in normal flow (for use inside scrolling menus)
// instead of as an absolutely positioned overlay.
export default function AutoSuggest({ value, onSelect, onFetch, onSubmit, placeholder, suggestions, icon, trailing, heading, autoFocus, inline }) {
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
    setHighlight(-1)
    onSubmit?.(s)
  }

  const onKeyDown = (e) => {
    const hasList = open && suggestions?.length > 0
    if (e.key === 'Enter') {
      e.preventDefault()
      // Enter on a highlighted row picks it; otherwise search what was typed.
      if (hasList && highlight >= 0) choose(suggestions[highlight])
      else { setOpen(false); onSubmit?.(value) }
      return
    }
    if (e.key === 'Escape') { setOpen(false); e.currentTarget.blur(); return }
    if (!hasList) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight((h) => Math.min(h + 1, suggestions.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight((h) => Math.max(h - 1, -1)) }
  }

  return (
    <div ref={wrapRef} className="jh-field">
      {icon && <span className="jh-field-icon">{icon}</span>}
      <input
        className={`jh-input ${icon ? 'has-icon' : ''}`}
        value={value}
        onChange={handleChange}
        onFocus={handleFocus}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        autoFocus={autoFocus}
        autoComplete="off"
        spellCheck={false}
        aria-autocomplete="list"
        aria-expanded={open && suggestions?.length > 0}
      />
      {trailing}
      {open && suggestions && suggestions.length > 0 && (
        <div className={`jh-suggest ${inline ? 'inline' : ''}`} onMouseLeave={() => setHighlight(-1)} role="listbox">
          {heading && <div className="jh-suggest-head">{heading}</div>}
          {suggestions.map((s, i) => (
            <div
              key={s}
              role="option"
              aria-selected={i === highlight}
              className={`jh-suggest-item ${i === highlight ? 'active' : ''}`}
              onMouseDown={() => choose(s)}
              onMouseEnter={() => setHighlight(i)}
            >
              <SearchGlyph />
              <span>{s}</span>
              {i === highlight && <span className="hint">Enter ↵</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
