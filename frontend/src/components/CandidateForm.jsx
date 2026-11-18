// The candidate profile form, shared by the "new candidate" page and the
// profile tab. Holds the field lists, the form <-> API conversions, and the
// merge of an extracted resume into a form.

import ChipInput from './ChipInput'
import Field, { Section } from './Field'
import { linesToList, listToLines, numberOrNull, textOrNull } from '../format'

export const TEXT_FIELDS = [
  'full_name', 'email', 'phone', 'location', 'linkedin_url', 'github_url', 'portfolio_url',
  'current_title', 'current_company', 'seniority', 'work_authorization', 'salary_currency',
]
export const NUMBER_FIELDS = ['years_experience', 'notice_period_days', 'current_salary', 'expected_salary']
export const BOOL_FIELDS = ['requires_sponsorship', 'willing_to_relocate']
const SENIORITY = ['intern', 'new-grad', 'junior', 'mid', 'senior', 'staff']

const boolToChoice = (v) => (v === true ? 'yes' : v === false ? 'no' : '')
const choiceToBool = (v) => (v === 'yes' ? true : v === 'no' ? false : null)

/** Form state from a candidate record. Pass nothing for a blank form. */
export function toForm(c = {}) {
  const p = c.profile || {}
  const form = { status: c.status || 'active' }
  for (const k of TEXT_FIELDS) form[k] = c[k] ?? ''
  for (const k of NUMBER_FIELDS) form[k] = c[k] == null ? '' : String(c[k])
  for (const k of BOOL_FIELDS) form[k] = boolToChoice(c[k])
  form.core_skills = p.core_skills || []
  form.domains = p.domains || []
  form.target_titles = p.target_titles || []
  form.notable_projects = listToLines(p.notable_projects)
  form.education = p.education || ''
  return form
}

/** Request body from form state. `candidate` is the saved record, if any. */
export function toPayload(form, candidate = null) {
  const body = { status: form.status }
  for (const k of TEXT_FIELDS) body[k] = textOrNull(form[k])
  for (const k of NUMBER_FIELDS) body[k] = numberOrNull(form[k])
  for (const k of BOOL_FIELDS) body[k] = choiceToBool(form[k])

  const profile = {
    ...(candidate?.profile || {}), // keep any keys this form does not edit
    core_skills: form.core_skills,
    domains: form.domains,
    notable_projects: linesToList(form.notable_projects),
    education: form.education.trim(),
    target_titles: form.target_titles,
  }
  const empty = !profile.core_skills.length && !profile.domains.length && !profile.notable_projects.length
    && !profile.education && !profile.target_titles.length
  body.profile = empty && !candidate?.profile ? null : profile
  return body
}

/**
 * Merge an extraction into a form: empty top-level fields are filled, filled
 * ones are left alone, and the scoring profile is replaced when the
 * extraction found one.
 */
export function mergeExtraction(form, extracted) {
  const fields = extracted?.fields || {}
  const profile = extracted?.profile || {}
  const next = { ...form }
  for (const [k, v] of Object.entries(fields)) {
    if (v == null || v === '') continue
    if ((TEXT_FIELDS.includes(k) || NUMBER_FIELDS.includes(k)) && next[k] === '') next[k] = String(v)
    else if (BOOL_FIELDS.includes(k) && next[k] === '' && typeof v === 'boolean') next[k] = boolToChoice(v)
  }
  const found = (profile.core_skills?.length || 0) + (profile.domains?.length || 0) + (profile.target_titles?.length || 0)
    + (profile.notable_projects?.length || 0) + (profile.education ? 1 : 0)
  if (found > 0) {
    next.core_skills = profile.core_skills || []
    next.domains = profile.domains || []
    next.target_titles = profile.target_titles || []
    next.notable_projects = listToLines(profile.notable_projects)
    next.education = profile.education || ''
  }
  return next
}

/** How many form fields an extraction filled, for the notice. */
export function countFilled(before, after) {
  return Object.keys(after).filter((k) => JSON.stringify(after[k]) !== JSON.stringify(before[k]) && after[k] !== '' && !(Array.isArray(after[k]) && after[k].length === 0)).length
}

