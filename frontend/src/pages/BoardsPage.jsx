import { useCallback, useEffect, useState } from 'react'
import { createCompany, deleteCompany, listCompanies, runIngest, updateCompany } from '../api'
import { Loading, Spinner } from '../components/Field'
import Notice from '../components/Notice'
import { atsLabel, formatDateTime, plural } from '../format'
import { useHealth } from '../healthContext'

const ATS = ['greenhouse', 'lever', 'ashby']
const BOARD_URL = {
  greenhouse: 'boards.greenhouse.io/<slug>',
  lever: 'jobs.lever.co/<slug>',
  ashby: 'jobs.ashbyhq.com/<slug>',
}

function IngestResult({ result, onClose }) {
  const failures = (result.boards || []).filter((b) => !b.ok)
  const seconds = result.duration_ms != null ? ` in ${(result.duration_ms / 1000).toFixed(1)} s` : ''
  return (
    <Notice tone={failures.length ? 'warn' : 'success'} className="rc-banner" onClose={onClose}>
      Scanned {plural(result.scanned ?? 0, 'posting')}{seconds}: {result.inserted ?? 0} new, {result.updated ?? 0} updated, {result.closed ?? 0} closed.
      {failures.length > 0 && (
        <ul className="rc-notice-list">
          {failures.map((b) => (
            <li key={b.company_id || `${b.ats}:${b.slug}`}>
              <strong>{b.name || b.slug}</strong> ({atsLabel(b.ats)}): {b.error || (b.http_status ? `HTTP ${b.http_status}` : 'failed')}
            </li>
          ))}
        </ul>
      )}
    </Notice>
  )
}

