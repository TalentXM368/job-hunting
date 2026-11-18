import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { deleteCandidate, updateCandidate } from '../../api'
import { CandidateFormFields, countFilled, mergeExtraction, toForm, toPayload } from '../../components/CandidateForm'
import { Spinner } from '../../components/Field'
import Notice from '../../components/Notice'
import ResumeSection from './ResumeSection'

export default function ProfileTab({ candidate, resumes, onSaved, onResumesChanged }) {
  const navigate = useNavigate()
  const [form, setForm] = useState(() => toForm(candidate))
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null) // { tone, text }

  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(toForm(candidate)), [form, candidate])

  const save = async (e) => {
    e.preventDefault()
    if (!form.full_name.trim()) {
      setError('Full name is required.')
      return
    }
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const { candidate: saved } = await updateCandidate(candidate.id, toPayload(form, candidate))
      onSaved(saved)
      setForm(toForm(saved))
      setNotice({ tone: 'success', text: 'Profile saved.' })
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!window.confirm(`Delete ${candidate.full_name}? Their resumes, matches and applications are deleted too. This cannot be undone.`)) return
    setDeleting(true)
    setError(null)
    try {
      await deleteCandidate(candidate.id)
      navigate('/candidates')
    } catch (err) {
      setError(err.message)
      setDeleting(false)
    }
  }

  // Merge an extraction into the form without saving, so the recruiter
  // reviews it before it becomes the record.
  const applyExtraction = (extracted, resume) => {
    let filled = 0
    setForm((f) => {
      const next = mergeExtraction(f, extracted)
      filled = countFilled(f, next)
      return next
    })
    setError(null)
    setNotice({
      tone: 'info',
      text: `Filled in from “${resume.file_name}”${extracted?.model === 'rules' ? ' (read with rules, no AI used)' : ''}. Nothing is saved yet: review the fields below, correct anything that was read wrongly, then choose Save profile.`,
    })
  }

  return (
    <div className="rc-stack">
      <div className="jh-panel rc-panel-pad">
        <ResumeSection candidateId={candidate.id} resumes={resumes} onChanged={onResumesChanged} onExtracted={applyExtraction} />
      </div>

      {notice && <Notice tone={notice.tone} onClose={() => setNotice(null)}>{notice.text}</Notice>}

      <form className="jh-panel rc-panel-pad" onSubmit={save} noValidate>
        <CandidateFormFields form={form} setForm={setForm} />

        {error && <Notice tone="error" onClose={() => setError(null)}>{error}</Notice>}

        <div className="rc-savebar">
          <button className="jh-btn jh-btn-ghost rc-danger" type="button" onClick={remove} disabled={saving || deleting}>
            {deleting ? <><Spinner /> Deleting</> : 'Delete candidate'}
          </button>
          <div className="rc-actions">
            {dirty && <span className="rc-muted">Unsaved changes</span>}
            <button className="jh-btn" type="submit" disabled={saving || deleting || !dirty}>
              {saving ? <><Spinner /> Saving</> : 'Save profile'}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
