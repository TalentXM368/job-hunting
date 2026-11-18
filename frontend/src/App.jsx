import { useCallback, useEffect, useMemo, useState } from 'react'
import { HashRouter, Link, NavLink, Route, Routes } from 'react-router-dom'
import { getHealth } from './api'
import { HealthContext } from './healthContext'
import JobHuntingMark from './JobHuntingMark'
import ApplicationDetailPage from './pages/ApplicationDetailPage'
import ApplicationsPage from './pages/ApplicationsPage'
import BoardsPage from './pages/BoardsPage'
import CandidateDetailPage from './pages/CandidateDetailPage'
import CandidatesPage from './pages/CandidatesPage'
import NewCandidatePage from './pages/NewCandidatePage'
import SearchPage from './pages/SearchPage'

const NAV = [
  { to: '/', label: 'Search', end: true },
  { to: '/candidates', label: 'Candidates' },
  { to: '/applications', label: 'Applications' },
  { to: '/boards', label: 'Boards' },
]

function ThemeIcon({ theme }) {
  return theme === 'light' ? (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>
  ) : (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v1.5M12 20.5V22M4.93 4.93l1.06 1.06M17.66 17.66l1.06 1.06M2 12h1.5M20.5 12H22M6.34 17.66l-1.06 1.06M19.07 4.93l-1.06 1.06" /></svg>
  )
}

function NotFound() {
  return (
    <main className="jh-wrap rc-page">
      <div className="jh-panel">
        <div className="jh-empty">
          <div className="jh-empty-title">Page not found</div>
          That address does not match anything here. <Link to="/">Go to search</Link>.
        </div>
      </div>
    </main>
  )
}

export default function App() {
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'light')
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('theme', theme)
  }, [theme])

  const [health, setHealth] = useState(null)
  const [healthError, setHealthError] = useState(null)
  const reloadHealth = useCallback(async () => {
    try {
      setHealth(await getHealth())
      setHealthError(null)
    } catch (e) {
      setHealthError(e.message)
    }
  }, [])
  useEffect(() => { reloadHealth() }, [reloadHealth])

  const healthValue = useMemo(
    () => ({ health, error: healthError, reload: reloadHealth }),
    [health, healthError, reloadHealth],
  )
  const boards = health?.boards ?? null

  return (
    <HashRouter>
      <HealthContext.Provider value={healthValue}>
        <div className="jh-shell">
          <header className="jh-header">
            <div className="jh-wrap jh-header-inner">
              <Link className="jh-brand" to="/">
                <JobHuntingMark size={36} />
                <span className="jh-brand-text">
                  <span className="jh-brand-name">Job Hunting</span>
                  <span className="jh-brand-by">A BlockTXM product</span>
                </span>
              </Link>
              <nav className="jh-nav" aria-label="Main">
                {NAV.map((item) => (
                  <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `jh-nav-link ${isActive ? 'active' : ''}`}>
                    {item.label}
                  </NavLink>
                ))}
              </nav>
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

          <Routes>
            <Route path="/" element={<SearchPage />} />
            <Route path="/candidates" element={<CandidatesPage />} />
            <Route path="/candidates/new" element={<NewCandidatePage />} />
            <Route path="/candidates/:id" element={<CandidateDetailPage />} />
            <Route path="/candidates/:id/:tab" element={<CandidateDetailPage />} />
            <Route path="/applications" element={<ApplicationsPage />} />
            <Route path="/applications/:id" element={<ApplicationDetailPage />} />
            <Route path="/boards" element={<BoardsPage />} />
            <Route path="*" element={<NotFound />} />
          </Routes>

          <footer className="jh-footer">
            <div className="jh-wrap jh-footer-inner">
              <span><strong>Job Hunting</strong> · a BlockTXM product</span>
              <span>Reads public career boards only. Applications are only sent after a recruiter approves them.</span>
            </div>
          </footer>
        </div>
      </HealthContext.Provider>
    </HashRouter>
  )
}
