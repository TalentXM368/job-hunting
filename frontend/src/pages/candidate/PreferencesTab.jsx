import { useMemo, useState } from 'react'
import { getDefaults, savePreferences } from '../../api'
import ChipInput from '../../components/ChipInput'
import Field, { Section, Spinner } from '../../components/Field'
import Notice from '../../components/Notice'
import { linesToList, listToLines } from '../../format'

function toForm(p) {
  const src = p || {}
  return {
    target_titles: src.target_titles || [],
    locations: src.locations || [],
    include_title_patterns: listToLines(src.include_title_patterns),
    exclude_title_patterns: listToLines(src.exclude_title_patterns),
    allow_remote: src.allow_remote ?? true,
    // A stored null means "no age limit". No stored preferences at all means
    // the candidate has never been configured, so start from 30 days.
    any_age: src.max_age_days == null && p != null,
    max_age_days: src.max_age_days == null ? '30' : String(src.max_age_days),
    score_threshold: src.score_threshold == null ? '7' : String(src.score_threshold),
  }
}

// Returns the name of the first pattern that is not a valid regular expression.
function badPattern(lines) {
  for (const line of lines) {
    try { new RegExp(line) } catch { return line }
  }
  return null
}

export default function PreferencesTab({ candidateId, preferences, onSaved }) {
  const [form, setForm] = useState(() => toForm(preferences))
  const [saving, setSaving] = useState(false)
  const [loadingDefaults, setLoadingDefaults] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)

  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(toForm(preferences)), [form, preferences])
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))
  const setValue = (key) => (value) => setForm((f) => ({ ...f, [key]: value }))

  const loadDefaults = async () => {
    setLoadingDefaults(true)
    setError(null)
    try {
      const { filters } = await getDefaults()
      setForm(toForm(filters || {}))
      setNotice('Defaults loaded into the form. Nothing is saved until you choose Save preferences.')
    } catch (e) {
      setError(e.message)
    } finally {
      setLoadingDefaults(false)
    }
  }

  const save = async (e) => {
    e.preventDefault()
    setNotice(null)
    const include = linesToList(form.include_title_patterns)
    const exclude = linesToList(form.exclude_title_patterns)
    const bad = badPattern([...include, ...exclude])
    if (bad) {
      setError(`“${bad}” is not a valid regular expression.`)
      return
    }
    const threshold = Number(form.score_threshold)
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 10) {
      setError('Score threshold must be a number from 0 to 10.')
      return
    }
    let maxAge = null
    if (!form.any_age) {
      maxAge = Number(form.max_age_days)
      if (!Number.isInteger(maxAge) || maxAge < 1) {
        setError('Maximum posting age must be a whole number of days, or choose “Any age”.')
        return
      }
    }

    setSaving(true)
    setError(null)
    try {
      const { preferences: saved } = await savePreferences(candidateId, {
        target_titles: form.target_titles,
        include_title_patterns: include,
        exclude_title_patterns: exclude,
        locations: form.locations,
        allow_remote: form.allow_remote,
        max_age_days: maxAge,
        score_threshold: threshold,
      })
      onSaved(saved)
      setForm(toForm(saved))
      setNotice('Preferences saved. They apply the next time you run Find matches.')
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="jh-panel rc-panel-pad" onSubmit={save} noValidate>
      <Section
        title="Which jobs to consider"
        sub="A free filter that runs before any LLM call. Only jobs that pass it are scored against the profile."
        actions={
          <button className="jh-btn jh-btn-ghost jh-btn-sm" type="button" onClick={loadDefaults} disabled={loadingDefaults || saving}>
            {loadingDefaults ? <><Spinner /> Loading</> : 'Load defaults'}
          </button>
        }
      >
        <div className="rc-grid">
          <Field label="Target titles" htmlFor="p-target_titles" wide hint="Press Enter or comma to add. A job fits when its title has every word of one of these (developer and engineer count as the same word). Leave empty to use the target titles on the profile.">
            <ChipInput id="p-target_titles" value={form.target_titles} onChange={setValue('target_titles')} placeholder="Backend Engineer, SDE…" />
          </Field>
          <Field label="Include title patterns" htmlFor="p-include" hint="Optional. One regular expression per line. A title matching any of these passes too, even if it fits no target title. With no target titles and no patterns, every title passes.">
            <textarea id="p-include" className="jh-input rc-textarea rc-code" rows={7} value={form.include_title_patterns} onChange={set('include_title_patterns')} spellCheck={false} placeholder={'software engineer\n\\bsde\\b'} />
          </Field>
          <Field label="Exclude title patterns" htmlFor="p-exclude" hint="One regular expression per line. A title matching any of these is dropped.">
            <textarea id="p-exclude" className="jh-input rc-textarea rc-code" rows={7} value={form.exclude_title_patterns} onChange={set('exclude_title_patterns')} spellCheck={false} placeholder={'\\b(staff|principal)\\b\n\\bmanager\\b'} />
          </Field>
          <Field label="Locations" htmlFor="p-locations" wide hint="Matched against the posting's location. Leave empty to accept every location.">
            <ChipInput id="p-locations" value={form.locations} onChange={setValue('locations')} placeholder="bangalore, india…" />
          </Field>
          <Field label="Remote roles" htmlFor="p-allow_remote">
            <label className="jh-check">
              <input id="p-allow_remote" type="checkbox" checked={form.allow_remote} onChange={(e) => setValue('allow_remote')(e.target.checked)} />
              Accept anything that reads as remote
            </label>
          </Field>
          <Field label="Maximum posting age (days)" htmlFor="p-max_age_days">
            <div className="rc-row">
              <input id="p-max_age_days" className="jh-input" type="number" min="1" step="1" value={form.any_age ? '' : form.max_age_days} onChange={set('max_age_days')} disabled={form.any_age} />
              <label className="jh-check rc-nowrap">
                <input type="checkbox" checked={form.any_age} onChange={(e) => setValue('any_age')(e.target.checked)} />
                Any age
              </label>
            </div>
          </Field>
          <Field label="Score threshold" htmlFor="p-score_threshold" hint="0 to 10. Matches at or above this count as worth applying to.">
            <input id="p-score_threshold" className="jh-input" type="number" min="0" max="10" step="0.5" value={form.score_threshold} onChange={set('score_threshold')} />
          </Field>
        </div>
      </Section>

      {error && <Notice tone="error" onClose={() => setError(null)}>{error}</Notice>}
      {notice && <Notice tone="success" onClose={() => setNotice(null)}>{notice}</Notice>}

      <div className="rc-savebar">
        <span />
        <div className="rc-actions">
          {dirty && <span className="rc-muted">Unsaved changes</span>}
          {/* With no saved preferences yet, the untouched form is still worth saving. */}
          <button className="jh-btn" type="submit" disabled={saving || (!dirty && preferences != null)}>
            {saving ? <><Spinner /> Saving</> : 'Save preferences'}
          </button>
        </div>
      </div>
    </form>
  )
}
