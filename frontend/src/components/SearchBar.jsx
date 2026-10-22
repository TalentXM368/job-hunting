import { useEffect, useState } from 'react'
import AutoSuggest from './AutoSuggest'

export default function SearchBar({ value, onChange, onSearch, loading, useMock }) {
  const [suggestions, setSuggestions] = useState([])

  const fetchSuggest = async (q) => {
    try {
      const res = await fetch(`/api/suggest/titles?q=${encodeURIComponent(q)}&use_mock=${useMock ?? true}&limit=6`)
      const data = await res.json()
      setSuggestions(data.suggestions || [])
    } catch { setSuggestions([]) }
  }

  useEffect(() => { fetchSuggest('') }, [useMock])

  return (
    <div className="li-search-wrap" style={{ flex: 1, maxWidth: 560, display: 'flex', gap: 8, alignItems: 'center' }}>
      <AutoSuggest
        value={value}
        onSelect={onChange}
        suggestions={suggestions}
        onFetch={fetchSuggest}
        placeholder="Search by title, skill, or company"
        icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="M21 21L16.65 16.65"/></svg>}
      />
      <button className="li-btn-primary" onClick={onSearch} disabled={loading} style={{ flexShrink: 0 }}>
        {loading ? 'Searching…' : 'Search'}
      </button>
    </div>
  )
}
