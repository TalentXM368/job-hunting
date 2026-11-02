import { useEffect, useRef, useState } from 'react'
import AutoSuggest from './AutoSuggest'

const EMP_TYPES = ['Full-time', 'Part-time', 'Contract', 'Internship', 'Volunteer']
const EXPERIENCE_LEVELS = ['Any experience', 'Internship', 'Entry level', 'Associate', 'Mid-Senior', 'Director']
const SALARY_OPTIONS = ['Any salary', '$80k+', '$120k+', '$160k+', '$200k+']
const DATE_OPTIONS = [
  { label: 'Any time', value: null },
  { label: 'Past 24 hours', value: 1 },
  { label: 'Past 3 days', value: 3 },
  { label: 'Past 7 days', value: 7 },
  { label: 'Past 14 days', value: 14 },
  { label: 'Past 30 days', value: 30 },
]

function Chevron() {
  return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
}

function Close() {
  return <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
}

function Count({ n }) {
  return n ? <span className="jh-chip-count">{n}</span> : null
}

export default function FilterPanel({ filters, setFilters, onReset }) {
  const [locInput, setLocInput] = useState('')
  const [locSugs, setLocSugs] = useState([])
  // Only one dropdown may be open at a time, otherwise the panels overlap each other.
  const [openMenu, setOpenMenu] = useState(null)
  const barRef = useRef(null)
  const toggleMenu = (name) => setOpenMenu((cur) => (cur === name ? null : name))
  const closeMenu = () => setOpenMenu(null)
  const [compSugs, setCompSugs] = useState([])
  const [empTemp, setEmpTemp] = useState(filters.employment_types || [])
  const [compTemp, setCompTemp] = useState(filters.companies || [])
  const [compQuery, setCompQuery] = useState('')

  useEffect(() => { setEmpTemp(filters.employment_types || []) }, [filters.employment_types])
  useEffect(() => { setCompTemp(filters.companies || []) }, [filters.companies])

  useEffect(() => {
    if (!openMenu) return
    const onDown = (e) => { if (barRef.current && !barRef.current.contains(e.target)) closeMenu() }
    const onKey = (e) => { if (e.key === 'Escape') closeMenu() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [openMenu])

  const toggle = (key) => setFilters((f) => ({ ...f, [key]: !f[key] }))

  const fetchLocSugs = async (q) => {
    try {
      const res = await fetch(`/api/suggest/locations?q=${encodeURIComponent(q)}&use_mock=${filters.use_mock}&limit=6`)
      const data = await res.json()
      setLocSugs(data.suggestions || [])
    } catch { setLocSugs([]) }
  }

  const fetchCompanies = async () => {
    try {
      const res = await fetch('/api/companies')
      const data = await res.json()
      setCompSugs((data.companies || []).map((c) => c.name || c.slug))
    } catch { setCompSugs([]) }
  }

  useEffect(() => { fetchCompanies() }, [])

  const addLocation = (loc) => {
    if (!loc) return
    setFilters((f) => {
      const cur = f.locations || []
      if (cur.map((x) => x.toLowerCase()).includes(loc.toLowerCase())) return f
      return { ...f, locations: [...cur, loc] }
    })
    setLocInput('')
  }

  const removeLocation = (loc) => {
    setFilters((f) => ({ ...f, locations: (f.locations || []).filter((x) => x.toLowerCase() !== loc.toLowerCase()) }))
  }

  const toggleEmp = (t) => setEmpTemp((prev) => prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t])
  const toggleComp = (c) => setCompTemp((prev) => prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c])
  const filteredComps = compSugs.filter((c) => !compQuery || c.toLowerCase().includes(compQuery.toLowerCase()))

  const locCount = filters.locations?.length || 0
  const empCount = filters.employment_types?.length || 0
  const compCount = filters.companies?.length || 0
  const dateActive = filters.max_age_days != null
  const dateLabel = DATE_OPTIONS.find((o) => o.value === filters.max_age_days)?.label || `Past ${filters.max_age_days} days`
  const setDate = (value) => { setFilters((f) => ({ ...f, max_age_days: value })); closeMenu() }
  const hasAny = locCount || empCount || compCount || filters.allow_remote || dateActive

  return (
    <div ref={barRef}>
      <div className="jh-toolbar">
        {/* Locations */}
        <div className="jh-menu-anchor">
          <button className={`jh-chip ${locCount ? 'active' : ''}`} onClick={() => toggleMenu('loc')}>
            Location <Count n={locCount} /> <Chevron />
          </button>
          {openMenu === 'loc' && (
            <div className="jh-menu" style={{ width: 320 }}>
              <div className="jh-menu-body">
                <p className="jh-menu-label">Add a location</p>
                <AutoSuggest
                  value={locInput}
                  autoFocus
                  inline
                  onSelect={(v) => {
                    const isSug = locSugs.map((s) => s.toLowerCase()).includes(v.toLowerCase())
                    if (isSug) { addLocation(v); setLocInput('') } else setLocInput(v)
                  }}
                  onSubmit={(v) => { if (v?.trim()) addLocation(v.trim()) }}
                  suggestions={locSugs}
                  onFetch={fetchLocSugs}
                  placeholder="City, state, or country"
                />
                {locCount > 0 && (
                  <div className="jh-tags" style={{ marginTop: 12 }}>
                    {filters.locations.map((loc) => (
                      <span key={loc} className="jh-tag">
                        {loc}
                        <button className="jh-tag-x" onClick={() => removeLocation(loc)} aria-label={`Remove ${loc}`}><Close /></button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="jh-menu-foot">
                <button className="jh-btn jh-btn-ghost jh-btn-sm" onClick={() => setFilters((f) => ({ ...f, locations: [] }))} disabled={!locCount}>Clear</button>
                <button className="jh-btn jh-btn-sm" onClick={closeMenu}>Done</button>
              </div>
            </div>
          )}
        </div>

        <button className={`jh-chip ${filters.allow_remote ? 'active' : ''}`} onClick={() => toggle('allow_remote')} aria-pressed={filters.allow_remote}>
          Remote
        </button>

        {/* Date posted */}
        <div className="jh-menu-anchor">
          <button className={`jh-chip ${dateActive ? 'active' : ''}`} onClick={() => toggleMenu('date')} aria-label="Date posted">
            {dateActive ? dateLabel : 'Date posted'} <Chevron />
          </button>
          {openMenu === 'date' && (
            <div className="jh-menu" style={{ width: 220 }}>
              <div className="jh-menu-body">
                <p className="jh-menu-label">Show roles posted in the</p>
                {DATE_OPTIONS.map((o) => (
                  <label key={o.label} className="jh-check">
                    <input
                      type="radio"
                      name="jh-date-posted"
                      checked={(filters.max_age_days ?? null) === o.value}
                      onChange={() => setDate(o.value)}
                    /> {o.label}
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Job type */}
        <div className="jh-menu-anchor">
          <button className={`jh-chip ${empCount ? 'active' : ''}`} onClick={() => toggleMenu('emp')}>
            Job type <Count n={empCount} /> <Chevron />
          </button>
          {openMenu === 'emp' && (
            <div className="jh-menu" style={{ width: 240 }}>
              <div className="jh-menu-body">
                {EMP_TYPES.map((t) => (
                  <label key={t} className="jh-check">
                    <input type="checkbox" checked={empTemp.includes(t)} onChange={() => toggleEmp(t)} /> {t}
                  </label>
                ))}
              </div>
              <div className="jh-menu-foot">
                <button className="jh-btn jh-btn-ghost jh-btn-sm" onClick={() => setEmpTemp([])} disabled={!empTemp.length}>Clear</button>
                <button className="jh-btn jh-btn-sm" onClick={() => { setFilters((f) => ({ ...f, employment_types: empTemp })); closeMenu() }}>Apply</button>
              </div>
            </div>
          )}
        </div>

        {/* Company */}
        <div className="jh-menu-anchor">
          <button className={`jh-chip ${compCount ? 'active' : ''}`} onClick={() => toggleMenu('comp')}>
            Company <Count n={compCount} /> <Chevron />
          </button>
          {openMenu === 'comp' && (
            <div className="jh-menu" style={{ width: 300 }}>
              <div className="jh-menu-body" style={{ paddingBottom: 8 }}>
                <input
                  className="jh-input"
                  value={compQuery}
                  onChange={(e) => setCompQuery(e.target.value)}
                  placeholder="Filter companies"
                  autoFocus
                  style={{ height: 34, marginBottom: 6 }}
                />
                <div style={{ maxHeight: 220, overflowY: 'auto' }}>
                  {filteredComps.length === 0 && <div className="jh-empty" style={{ padding: '16px 0' }}>No companies match.</div>}
                  {filteredComps.map((c) => (
                    <label key={c} className="jh-check">
                      <input type="checkbox" checked={compTemp.includes(c)} onChange={() => toggleComp(c)} /> {c}
                    </label>
                  ))}
                </div>
              </div>
              <div className="jh-menu-foot">
                <button className="jh-btn jh-btn-ghost jh-btn-sm" onClick={() => setCompTemp([])} disabled={!compTemp.length}>Clear</button>
                <button className="jh-btn jh-btn-sm" onClick={() => { setFilters((f) => ({ ...f, companies: compTemp })); closeMenu() }}>Apply</button>
              </div>
            </div>
          )}
        </div>

        <span className="jh-toolbar-sep" aria-hidden="true" />

        <select
          className={`jh-chip ${filters.experience_level && filters.experience_level !== 'Any experience' ? 'active' : ''}`}
          value={filters.experience_level || 'Any experience'}
          onChange={(e) => setFilters((f) => ({ ...f, experience_level: e.target.value }))}
          aria-label="Experience level"
        >
          {EXPERIENCE_LEVELS.map((level) => <option key={level} value={level}>{level}</option>)}
        </select>

        <select
          className={`jh-chip ${filters.salary_min ? 'active' : ''}`}
          value={filters.salary_min || 'Any salary'}
          onChange={(e) => setFilters((f) => ({ ...f, salary_min: e.target.value === 'Any salary' ? null : e.target.value }))}
          aria-label="Minimum salary"
        >
          {SALARY_OPTIONS.map((salary) => <option key={salary} value={salary}>{salary}</option>)}
        </select>
      </div>

      {(locCount > 0 || compCount > 0 || empCount > 0 || dateActive) && (
        <div className="jh-tags">
          {dateActive && (
            <span className="jh-tag">
              <span className="jh-tag-kind">Posted</span> {dateLabel}
              <button className="jh-tag-x" onClick={() => setDate(null)} aria-label="Remove date filter"><Close /></button>
            </span>
          )}
          {filters.locations.map((loc) => (
            <span key={`l-${loc}`} className="jh-tag">
              <span className="jh-tag-kind">Location</span> {loc}
              <button className="jh-tag-x" onClick={() => removeLocation(loc)} aria-label={`Remove ${loc}`}><Close /></button>
            </span>
          ))}
          {filters.companies?.map((c) => (
            <span key={`c-${c}`} className="jh-tag">
              <span className="jh-tag-kind">Company</span> {c}
              <button className="jh-tag-x" onClick={() => setFilters((f) => ({ ...f, companies: f.companies.filter((x) => x !== c) }))} aria-label={`Remove ${c}`}><Close /></button>
            </span>
          ))}
          {filters.employment_types?.map((t) => (
            <span key={`t-${t}`} className="jh-tag">
              <span className="jh-tag-kind">Type</span> {t}
              <button className="jh-tag-x" onClick={() => setFilters((f) => ({ ...f, employment_types: f.employment_types.filter((x) => x !== t) }))} aria-label={`Remove ${t}`}><Close /></button>
            </span>
          ))}
          {hasAny && onReset && <button className="jh-tags-clear" onClick={onReset}>Clear all</button>}
        </div>
      )}
    </div>
  )
}
