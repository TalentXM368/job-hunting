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
    <div className="jh-search" role="search">
      <AutoSuggest
        value={value}
        onSelect={onChange}
        onSubmit={(text) => onSearch(text)}
        suggestions={suggestions}
        onFetch={fetchSuggest}
        heading={value.trim() ? 'Matching titles' : 'Popular titles'}
        placeholder="Search by job title, e.g. Backend Engineer"
        icon={<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>}
        trailing={<span className="jh-search-kbd" aria-hidden="true">/</span>}
      />
      <button className="jh-btn" onClick={() => onSearch(value)} disabled={loading}>
        {loading ? (
          <>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ animation: 'jh-spin 0.9s linear infinite' }}><path d="M21 12a9 9 0 1 1-6.2-8.56" /></svg>
            Searching
          </>
        ) : 'Search'}
      </button>
      <style>{'@keyframes jh-spin{to{transform:rotate(360deg)}}'}</style>
    </div>
  )
}
