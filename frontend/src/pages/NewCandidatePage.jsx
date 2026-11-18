import { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { createCandidate, readResume, uploadResume } from '../api'
import { CandidateFormFields, countFilled, mergeExtraction, toForm, toPayload } from '../components/CandidateForm'
import { Section, Spinner } from '../components/Field'
import HealthBanner from '../components/HealthBanner'
import Notice from '../components/Notice'
import { formatBytes } from '../format'
import { useHealth } from '../healthContext'

const MAX_BYTES = 4 * 1024 * 1024
const ALLOWED = ['.pdf', '.txt', '.md']

// Add a candidate. Drop a resume first and the form fills itself; or type it
// in by hand. Nothing exists on the server until Save, and the resume is
// attached to the new record at that moment.
export default function NewCandidatePage() {
  const navigate = useNavigate()
  const llmOk = Boolean(useHealth().health?.llm?.configured)
  const inputRef = useRef(null)
  const [form, setForm] = useState(() => toForm())
  const [file, setFile] = useState(null)
  const [reading, setReading] = useState(null) // 'rules' | 'ai'
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState(null) // { tone, text }
  const [error, setError] = useState(null)
  const [created, setCreated] = useState(null) // candidate saved but resume upload failed

  const read = async (f, useLlm) => {
    setReading(useLlm ? 'ai' : 'rules')
    setError(null)
    try {
      const { extracted } = await readResume(f, useLlm)
      let filled = 0
      setForm((current) => {
        const next = mergeExtraction(current, extracted)
        filled = countFilled(current, next)
        return next
      })
      setNotice({
        tone: 'info',
        text: `Read “${f.name}”${useLlm ? ' with the model' : ' with rules, no AI used'}. Check every field below, fix anything read wrongly, then choose Save candidate.`,
      })
    } catch (e) {
      setError(e.message)
    } finally {
      setReading(null)
    }
  }

  const onFile = (e) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    const ext = f.name.slice(f.name.lastIndexOf('.')).toLowerCase()
    if (!ALLOWED.includes(ext)) {
      setError(`“${f.name}” is not supported. Upload a PDF, .txt or .md file.`)
      return
    }
    if (f.size > MAX_BYTES) {
      setError(`“${f.name}” is ${formatBytes(f.size)}. The limit is 4 MB.`)
      return
    }
    setFile(f)
    read(f, false)
  }

  const save = async (e) => {
    e.preventDefault()
    if (!form.full_name.trim()) {
      setError('Full name is required.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      let candidate = created
      if (!candidate) {
        candidate = (await createCandidate(toPayload(form))).candidate
        setCreated(candidate)
      }
      if (file) await uploadResume(candidate.id, file)
      navigate(`/candidates/${candidate.id}`)
    } catch (err) {
      setError(created
        ? `The candidate was saved but the resume could not be attached: ${err.message}`
        : err.message)
      setSaving(false)
    }
  }

  return (
    <main className="jh-wrap rc-page">
      <Link className="rc-back" to="/candidates">← All candidates</Link>
      <div className="rc-page-head">
        <div>
          <h1 className="rc-title">New candidate</h1>
          <p className="rc-sub">Start from a resume and the form fills itself, or type the details in by hand.</p>
        </div>
      </div>

      <HealthBanner />

      <form className="rc-stack" onSubmit={save} noValidate>
        <div className="jh-panel rc-panel-pad">
          <Section
            title="Start from a resume"
            sub="PDF, .txt or .md, up to 4 MB. It is read on the spot and attached to the candidate when you save."
            actions={
              <>
                <input ref={inputRef} type="file" accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown" onChange={onFile} hidden />
                <button className="jh-btn" type="button" onClick={() => inputRef.current?.click()} disabled={reading !== null || saving}>
                  {reading === 'rules' ? <><Spinner /> Reading resume</> : file ? 'Choose a different resume' : 'Upload resume'}
                </button>
              </>
            }
          >
            {file ? (
              <div className="rc-actions">
                <span><strong>{file.name}</strong> <span className="rc-muted">· {formatBytes(file.size)}</span></span>
                <button className="jh-btn jh-btn-ghost jh-btn-sm" type="button" onClick={() => read(file, false)} disabled={reading !== null || saving}>
                  {reading === 'rules' ? <Spinner /> : 'Read again'}
                </button>
                {llmOk && (
                  <button className="jh-btn jh-btn-ghost jh-btn-sm" type="button" onClick={() => read(file, true)} disabled={reading !== null || saving} title="Sends the resume to the LLM. Better at prose resumes; costs tokens.">
                    {reading === 'ai' ? <><Spinner /> Asking the model</> : 'Read with AI'}
                  </button>
                )}
                <button className="jh-btn jh-btn-ghost jh-btn-sm rc-danger" type="button" onClick={() => setFile(null)} disabled={reading !== null || saving}>Remove</button>
              </div>
            ) : (
              <p className="rc-empty-line">No resume chosen. The fields below can also be filled in by hand.</p>
            )}
          </Section>
        </div>

        {notice && <Notice tone={notice.tone} onClose={() => setNotice(null)}>{notice.text}</Notice>}
        {error && <Notice tone="error" onClose={() => setError(null)}>{error}</Notice>}

        <div className="jh-panel rc-panel-pad">
          <CandidateFormFields form={form} setForm={setForm} showStatus={false} idPrefix="n" />
          <div className="rc-savebar">
            <Link className="jh-btn jh-btn-ghost" to="/candidates">Cancel</Link>
            <div className="rc-actions">
              <button className="jh-btn" type="submit" disabled={saving || reading !== null || !form.full_name.trim()}>
                {saving ? <><Spinner /> Saving</> : created ? 'Attach resume and open' : 'Save candidate'}
              </button>
            </div>
          </div>
        </div>
      </form>
    </main>
  )
}
