import { useState } from 'react'

function Close() {
  return <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
}

// Tag editor for a string array. Enter or comma adds, Backspace on an empty
// box removes the last tag, and pasted comma/newline lists are split.
export default function ChipInput({ value, onChange, placeholder, disabled, id }) {
  const [text, setText] = useState('')
  const items = value || []

  const add = (raw) => {
    const parts = raw.split(/[,\n]/).map((s) => s.trim()).filter(Boolean)
    if (parts.length === 0) return
    const seen = new Set(items.map((x) => x.toLowerCase()))
    const next = [...items]
    for (const p of parts) {
      if (!seen.has(p.toLowerCase())) { seen.add(p.toLowerCase()); next.push(p) }
    }
    if (next.length !== items.length) onChange(next)
  }

  const commit = () => { add(text); setText('') }

  const onKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      commit()
    } else if (e.key === 'Backspace' && !text && items.length) {
      onChange(items.slice(0, -1))
    }
  }

  const onPaste = (e) => {
    const pasted = e.clipboardData.getData('text')
    if (/[,\n]/.test(pasted)) {
      e.preventDefault()
      add(text + pasted)
      setText('')
    }
  }

  return (
    <div className={`rc-chips ${disabled ? 'disabled' : ''}`}>
      {items.map((item) => (
        <span key={item} className="jh-tag">
          {item}
          {!disabled && (
            <button type="button" className="jh-tag-x" onClick={() => onChange(items.filter((x) => x !== item))} aria-label={`Remove ${item}`}><Close /></button>
          )}
        </span>
      ))}
      {!disabled && (
        <input
          id={id}
          className="rc-chips-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onBlur={commit}
          placeholder={items.length ? '' : placeholder}
          autoComplete="off"
          spellCheck={false}
        />
      )}
    </div>
  )
}
