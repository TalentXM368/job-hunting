import { useEffect, useState } from 'react'
import AutoSuggest from './AutoSuggest'

const EMP_TYPES = ['Part-time', 'Contract', 'Internship', 'Full-time', 'Volunteer']
const EXPERIENCE_LEVELS = ['Any experience', 'Internship', 'Entry level', 'Associate', 'Mid-Senior', 'Director']
const SALARY_OPTIONS = ['Any salary', '$80k+', '$120k+', '$160k+', '$200k+']

export default function FilterPanel({ filters, setFilters, meta }) {
  const [locInput, setLocInput] = useState('')
  const [locSugs, setLocSugs] = useState([])
  const [locOpen, setLocOpen] = useState(false)
  const [allOpen, setAllOpen] = useState(false)
  const [empOpen, setEmpOpen] = useState(false)
  const [compOpen, setCompOpen] = useState(false)
  const [compSugs, setCompSugs] = useState([])
  const [empTemp, setEmpTemp] = useState(filters.employment_types || [])
  const [compTemp, setCompTemp] = useState(filters.companies || [])
  const [compQuery, setCompQuery] = useState('')

  useEffect(() => { setEmpTemp(filters.employment_types || []) }, [filters.employment_types])
  useEffect(() => { setCompTemp(filters.companies || []) }, [filters.companies])

  const toggle = (key) => setFilters((f) => ({ ...f, [key]: !f[key] }))
  const toggleAts = (a) => setFilters((f) => {
    const s = new Set(f.ats || [])
    if (s.has(a)) s.delete(a); else s.add(a)
    return { ...f, ats: [...s] }
  })

  const fetchLocSugs = async (q) => {
    try {
      const res = await fetch(`/suggest/locations?q=${encodeURIComponent(q)}&use_mock=${filters.use_mock}&limit=6`)
      const data = await res.json()
      setLocSugs(data.suggestions || [])
    } catch { setLocSugs([]) }
  }

  const fetchCompanies = async () => {
    try {
      const res = await fetch('/companies')
      const data = await res.json()
      const comps = (data.companies || []).map((c) => c.name || c.slug)
      setCompSugs(comps)
    } catch { setCompSugs(['Novapay', 'Acme Edge', 'Helioscale', 'Quantstack', 'Stripe', 'Databricks']) }
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

  return (
    <>
      <div className="li-filters" style={{ gap: 8, overflowX: 'auto', overflowY: 'visible', flexWrap: 'nowrap', background: 'var(--li-card)', scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch', alignItems: 'center' }}>
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <button className="li-pill" onClick={() => setAllOpen((o) => !o)} style={{ background: 'var(--li-card)', color: 'var(--li-text)', borderColor: 'var(--li-border-strong)', fontWeight: 700 }}>
            All filters <span style={{ fontSize: 10, marginLeft: 4 }}>▼</span>
          </button>
          {allOpen && (
            <div style={{ position: 'absolute', left: 0, top: 'calc(100% + 8px)', background: 'var(--li-card)', color: 'var(--li-text)', border: '1px solid var(--li-border)', borderRadius: 12, width: 320, zIndex: 50, overflow: 'hidden', boxShadow: '0 12px 32px rgba(0,0,0,0.15)' }}>
              <div style={{ padding: 16 }}>
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 12, color: 'var(--li-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Remote</div>
                  <button className={`li-pill ${filters.allow_remote ? 'active' : ''}`} onClick={() => toggle('allow_remote')} style={{ width: '100%', justifyContent: 'center' }}>Remote only</button>
                </div>
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 12, color: 'var(--li-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Date posted</div>
                  <select value={filters.max_age_days ?? ''} onChange={(e) => setFilters((f) => ({ ...f, max_age_days: e.target.value === '' ? null : Number(e.target.value) }))} className="li-pill" style={{ width: '100%', background: 'var(--li-card)', color: 'var(--li-text)', borderColor: 'var(--li-border-strong)' }}>
                    <option value={30}>Last 30 days</option>
                    <option value={14}>Last 14 days</option>
                    <option value={7}>Last 7 days</option>
                    <option value="">Any time</option>
                  </select>
                </div>
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 12, color: 'var(--li-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Experience</div>
                  <select value={filters.experience_level || 'Any experience'} onChange={(e) => setFilters((f) => ({ ...f, experience_level: e.target.value }))} className="li-pill" style={{ width: '100%', background: 'var(--li-card)', color: 'var(--li-text)', borderColor: 'var(--li-border-strong)' }}>
                    {EXPERIENCE_LEVELS.map((level) => (
                      <option key={level} value={level}>{level}</option>
                    ))}
                  </select>
                </div>
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 12, color: 'var(--li-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Salary</div>
                  <select value={filters.salary_min || 'Any salary'} onChange={(e) => setFilters((f) => ({ ...f, salary_min: e.target.value === 'Any salary' ? null : e.target.value }))} className="li-pill" style={{ width: '100%', background: 'var(--li-card)', color: 'var(--li-text)', borderColor: 'var(--li-border-strong)' }}>
                    {SALARY_OPTIONS.map((salary) => (
                      <option key={salary} value={salary}>{salary}</option>
                    ))}
                  </select>
                </div>
                <div style={{ marginBottom: 6 }}>
                  <div style={{ fontSize: 12, color: 'var(--li-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Job type</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {EMP_TYPES.map((t) => (
                      <button key={t} className={`li-pill ${(empTemp || []).includes(t) ? 'active' : ''}`} onClick={() => toggleEmp(t)} style={{ flexShrink: 0 }}>{t}</button>
                    ))}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: 12, borderTop: '1px solid var(--li-border)', background: 'var(--li-bg)' }}>
                <button onClick={() => { setEmpTemp([]); setFilters((f) => ({ ...f, employment_types: [] })) }} style={{ background: 'var(--li-card)', color: 'var(--li-text)', border: '1px solid var(--li-border-strong)', borderRadius: 20, padding: '7px 16px', fontWeight: 600, cursor: 'pointer' }}>Reset</button>
                <button onClick={() => { setFilters((f) => ({ ...f, employment_types: empTemp })); setAllOpen(false) }} style={{ background: '#0a66c2', color: '#fff', border: 'none', borderRadius: 20, padding: '7px 16px', fontWeight: 700, cursor: 'pointer' }}>Apply</button>
              </div>
            </div>
          )}
        </div>

        <div style={{ position: 'relative', flexShrink: 0 }}>
          <button className="li-pill" onClick={() => setEmpOpen((o) => !o)} style={{ background: empTemp.length ? 'var(--li-card)' : 'var(--li-card)', color: 'var(--li-text)', borderColor: 'var(--li-border-strong)', fontWeight: 600 }}>Job type {empTemp.length ? `(${empTemp.length})` : ''} <span style={{ fontSize: 10, marginLeft: 4 }}>▼</span></button>
          {empOpen && (
            <div style={{ position: 'absolute', left: 0, top: 'calc(100% + 8px)', background: 'var(--li-card)', color: 'var(--li-text)', border: '1px solid var(--li-border)', borderRadius: 12, width: 280, zIndex: 50, overflow: 'hidden', boxShadow: '0 12px 32px rgba(0,0,0,0.15)' }}>
              <div style={{ padding: 16 }}>
                {EMP_TYPES.map((t) => (
                  <label key={t} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 0', cursor: 'pointer', fontSize: 14 }}>
                    <input type="checkbox" checked={empTemp.includes(t)} onChange={() => toggleEmp(t)} style={{ width: 18, height: 18, accentColor: '#0a66c2' }} /> {t}
                  </label>
                ))}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: 12, borderTop: '1px solid var(--li-border)', background: 'var(--li-bg)' }}>
                <button onClick={() => setEmpTemp([])} style={{ background: 'var(--li-card)', color: 'var(--li-text)', border: '1px solid var(--li-border-strong)', borderRadius: 20, padding: '7px 16px', fontWeight: 600, cursor: 'pointer' }}>Reset</button>
                <button onClick={() => { setFilters((f) => ({ ...f, employment_types: empTemp })); setEmpOpen(false) }} style={{ background: '#0a66c2', color: '#fff', border: 'none', borderRadius: 20, padding: '7px 16px', fontWeight: 700, cursor: 'pointer' }}>Apply</button>
              </div>
            </div>
          )}
        </div>

        <div style={{ position: 'relative', flexShrink: 0 }}>
          <button className="li-pill" onClick={() => setCompOpen((o) => !o)} style={{ background: compTemp.length ? 'var(--li-card)' : 'var(--li-card)', color: 'var(--li-text)', borderColor: 'var(--li-border-strong)', fontWeight: 600 }}>Company {compTemp.length ? `(${compTemp.length})` : ''} <span style={{ fontSize: 10, marginLeft: 4 }}>▼</span></button>
          {compOpen && (
            <div style={{ position: 'absolute', left: 0, top: 'calc(100% + 8px)', background: 'var(--li-card)', color: 'var(--li-text)', border: '1px solid var(--li-border)', borderRadius: 12, width: 300, zIndex: 50, overflow: 'hidden', boxShadow: '0 12px 32px rgba(0,0,0,0.15)' }}>
              <div style={{ padding: 12 }}>
                <input value={compQuery} onChange={(e) => setCompQuery(e.target.value)} placeholder="Search companies" style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--li-border-strong)', background: 'var(--li-card)', color: 'var(--li-text)', fontSize: 13 }} />
              </div>
              <div style={{ maxHeight: 220, overflow: 'auto', padding: '0 16px 8px' }}>
                {filteredComps.map((c) => (
                  <label key={c} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '7px 0', cursor: 'pointer', fontSize: 14 }}>
                    <input type="checkbox" checked={compTemp.includes(c)} onChange={() => toggleComp(c)} style={{ width: 18, height: 18, accentColor: '#0a66c2' }} /> {c}
                  </label>
                ))}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: 12, borderTop: '1px solid var(--li-border)', background: 'var(--li-bg)' }}>
                <button onClick={() => setCompTemp([])} style={{ background: 'var(--li-card)', color: 'var(--li-text)', border: '1px solid var(--li-border-strong)', borderRadius: 20, padding: '7px 16px', fontWeight: 600, cursor: 'pointer' }}>Reset</button>
                <button onClick={() => { setFilters((f) => ({ ...f, companies: compTemp })); setCompOpen(false) }} style={{ background: '#0a66c2', color: '#fff', border: 'none', borderRadius: 20, padding: '7px 16px', fontWeight: 700, cursor: 'pointer' }}>Apply</button>
              </div>
            </div>
          )}
        </div>

        <button className={`li-pill ${filters.allow_remote ? 'active' : ''}`} onClick={() => toggle('allow_remote')} style={{ flexShrink: 0 }}>Remote</button>
        <select value={filters.max_age_days ?? ''} onChange={(e) => setFilters((f) => ({ ...f, max_age_days: e.target.value === '' ? null : Number(e.target.value) }))} className="li-pill" style={{ background: 'var(--li-card)', color: 'var(--li-text)', borderColor: 'var(--li-border-strong)', flexShrink: 0 }}>
          <option value={30}>Date posted: 30d</option>
          <option value={14}>Date posted: 14d</option>
          <option value={7}>Date posted: 7d</option>
          <option value="">Any time</option>
        </select>
        <select value={filters.experience_level || 'Any experience'} onChange={(e) => setFilters((f) => ({ ...f, experience_level: e.target.value }))} className="li-pill" style={{ background: 'var(--li-card)', color: 'var(--li-text)', borderColor: 'var(--li-border-strong)', flexShrink: 0 }}>
          {EXPERIENCE_LEVELS.map((level) => (
            <option key={level} value={level}>{level}</option>
          ))}
        </select>
        <select value={filters.salary_min || 'Any salary'} onChange={(e) => setFilters((f) => ({ ...f, salary_min: e.target.value === 'Any salary' ? null : e.target.value }))} className="li-pill" style={{ background: 'var(--li-card)', color: 'var(--li-text)', borderColor: 'var(--li-border-strong)', flexShrink: 0 }}>
          {SALARY_OPTIONS.map((salary) => (
            <option key={salary} value={salary}>{salary}</option>
          ))}
        </select>
        <div style={{ flexShrink: 0, position: 'relative' }}>
          <button className="li-pill" onClick={() => setLocOpen((o) => !o)} style={{ minWidth: 110, justifyContent: 'space-between', background: filters.locations?.length ? 'var(--li-card)' : 'var(--li-card)', color: 'var(--li-text)', borderColor: 'var(--li-border-strong)', fontWeight: 600 }}>
            Locations {filters.locations?.length ? `(${filters.locations.length})` : ''} <span style={{ marginLeft: 6, fontSize: 10 }}>▼</span>
          </button>
          {locOpen && (
            <div style={{ position: 'absolute', right: 0, top: 'calc(100% + 8px)', background: 'var(--li-card)', border: '1px solid var(--li-border)', borderRadius: 12, padding: 16, width: 340, zIndex: 50, boxShadow: '0 12px 32px rgba(0,0,0,0.15)' }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: 'var(--li-text)' }}>Locations</div>
              <AutoSuggest value={locInput} onSelect={(v) => { const isSug = locSugs.map((s) => s.toLowerCase()).includes(v.toLowerCase()); if (isSug) { addLocation(v); setLocInput(''); } else setLocInput(v) }} suggestions={locSugs} onFetch={fetchLocSugs} placeholder="Try Bangalore, Hyderabad..." icon={<span style={{ fontSize: 12 }}>📍</span>} />
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button onClick={() => { if (locInput.trim()) { addLocation(locInput.trim()); setLocInput('') } }} style={{ flex: 1, fontSize: 13, padding: '7px', borderRadius: 20, border: 'none', background: '#0a66c2', color: '#fff', fontWeight: 600, cursor: 'pointer' }}>Add</button>
                <button onClick={() => setFilters((f) => ({ ...f, locations: [] }))} style={{ fontSize: 13, padding: '7px 12px', borderRadius: 20, border: '1px solid var(--li-border-strong)', background: 'var(--li-card)', color: 'var(--li-text)', cursor: 'pointer' }}>Clear</button>
                <button onClick={() => setLocOpen(false)} style={{ fontSize: 13, padding: '7px 12px', borderRadius: 20, border: '1px solid var(--li-border)', background: 'var(--li-bg)', color: 'var(--li-text)', cursor: 'pointer' }}>Done</button>
              </div>
            </div>
          )}
        </div>
      </div>
      {filters.locations?.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '10px 12px', borderTop: '1px solid var(--li-border)', background: 'var(--li-bg)' }}>
          {filters.locations.map((loc) => (
            <span key={loc} style={{ fontSize: 13, background: 'var(--li-card)', border: '1px solid var(--li-border-strong)', color: 'var(--li-text)', padding: '5px 12px', borderRadius: 20, display: 'flex', gap: 8, alignItems: 'center', boxShadow: '0 1px 2px rgba(0,0,0,0.06)' }}>
              📍 {loc} <span onClick={() => removeLocation(loc)} style={{ cursor: 'pointer', fontWeight: 700, color: '#0a66c2', marginLeft: 2 }}>×</span>
            </span>
          ))}
        </div>
      )}
      {(filters.companies?.length > 0 || filters.employment_types?.length > 0) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '10px 12px', borderTop: '1px solid var(--li-border)', background: 'var(--li-bg)' }}>
          {filters.companies?.map((c) => (
            <span key={c} style={{ fontSize: 12, background: 'var(--li-card)', border: '1px solid var(--li-border-strong)', color: 'var(--li-text)', padding: '4px 10px', borderRadius: 20 }}>🏢 {c} <span onClick={() => setFilters((f) => ({ ...f, companies: f.companies.filter((x) => x !== c) }))} style={{ cursor: 'pointer', fontWeight: 700, color: '#0a66c2' }}>×</span></span>
          ))}
          {filters.employment_types?.map((t) => (
            <span key={t} style={{ fontSize: 12, background: 'var(--li-card)', border: '1px solid var(--li-border-strong)', color: 'var(--li-text)', padding: '4px 10px', borderRadius: 20 }}>⏰ {t} <span onClick={() => setFilters((f) => ({ ...f, employment_types: f.employment_types.filter((x) => x !== t) }))} style={{ cursor: 'pointer', fontWeight: 700, color: '#0a66c2' }}>×</span></span>
          ))}
        </div>
      )}
    </>
  )
}
