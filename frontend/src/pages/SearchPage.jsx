import { useEffect, useRef, useState } from 'react'
import { searchJobs } from '../api'
import FilterPanel from '../components/FilterPanel'
import JobDetail from '../components/JobDetail'
import JobList from '../components/JobList'
import SearchBar from '../components/SearchBar'
import { useHealth } from '../healthContext'

const EMPTY_FILTERS = {
  locations: [],
  allow_remote: false,
  max_age_days: null,
  ats: [],
  companies: [],
  employment_types: [],
  apply_include: false,
  apply_exclude: true,
  include_titles: [],
  exclude_titles: [],
}

const EXAMPLES = ['Backend Engineer', 'Site Reliability Engineer', 'Platform Engineer', 'Software Engineer II']

export default function SearchPage() {
  const { health } = useHealth()
  const boards = health?.boards ?? null

  const [title, setTitle] = useState('')
  // Start with no filters applied; the user picks their own.
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [jobs, setJobs] = useState([])
  const [meta, setMeta] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [offset, setOffset] = useState(0)
  const [selected, setSelected] = useState(null)
  const limit = 50

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
        exclude_titles: filters.exclude_titles,
        ats: filters.ats,
        companies: filters.companies,
        employment_types: filters.employment_types,
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

  // Once a search has run, changing any filter re-runs it from the first page
  // so the list reflects the new filters without pressing Search again.
  const skipFilterEffect = useRef(true)
  useEffect(() => {
    if (skipFilterEffect.current) { skipFilterEffect.current = false; return }
    if (meta) doSearch(0)
  }, [filters]) // eslint-disable-line react-hooks/exhaustive-deps

  const searched = Boolean(meta) || loading
  const boardsCount = meta?.per_board ? Object.keys(meta.per_board).length : null

  return (
    <>
      <section className={`jh-hero ${searched ? 'compact' : ''}`}>
        <div className="jh-wrap">
          <div className="jh-hero-inner">
            <p className="jh-eyebrow">Engineering roles, curated</p>
            <h1 className="jh-h1">Find roles worth applying to.</h1>
            <p className="jh-lede">
              We read the public career pages of {boards ?? 'selected'} companies and match open roles to your candidates. Applications are only sent after a recruiter approves them.
            </p>
            <SearchBar value={title} onChange={setTitle} onSearch={(text) => doSearch(0, text)} loading={loading} />
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
    </>
  )
}