export function CandidateFormFields({ form, setForm, showStatus = true, idPrefix = 'c' }) {
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))
  const setValue = (key) => (value) => setForm((f) => ({ ...f, [key]: value }))
  const id = (key) => `${idPrefix}-${key}`

  const text = (key, props = {}) => (
    <input id={id(key)} className="jh-input" value={form[key]} onChange={set(key)} autoComplete="off" {...props} />
  )
  const number = (key, props = {}) => (
    <input id={id(key)} className="jh-input" type="number" min="0" value={form[key]} onChange={set(key)} {...props} />
  )
  const yesNo = (key) => (
    <select id={id(key)} className="jh-input" value={form[key]} onChange={set(key)}>
      <option value="">Not specified</option>
      <option value="yes">Yes</option>
      <option value="no">No</option>
    </select>
  )

  return (
    <>
      <Section title="Contact">
        <div className="rc-grid">
          <Field label="Full name" htmlFor={id('full_name')}>{text('full_name', { required: true, maxLength: 200 })}</Field>
          {showStatus ? (
            <Field label="Status" htmlFor={id('status')} hint="Paused and archived candidates are skipped by scheduled matching.">
              <select id={id('status')} className="jh-input" value={form.status} onChange={set('status')}>
                <option value="active">Active</option>
                <option value="paused">Paused</option>
                <option value="archived">Archived</option>
              </select>
            </Field>
          ) : (
            <Field label="Email" htmlFor={id('email')}>{text('email', { type: 'email' })}</Field>
          )}
          {showStatus && <Field label="Email" htmlFor={id('email')}>{text('email', { type: 'email' })}</Field>}
          <Field label="Phone" htmlFor={id('phone')}>{text('phone', { type: 'tel' })}</Field>
          <Field label="Current location" htmlFor={id('location')} wide>{text('location', { placeholder: 'City, country' })}</Field>
        </div>
      </Section>

      <Section title="Links">
        <div className="rc-grid">
          <Field label="LinkedIn" htmlFor={id('linkedin_url')}>{text('linkedin_url', { type: 'url', placeholder: 'https://linkedin.com/in/…' })}</Field>
          <Field label="GitHub" htmlFor={id('github_url')}>{text('github_url', { type: 'url', placeholder: 'https://github.com/…' })}</Field>
          <Field label="Portfolio or website" htmlFor={id('portfolio_url')} wide>{text('portfolio_url', { type: 'url' })}</Field>
        </div>
      </Section>

      <Section title="Experience">
        <div className="rc-grid">
          <Field label="Current title" htmlFor={id('current_title')}>{text('current_title')}</Field>
          <Field label="Current company" htmlFor={id('current_company')}>{text('current_company')}</Field>
          <Field label="Years of experience" htmlFor={id('years_experience')} hint="Drives every seniority judgement in matching.">
            {number('years_experience', { step: '0.5', max: '60' })}
          </Field>
          <Field label="Seniority" htmlFor={id('seniority')}>
            {text('seniority', { list: `${idPrefix}-seniority-options`, placeholder: 'e.g. mid' })}
            <datalist id={`${idPrefix}-seniority-options`}>{SENIORITY.map((s) => <option key={s} value={s} />)}</datalist>
          </Field>
        </div>
      </Section>

      <Section title="Work eligibility">
        <div className="rc-grid">
          <Field label="Work authorisation" htmlFor={id('work_authorization')} wide>
            {text('work_authorization', { placeholder: 'e.g. Indian citizen, H-1B, EU Blue Card' })}
          </Field>
          <Field label="Requires visa sponsorship" htmlFor={id('requires_sponsorship')}>{yesNo('requires_sponsorship')}</Field>
          <Field label="Willing to relocate" htmlFor={id('willing_to_relocate')}>{yesNo('willing_to_relocate')}</Field>
          <Field label="Notice period (days)" htmlFor={id('notice_period_days')}>{number('notice_period_days', { step: '1' })}</Field>
        </div>
      </Section>

      <Section title="Compensation" sub="Annual amounts, in the currency below.">
        <div className="rc-grid three">
          <Field label="Current salary" htmlFor={id('current_salary')}>{number('current_salary', { step: '1' })}</Field>
          <Field label="Expected salary" htmlFor={id('expected_salary')}>{number('expected_salary', { step: '1' })}</Field>
          <Field label="Currency" htmlFor={id('salary_currency')}>{text('salary_currency', { placeholder: 'INR', maxLength: 8 })}</Field>
        </div>
      </Section>

      <Section title="Scoring profile" sub="What every job is scored against. Remove anything the candidate could not defend in an interview.">
        <div className="rc-grid">
          <Field label="Core skills" htmlFor={id('core_skills')} wide hint="Press Enter or comma to add. Most important first.">
            <ChipInput id={id('core_skills')} value={form.core_skills} onChange={setValue('core_skills')} placeholder="Go, Kubernetes, PostgreSQL…" />
          </Field>
          <Field label="Domains" htmlFor={id('domains')} wide>
            <ChipInput id={id('domains')} value={form.domains} onChange={setValue('domains')} placeholder="distributed systems, payments…" />
          </Field>
          <Field label="Target titles" htmlFor={id('target_titles')} wide hint="Roles this candidate should realistically aim at.">
            <ChipInput id={id('target_titles')} value={form.target_titles} onChange={setValue('target_titles')} placeholder="Backend Engineer, Platform Engineer…" />
          </Field>
          <Field label="Notable projects" htmlFor={id('notable_projects')} wide hint="One per line, with the impact if known.">
            <textarea id={id('notable_projects')} className="jh-input rc-textarea" rows={5} value={form.notable_projects} onChange={set('notable_projects')} />
          </Field>
          <Field label="Education" htmlFor={id('education')} wide>{text('education', { placeholder: 'B.E. Computer Science, 2022' })}</Field>
        </div>
      </Section>
    </>
  )
}
