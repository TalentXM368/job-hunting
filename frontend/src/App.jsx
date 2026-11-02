import { useEffect, useState } from 'react'
import { searchJobs } from './api'
import JobHuntingMark from './JobHuntingMark'
import FilterPanel from './components/FilterPanel'
import JobDetail from './components/JobDetail'
import JobList from './components/JobList'
import SearchBar from './components/SearchBar'

const EMPTY_FILTERS = {
  locations: [],
  allow_remote: false,
  max_age_days: null,
  ats: [],
  companies: [],
  employment_types: [],
  use_mock: false,
  apply_include: false,
  apply_exclude: true,
  include_titles: [],
  exclude_titles: [],
}

const EXAMPLES = ['Backend Engineer', 'Site Reliability Engineer', 'Platform Engineer', 'Software Engineer II']

function ThemeIcon({ theme }) {
  return theme === 'light' ? (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>
  ) : (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v1.5M12 20.5V22M4.93 4.93l1.06 1.06M17.66 17.66l1.06 1.06M2 12h1.5M20.5 12H22M6.34 17.66l-1.06 1.06M19.07 4.93l-1.06 1.06" /></svg>
  )
}

export default function App() {
  const [title, setTitle] = useState('')
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'light')
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('theme', theme)
  }, [theme])

  // Start with no filters applied; the user picks their own.
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [jobs, setJobs] = useState([])
  const [meta, setMeta] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [offset, setOffset] = useState(0)
  const [selected, setSelected] = useState(null)
  const [boards, setBoards] = useState(null)
  const limit = 50

  useEffect(() => {
    fetch('/api/health').then((r) => r.json()).then((d) => setBoards(d.boards ?? null)).catch(() => {})
  }, [])

  // Press "/" anywhere to jump to the search box.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return
      const tag = document.activeElement?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      e.preventDefault()
      document.querySelector('.jh-search input')?.focus()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  // `query` lets the search bar pass the text it just submitted, so picking a
  // suggestion and pressing Enter searches that value rather than stale state.
  const doSearch = async (nextOffset = 0, query) => {
    const q = typeof query === 'string' ? query : title
    if (typeof query === 'string' && query !== title) setTitle(query)
    setLoading(true)
    setError(null)
    setOffset(nextOffset)
    try {
      const data = await searchJobs({
        title: q,
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

  const searched = Boolean(meta) || loading
  const boardsCount = meta?.per_board ? Object.keys(meta.per_board).length : null

  return (
    <div className="jh-shell">
      <header className="jh-header">
        <div className="jh-wrap jh-header-inner">
          <a className="jh-brand" href="/">
            <JobHuntingMark size={36} />
            <span className="jh-brand-text">
              <span className="jh-brand-name">Job Hunting</span>
              <span className="jh-brand-by">A BlockTXM product</span>
            </span>
          </a>
          <div className="jh-header-right">
            {boards != null && (
              <span className="jh-header-stat" title="Public career boards this tool reads">
                <span className="pulse" aria-hidden="true" />
                {boards} career boards tracked
              </span>
            )}
            <button
              className="jh-icon-btn"
              onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
              title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
              aria-label="Toggle colour theme"
            >
              <ThemeIcon theme={theme} />
            </button>
          </div>
        </div>
      </header>

      <section className={`jh-hero ${searched ? 'compact' : ''}`}>
        <div className="jh-wrap">
          <div className="jh-hero-inner">
            <p className="jh-eyebrow">Engineering roles, curated</p>
            <h1 className="jh-h1">Find roles worth applying to.</h1>
            <p className="jh-lede">
              We read the public career pages of {boards ?? 'selected'} companies, remove postings that do not fit, and show you what is left. Nothing is ever submitted on your behalf.
            </p>
            <SearchBar value={title} onChange={setTitle} onSearch={(text) => doSearch(0, text)} loading={loading} useMock={filters.use_mock} />
            <div className="jh-examples">
              <span>Try</span>
              {EXAMPLES.map((q) => (
                <button key={q} className="jh-example" onClick={() => doSearch(0, q)}>{q}</button>
              ))}
            </div>
          </div>
        </div>
      </section>

      <div className="jh-wrap jh-toolbar-wrap">
        <div className="jh-toolbar-card">
          <FilterPanel filters={filters} setFilters={setFilters} onReset={() => setFilters(EMPTY_FILTERS)} />
        </div>
      </div>

      <main className="jh-wrap jh-layout">
        <section className="jh-panel">
          <div className="jh-panel-head">
            <span>
              {meta
                ? <><strong>{meta.total}</strong> {meta.total === 1 ? 'role' : 'roles'}{title.trim() ? <> for “{title.trim()}”</> : ''}</>
                : <strong style={{ fontSize: 14 }}>Results</strong>}
            </span>
            <span className="sub">
              {meta ? `${meta.scanned} postings${boardsCount ? ` · ${boardsCount} boards` : ''}` : ''}
            </span>
          </div>
          <JobList
            jobs={jobs}
            meta={meta}
            query={title}
            loading={loading}
            error={error}
            offset={offset}
            onPage={(o) => doSearch(o)}
            selected={selected}
            onSelect={setSelected}
            onExample={(q) => doSearch(0, q)}
          />
        </section>
        <JobDetail job={selected} />
      </main>

      <footer className="jh-footer">
        <div className="jh-wrap jh-footer-inner">
          <span><strong>Job Hunting</strong> · a BlockTXM product</span>
          <span>Reads public career boards only. Filters locally. Never applies on your behalf.</span>
        </div>
      </footer>
    </div>
  )
}
