import { useEffect, useState } from 'react'
import { searchJobs } from './api'
import FilterPanel from './components/FilterPanel'
import JobDetail from './components/JobDetail'
import JobList from './components/JobList'
import SearchBar from './components/SearchBar'

export default function JobHuntApp() {
  const [title, setTitle] = useState('')
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'light')
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('theme', theme)
  }, [theme])
  const [filters, setFilters] = useState({
    locations: ['bangalore', 'bengaluru', 'india'],
    allow_remote: true,
    max_age_days: 30,
    ats: [],
    companies: [],
    employment_types: [],
    use_mock: false,
    apply_include: false,
    apply_exclude: true,
    include_titles: [],
    exclude_titles: [],
  })
  const [jobs, setJobs] = useState([])
  const [meta, setMeta] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [offset, setOffset] = useState(0)
  const [selected, setSelected] = useState(null)
  const limit = 50

  const doSearch = async (nextOffset = 0) => {
    setLoading(true)
    setError(null)
    setOffset(nextOffset)
    try {
      const data = await searchJobs({
        title,
        locations: filters.locations,
        allow_remote: filters.allow_remote,
        max_age_days: filters.max_age_days,
        include_titles: filters.include_titles,
        exclude_titles: filters.exclude_titles?.length ? filters.exclude_titles : undefined,
        ats: filters.ats,
        companies: filters.companies?.length ? filters.companies : undefined,
        employment_types: filters.employment_types?.length ? filters.employment_types : undefined,
        use_mock: filters.use_mock,
        apply_include: filters.apply_include,
        apply_exclude: filters.apply_exclude,
        limit,
        offset: nextOffset,
      })
      setJobs(data.jobs)
      setMeta(data.meta)
      setSelected(data.jobs[0] || null)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <nav className="li-nav">
        <div className="li-nav-inner" style={{ justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <a className="jh-home" href="#/">BlockTXM</a>
            <div style={{ width: 36, height: 36, borderRadius: 8, background: 'linear-gradient(135deg,#0a66c2,#00c2a8)', display: 'grid', placeItems: 'center', color: '#fff', fontWeight: 800, fontSize: 16 }}>JH</div>
            <span style={{ fontWeight: 700, fontSize: 16, color: 'var(--li-text)', letterSpacing: -0.5 }}>JobHunt</span>
          </div>
          <SearchBar value={title} onChange={setTitle} onSearch={() => doSearch(0)} loading={loading} useMock={filters.use_mock} />
          <button onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))} title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`} style={{ marginLeft: 12, width: 38, height: 38, borderRadius: 20, border: '1px solid var(--li-border-strong)', background: 'var(--li-card)', color: 'var(--li-muted)', cursor: 'pointer', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
            {theme === 'light' ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v1.5M12 20.5V22M4.93 4.93l1.06 1.06M17.66 17.66l1.06 1.06M2 12h1.5M20.5 12H22M6.34 17.66l-1.06 1.06M19.07 4.93l-1.06 1.06" /></svg>
            )}
          </button>
        </div>
      </nav>

      <div style={{ maxWidth: 1128, margin: '0 auto', padding: '12px 16px 0' }}>
        <div className="li-card" style={{ overflow: 'visible', position: 'relative', zIndex: 15 }}>
          <FilterPanel filters={filters} setFilters={setFilters} meta={meta} />
        </div>
      </div>

      <div className="li-layout">
        <div className="li-card">
          <div style={{ padding: '10px 12px', fontSize: 13, color: '#666', borderBottom: '1px solid #e8e8e8', display: 'flex', justifyContent: 'space-between' }}>
            <span>{meta ? `${meta.total} results` : 'Search jobs'}</span>
            <span style={{ fontSize: 11, color: '#8a8a8a' }}>{meta ? `scanned ${meta.scanned}` : ''}</span>
          </div>
          <JobList jobs={jobs} meta={null} loading={loading} error={error} offset={offset} onPage={(o) => doSearch(o)} selected={selected} onSelect={setSelected} />
        </div>
        <JobDetail job={selected} />
      </div>
    </div>
  )
}