export default function BoardsPage() {
  const { reload: reloadHealth } = useHealth()
  const [companies, setCompanies] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(null) // 'all' | 'add' | `${action}:${id}`
  const [form, setForm] = useState({ ats: 'greenhouse', slug: '', name: '' })

  const load = useCallback(async () => {
    try {
      const d = await listCompanies()
      setCompanies(d.companies || [])
      setLoadError(null)
    } catch (e) {
      setLoadError(e.message)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const run = async (key, fn) => {
    setBusy(key)
    setError(null)
    try {
      await fn()
      await load()
      reloadHealth() // header board count
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(null)
    }
  }

  const ingest = (companyId) => run(companyId ? `fetch:${companyId}` : 'all', async () => {
    setResult(null)
    setResult(await runIngest(companyId))
  })

  const add = (e) => {
    e.preventDefault()
    const slug = form.slug.trim()
    if (!slug) return
    run('add', async () => {
      await createCompany({ ats: form.ats, slug, name: form.name.trim() || undefined })
      setForm((f) => ({ ...f, slug: '', name: '' }))
    })
  }

  const toggle = (c) => run(`toggle:${c.id}`, () => updateCompany(c.id, { is_active: !c.is_active }))

  // Rename in place. The slug is the board's identity, so it cannot change:
  // a different slug is a different board, added with the form above.
  const [renaming, setRenaming] = useState(null) // { id, name }
  const saveName = (e) => {
    e.preventDefault()
    const name = renaming?.name.trim()
    if (!name) return
    const id = renaming.id
    run(`rename:${id}`, async () => {
      await updateCompany(id, { name })
      setRenaming(null)
    })
  }

  const remove = (c) => {
    if (!window.confirm(`Remove ${c.name}? Its stored jobs and their matches are deleted too.`)) return
    run(`delete:${c.id}`, () => deleteCompany(c.id))
  }

  const working = busy !== null

  return (
    <main className="jh-wrap rc-page">
      <div className="rc-page-head">
        <div>
          <h1 className="rc-title">Career boards</h1>
          <p className="rc-sub">The public Greenhouse, Lever and Ashby boards this tool reads. Jobs are stored when a board is fetched.</p>
        </div>
        <button className="jh-btn" onClick={() => ingest()} disabled={working || !companies?.length}>
          {busy === 'all' ? <><Spinner /> Refreshing boards</> : 'Refresh all boards'}
        </button>
      </div>

      {busy === 'all' && <Notice tone="info" className="rc-banner">Fetching every active board. This can take up to a minute; keep this page open.</Notice>}
      {error && <Notice tone="error" className="rc-banner" onClose={() => setError(null)}>{error}</Notice>}
      {result && <IngestResult result={result} onClose={() => setResult(null)} />}

      <form className="jh-panel rc-panel-pad rc-add-board" onSubmit={add}>
        <label className="rc-field">
          <span className="rc-label">ATS</span>
          <select className="jh-input" value={form.ats} onChange={(e) => setForm((f) => ({ ...f, ats: e.target.value }))}>
            {ATS.map((a) => <option key={a} value={a}>{atsLabel(a)}</option>)}
          </select>
        </label>
        <label className="rc-field rc-grow">
          <span className="rc-label">Slug</span>
          <input className="jh-input" value={form.slug} onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))} placeholder="stripe" autoComplete="off" spellCheck={false} />
          <span className="rc-hint">The last part of {BOARD_URL[form.ats]}</span>
        </label>
        <label className="rc-field rc-grow">
          <span className="rc-label">Display name</span>
          <input className="jh-input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Optional" autoComplete="off" />
        </label>
        <button className="jh-btn" type="submit" disabled={working || !form.slug.trim()}>
          {busy === 'add' ? <><Spinner /> Adding</> : 'Add board'}
        </button>
      </form>

      <div className="jh-panel">
        {loadError && <div className="jh-error">Could not load boards: {loadError}</div>}
        {!loadError && companies === null && <Loading label="Loading boards" />}
        {!loadError && companies?.length === 0 && (
          <div className="jh-empty">
            <div className="jh-empty-title">No boards yet</div>
            Add a company’s board above, then choose “Fetch now” to pull its open roles.
          </div>
        )}
        {companies?.length > 0 && (
          <div className="rc-table-wrap">
            <table className="rc-table">
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Active</th>
                  <th className="rc-hide-sm">Last fetched</th>
                  <th>HTTP</th>
                  <th className="num rc-hide-sm">Last count</th>
                  <th className="num">Open jobs</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {companies.map((c) => {
                  const httpBad = c.last_http_status != null && c.last_http_status !== 200
                  return (
                    <tr key={c.id} className={c.is_active ? '' : 'rc-row-off'}>
                      <td>
                        {renaming?.id === c.id ? (
                          <form className="rc-actions" onSubmit={saveName}>
                            <input className="jh-input" value={renaming.name} onChange={(e) => setRenaming({ id: c.id, name: e.target.value })} aria-label="Display name" autoFocus maxLength={120} style={{ height: 32, maxWidth: 220 }} />
                            <button className="jh-btn jh-btn-sm" type="submit" disabled={working || !renaming.name.trim()}>{busy === `rename:${c.id}` ? <Spinner /> : 'Save'}</button>
                            <button className="jh-btn jh-btn-ghost jh-btn-sm" type="button" onClick={() => setRenaming(null)} disabled={working}>Cancel</button>
                          </form>
                        ) : (
                          <div className="rc-cell-title">{c.name}</div>
                        )}
                        <div className="rc-cell-sub">{atsLabel(c.ats)} · <span className="jh-code">{c.slug}</span></div>
                      </td>
                      <td>
                        <label className="jh-check rc-tight">
                          <input type="checkbox" checked={c.is_active} onChange={() => toggle(c)} disabled={working} aria-label={`${c.name} is active`} />
                          {busy === `toggle:${c.id}` && <Spinner />}
                        </label>
                      </td>
                      <td className="rc-hide-sm rc-muted">{c.last_fetched_at ? formatDateTime(c.last_fetched_at) : 'Never'}</td>
                      <td>
                        {c.last_http_status == null
                          ? <span className="rc-muted">—</span>
                          : <span className={`rc-status ${httpBad ? 'bad' : 'good'}`} title={httpBad ? 'The last fetch failed. The slug may be wrong or the company may have changed ATS.' : 'Last fetch succeeded'}>{c.last_http_status}</span>}
                      </td>
                      <td className="num rc-hide-sm">{c.last_job_count ?? <span className="rc-muted">—</span>}</td>
                      <td className="num">{c.open_jobs ?? 0}</td>
                      <td>
                        <div className="rc-actions rc-end">
                          <button className="jh-btn jh-btn-ghost jh-btn-sm" onClick={() => ingest(c.id)} disabled={working}>
                            {busy === `fetch:${c.id}` ? <><Spinner /> Fetching</> : 'Fetch now'}
                          </button>
                          <button className="jh-btn jh-btn-ghost jh-btn-sm" onClick={() => setRenaming({ id: c.id, name: c.name })} disabled={working || renaming?.id === c.id}>Rename</button>
                          <button className="jh-btn jh-btn-ghost jh-btn-sm rc-danger" onClick={() => remove(c)} disabled={working}>
                            {busy === `delete:${c.id}` ? <Spinner /> : 'Delete'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  )
}
