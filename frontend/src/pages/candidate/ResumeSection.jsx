import { useRef, useState } from 'react'
import { deleteResume, extractResume, resumeFileUrl, setPrimaryResume, uploadResume } from '../../api'
import { Section, Spinner } from '../../components/Field'
import Notice from '../../components/Notice'
import { formatBytes, formatDate } from '../../format'
import { useHealth } from '../../healthContext'

const MAX_BYTES = 4 * 1024 * 1024
const ALLOWED = ['.pdf', '.txt', '.md']

// Upload, list and manage a candidate's resumes. `onExtracted` receives the
// suggested fields and profile; the parent merges them into its form.
export default function ResumeSection({ candidateId, resumes, onChanged, onExtracted }) {
  const llmOk = Boolean(useHealth().health?.llm?.configured)
  const inputRef = useRef(null)
  const [busy, setBusy] = useState(null) // 'upload' | `${action}:${resumeId}`
  const [error, setError] = useState(null)

  const run = async (key, fn) => {
    setBusy(key)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(null)
    }
  }

  const onFile = (e) => {
    const file = e.target.files?.[0]
    e.target.value = '' // let the same file be picked again after an error
    if (!file) return
    const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase()
    if (!ALLOWED.includes(ext)) {
      setError(`“${file.name}” is not supported. Upload a PDF, .txt or .md file.`)
      return
    }
    if (file.size > MAX_BYTES) {
      setError(`“${file.name}” is ${formatBytes(file.size)}. The limit is 4 MB.`)
      return
    }
    const firstResume = resumes.length === 0
    run('upload', async () => {
      const { resume } = await uploadResume(candidateId, file)
      await onChanged()
      // A candidate's first resume fills the form on its own (rules, no AI).
      // Later uploads do not, so an edited profile is never overwritten unasked.
      if (firstResume) {
        const { extracted } = await extractResume(candidateId, resume.id, {})
        onExtracted(extracted, resume)
      }
    })
  }

  const remove = (r) => {
    if (!window.confirm(`Delete “${r.file_name}”? This cannot be undone.`)) return
    run(`delete:${r.id}`, async () => {
      await deleteResume(candidateId, r.id)
      await onChanged()
    })
  }

  const makePrimary = (r) => run(`primary:${r.id}`, async () => {
    await setPrimaryResume(candidateId, r.id)
    await onChanged()
  })

  // Rules read the resume for free. The AI button sends it to the LLM instead.
  const extract = (r, useLlm) => run(`${useLlm ? 'ai' : 'extract'}:${r.id}`, async () => {
    const { extracted } = await extractResume(candidateId, r.id, useLlm ? { use_llm: true } : {})
    onExtracted(extracted, r)
  })

  return (
    <Section
      title="Resume"
      sub="PDF, .txt or .md, up to 4 MB. The primary resume is the one attached to applications by default."
      actions={
        <>
          <input ref={inputRef} type="file" accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown" onChange={onFile} hidden />
          <button className="jh-btn jh-btn-ghost jh-btn-sm" type="button" onClick={() => inputRef.current?.click()} disabled={busy !== null}>
            {busy === 'upload' ? <><Spinner /> Uploading</> : 'Upload resume'}
          </button>
        </>
      }
    >
      {error && <Notice tone="error" onClose={() => setError(null)}>{error}</Notice>}
      {resumes.length === 0 ? (
        <p className="rc-empty-line">No resume uploaded yet.</p>
      ) : (
        <ul className="rc-files">
          {resumes.map((r) => (
            <li key={r.id} className="rc-file">
              <div className="rc-file-main">
                <a className="rc-cell-title" href={resumeFileUrl(candidateId, r.id)} target="_blank" rel="noreferrer">{r.file_name}</a>
                <div className="rc-cell-sub">
                  {formatBytes(r.size_bytes)} · uploaded {formatDate(r.uploaded_at).toLowerCase()}
                  {r.is_primary && <span className="jh-badge teal rc-inline-badge">Primary</span>}
                </div>
              </div>
              <div className="rc-actions">
                <button className="jh-btn jh-btn-ghost jh-btn-sm" type="button" onClick={() => extract(r, false)} disabled={busy !== null} title="Reads the resume text with rules. Free and instant.">
                  {busy === `extract:${r.id}` ? <><Spinner /> Reading resume</> : 'Extract profile'}
                </button>
                {llmOk && (
                  <button className="jh-btn jh-btn-ghost jh-btn-sm" type="button" onClick={() => extract(r, true)} disabled={busy !== null} title="Sends the resume to the LLM. Better at prose resumes; costs tokens.">
                    {busy === `ai:${r.id}` ? <><Spinner /> Asking the model</> : 'Extract with AI'}
                  </button>
                )}
                {!r.is_primary && (
                  <button className="jh-btn jh-btn-ghost jh-btn-sm" type="button" onClick={() => makePrimary(r)} disabled={busy !== null}>
                    {busy === `primary:${r.id}` ? <Spinner /> : 'Set primary'}
                  </button>
                )}
                <button className="jh-btn jh-btn-ghost jh-btn-sm rc-danger" type="button" onClick={() => remove(r)} disabled={busy !== null}>
                  {busy === `delete:${r.id}` ? <Spinner /> : 'Delete'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}
