// End to end through the HTTP routes, against an in-memory Postgres (PGlite)
// built from the same migration SQL that goes to Neon. No network, no LLM key:
// boards are served from fixtures and scoring uses the keyword stub.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import app from '../src/app.js'
import { setDb, type Database } from '../src/db/client.js'
import { createLocalDb } from '../src/db/local.js'
import { ENDPOINTS, type Ats } from '../src/lib/fetch.js'
import { mockPayloads } from '../src/lib/mock.js'
import { runDaily } from '../src/services/automation.js'
import { ingest, resetSeedState } from '../src/services/companies.js'

let db: Database
const saved = { ...process.env }

const BOARDS: { ats: Ats; slug: string; name: string }[] = [
  { ats: 'greenhouse', slug: 'acme-edge', name: 'Acme Edge' },
  { ats: 'greenhouse', slug: 'novapay', name: 'Novapay' },
  { ats: 'lever', slug: 'quantstack', name: 'Quantstack' },
  { ats: 'ashby', slug: 'helioscale', name: 'Helioscale' },
  { ats: 'greenhouse', slug: 'dead-slug', name: 'Dead Slug' },
]

/** Serves the fixtures at the real ATS URLs; anything else is a 404. */
function fixtureFetch(drop: string[] = []): typeof fetch {
  const payloads = mockPayloads()
  return (async (input: string | URL | Request) => {
    const url = String(input)
    for (const ats of ['greenhouse', 'lever', 'ashby'] as const) {
      for (const [slug, body] of Object.entries(payloads[ats])) {
        if (url === ENDPOINTS[ats].url(slug)) {
          const filtered = ats === 'greenhouse'
            ? { jobs: (body as { jobs: { id: number }[] }).jobs.filter((j) => !drop.includes(String(j.id))) }
            : body
          return Response.json(filtered)
        }
      }
    }
    return new Response('not found', { status: 404 })
  }) as typeof fetch
}

const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method,
    ...(body !== undefined ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
  })
  const text = await res.text()
  return { status: res.status, body: (text && res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text) as any }
}

beforeAll(async () => {
  for (const k of ['DATABASE_URL', 'LLM_PROVIDER', 'SCREEN_PROVIDER', 'DRAFT_PROVIDER', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN',
    'GEMINI_API_KEY', 'GROQ_API_KEY', 'SMTP_USER', 'SMTP_PASS', 'BLOB_READ_WRITE_TOKEN', 'CRON_SECRET', 'VERCEL']) delete process.env[k]
  process.env.SCORING_MODE = 'hybrid' // the default: rules on every job, LLM on the best few when a key exists
  db = await createLocalDb(null)
  setDb(db)
  resetSeedState()
  await db.insertInto('companies').values(BOARDS).execute()
})

afterAll(async () => {
  process.env = { ...saved }
  await db.destroy()
})

describe('boards and ingest', () => {
  it('serves every route with and without the /api prefix', async () => {
    expect((await call('GET', '/api/health')).status).toBe(200)
    expect((await call('GET', '/health')).status).toBe(200)
    expect(await call('GET', '/api/nope')).toEqual({ status: 404, body: { error: 'not found' } })
  })

  it('health reports the stack honestly when nothing is configured', async () => {
    const { body } = await call('GET', '/api/health')
    expect(body).toMatchObject({
      status: 'ok', db: 'pglite', boards: 5, open_jobs: 0, storage: 'local',
      llm: { configured: false, scorer: 'hybrid', provider: null, rescore: { max: 10, min: 5 } },
      mail: { configured: false, to: null },
    })
    expect(body.llm.error).toContain('ANTHROPIC_API_KEY is not set')
  })

  it('ingests the fixtures, records a dead slug, and does not seed over existing boards', async () => {
    const res = await ingest(undefined, fixtureFetch())
    expect(res).toMatchObject({ scanned: 12, inserted: 12, updated: 0, closed: 0 })
    const dead = res.boards.find((b) => b.slug === 'dead-slug')!
    expect(dead).toMatchObject({ ok: false, http_status: 404, fetched: 0, error: 'HTTP 404' })

    const { body } = await call('GET', '/api/companies')
    expect(body.companies).toHaveLength(5)
    const acme = body.companies.find((c: any) => c.slug === 'acme-edge')
    expect(acme).toMatchObject({ last_http_status: 200, last_job_count: 5, open_jobs: 5, is_active: true })
    expect(body.companies.find((c: any) => c.slug === 'dead-slug')).toMatchObject({ last_http_status: 404, open_jobs: 0 })
  })

  it('a second ingest updates in place and closes a posting that disappeared', async () => {
    const res = await ingest(undefined, fixtureFetch(['5501003']))
    expect(res).toMatchObject({ scanned: 11, inserted: 0, updated: 11, closed: 1 })
    const closed = await db.selectFrom('jobs').select(['external_id']).where('closed_at', 'is not', null).execute()
    expect(closed).toEqual([{ external_id: 'greenhouse:acme-edge:5501003' }])
    // It comes back: reopened, not duplicated.
    const again = await ingest(undefined, fixtureFetch())
    expect(again).toMatchObject({ inserted: 0, updated: 12, closed: 0 })
    expect((await call('GET', '/api/health')).body.open_jobs).toBe(12)
  })

  it('validates and manages boards', async () => {
    expect((await call('POST', '/api/companies', { ats: 'workday', slug: 'x' })).status).toBe(400)
    expect((await call('POST', '/api/companies', { ats: 'lever', slug: '../etc' })).status).toBe(400)
    expect((await call('POST', '/api/companies', { ats: 'lever', slug: 'quantstack' })).status).toBe(409)
    const made = await call('POST', '/api/companies', { ats: 'ashby', slug: 'newco' })
    expect(made.status).toBe(201)
    expect(made.body.company).toMatchObject({ name: 'newco', is_active: true, open_jobs: 0 })
    const off = await call('PATCH', `/api/companies/${made.body.company.id}`, { is_active: false, name: 'New Co' })
    expect(off.body.company).toMatchObject({ is_active: false, name: 'New Co' })
    expect((await call('DELETE', `/api/companies/${made.body.company.id}`)).status).toBe(204)
    expect((await call('DELETE', `/api/companies/${made.body.company.id}`)).status).toBe(404)
    expect((await call('DELETE', '/api/companies/not-a-uuid')).status).toBe(404)
  })
})

describe('search', () => {
  it('filters nothing unless asked, and sorts newest first', async () => {
    const { body } = await call('POST', '/api/search', {})
    expect(body.meta).toMatchObject({ scanned: 12, total: 12, match_mode: 'all', limit: 50, offset: 0 })
    expect(body.meta.per_board['greenhouse:Acme Edge']).toBe(5)
    const times = body.jobs.map((j: any) => Date.parse(j.posted_at))
    expect([...times].sort((a, b) => b - a)).toEqual(times)
    expect(body.jobs[0]).toHaveProperty('id')
    expect(body.jobs[0].job_id).toMatch(/^(greenhouse|lever|ashby):/)
  })

  it('combines title search with location, age, ATS, company and job-type filters', async () => {
    const backend = await call('POST', '/api/search', { title: 'Backend Engineer', locations: ['bangalore'], max_age_days: 30 })
    expect(backend.body.jobs.map((j: any) => j.title)).toEqual(['Backend Engineer (Go)'])
    expect(backend.body.meta).toMatchObject({ after_title: 2, match_mode: 'exact', total: 1 })

    const lever = await call('POST', '/api/search', { ats: ['lever'], employment_types: ['Full-time'] })
    expect(lever.body.meta.total).toBe(3)
    const company = await call('POST', '/api/search', { companies: ['novapay'], exclude_titles: ['\\bfrontend\\b'] })
    expect(company.body.jobs.map((j: any) => j.title)).toEqual(['Software Development Engineer, Core Infra'])
    const stale = await call('POST', '/api/search', { max_age_days: 30 })
    expect(stale.body.meta.total).toBe(11)
    const paged = await call('POST', '/api/search', { limit: 5, offset: 10 })
    expect(paged.body.jobs).toHaveLength(2)
  })

  it('hides jobs from a deactivated board', async () => {
    const lever = (await call('GET', '/api/companies')).body.companies.find((c: any) => c.slug === 'quantstack')
    await call('PATCH', `/api/companies/${lever.id}`, { is_active: false })
    expect((await call('POST', '/api/search', {})).body.meta.total).toBe(9)
    await call('PATCH', `/api/companies/${lever.id}`, { is_active: true })
    expect((await call('POST', '/api/search', {})).body.meta.total).toBe(12)
  })

  it('suggests titles and locations from the open jobs', async () => {
    expect((await call('GET', '/api/suggest/titles?q=back')).body.suggestions[0]).toMatch(/^Backend Engineer/)
    expect((await call('GET', '/api/suggest/locations?q=ban')).body.suggestions).toEqual(['Bangalore', 'Bangalore, India'])
    expect((await call('GET', '/api/suggest/locations?limit=3')).body.suggestions).toHaveLength(3)
  })
})

describe('candidate to application', () => {
  let candidateId = ''
  let resumeId = ''
  let applicationId = ''
  let matches: any[] = []

  it('creates a candidate with neutral preferences', async () => {
    expect((await call('POST', '/api/candidates', { full_name: '  ' })).status).toBe(400)
    const made = await call('POST', '/api/candidates', { full_name: 'Asha Rao' })
    expect(made.status).toBe(201)
    candidateId = made.body.candidate.id
    const got = await call('GET', `/api/candidates/${candidateId}`)
    expect(got.body.candidate).toMatchObject({ full_name: 'Asha Rao', status: 'active', profile: null, years_experience: null, salary_currency: 'INR' })
    expect(got.body.preferences).toMatchObject({ target_titles: [], locations: [], allow_remote: true, max_age_days: 30, score_threshold: 7 })
    expect(got.body.resumes).toEqual([])
    expect((await call('GET', '/api/config/defaults')).body.filters).toMatchObject({ score_threshold: 7, max_age_days: 30 })
  })

  it('saves profile fields, clears with null or empty text, and rejects bad values', async () => {
    const saved = await call('PATCH', `/api/candidates/${candidateId}`, {
      email: 'asha@example.com', phone: '', current_title: 'Software Engineer II', years_experience: '3.5',
      requires_sponsorship: false, notice_period_days: 30, expected_salary: 3200000,
      profile: { core_skills: ['Go', 'Kafka', 'Kubernetes', ' Go '], domains: ['distributed systems'], notable_projects: [], education: 'B.E. 2022', target_titles: ['Backend Engineer', 'Software Engineer'], junk: 1 },
      owner_id: 'ignored', id: 'ignored',
    })
    expect(saved.status).toBe(200)
    expect(saved.body.candidate).toMatchObject({
      email: 'asha@example.com', phone: null, years_experience: 3.5, requires_sponsorship: false, expected_salary: 3200000,
      profile: { core_skills: ['Go', 'Kafka', 'Kubernetes'], education: 'B.E. 2022', target_titles: ['Backend Engineer', 'Software Engineer'] },
    })
    expect(saved.body.candidate.profile).not.toHaveProperty('junk')
    expect((await call('PATCH', `/api/candidates/${candidateId}`, { years_experience: -1 })).status).toBe(400)
    expect((await call('PATCH', `/api/candidates/${candidateId}`, { status: 'retired' })).status).toBe(400)
    expect((await call('PATCH', '/api/candidates/00000000-0000-4000-8000-000000000000', { phone: '1' })).status).toBe(404)
  })

  it('saves preferences and names an invalid regex', async () => {
    const bad = await call('PUT', `/api/candidates/${candidateId}/preferences`, { exclude_title_patterns: ['\\bstaff\\b', '(unclosed'] })
    expect(bad).toEqual({ status: 400, body: { error: 'exclude_title_patterns: "(unclosed" is not a valid regular expression' } })
    const ok = await call('PUT', `/api/candidates/${candidateId}/preferences`, {
      target_titles: [], include_title_patterns: [], exclude_title_patterns: ['\\b(staff|senior|manager)\\b'],
      locations: ['bangalore', 'bengaluru', 'india'], allow_remote: true, max_age_days: 30, score_threshold: 6,
    })
    expect(ok.body.preferences).toMatchObject({ locations: ['bangalore', 'bengaluru', 'india'], score_threshold: 6, max_age_days: 30 })
    const anyTime = await call('PUT', `/api/candidates/${candidateId}/preferences`, { ...ok.body.preferences, max_age_days: null })
    expect(anyTime.body.preferences.max_age_days).toBeNull()
    await call('PUT', `/api/candidates/${candidateId}/preferences`, ok.body.preferences)
  })

  it('stores a resume, serves it back, and refuses the wrong type', async () => {
    const upload = async (name: string, content: string | Uint8Array<ArrayBuffer>) => {
      const form = new FormData()
      form.append('file', new File([content], name))
      const res = await app.request(`/api/candidates/${candidateId}/resumes`, { method: 'POST', body: form })
      return { status: res.status, body: (await res.json()) as any }
    }
    expect((await upload('resume.docx', 'x')).status).toBe(415)
    expect((await upload('fake.pdf', 'not a pdf')).status).toBe(415)
    expect((await upload('big.txt', new Uint8Array(4 * 1024 * 1024 + 1))).status).toBe(413)

    const first = await upload('asha.txt', 'Asha Rao\nSoftware Engineer II at Acme Edge\nasha@example.com\n\nBackend engineer with 3.5 years of experience in Go, Kafka and Kubernetes.')
    expect(first.status).toBe(201)
    expect(first.body.resume).toMatchObject({ file_name: 'asha.txt', mime_type: 'text/plain', is_primary: true })
    expect(first.body.resume).not.toHaveProperty('storage_url')
    resumeId = first.body.resume.id
    const second = await upload('asha-v2.md', '# Asha')
    expect(second.body.resume.is_primary).toBe(false)

    const file = await app.request(`/api/candidates/${candidateId}/resumes/${resumeId}/file`)
    expect(file.status).toBe(200)
    expect(await file.text()).toMatch(/^Asha Rao\n/)
    expect(file.headers.get('x-content-type-options')).toBe('nosniff')

    const promoted = await call('POST', `/api/candidates/${candidateId}/resumes/${second.body.resume.id}/primary`)
    expect(promoted.body.resume.is_primary).toBe(true)
    expect((await call('DELETE', `/api/candidates/${candidateId}/resumes/${second.body.resume.id}`)).status).toBe(204)
    const left = (await call('GET', `/api/candidates/${candidateId}`)).body.resumes
    expect(left.map((r: any) => [r.id, r.is_primary])).toEqual([[resumeId, true]])
  })

  it('reads an uploaded resume without storing it', async () => {
    const read = async (name: string, content: string, useLlm = false) => {
      const form = new FormData()
      form.append('file', new File([content], name))
      if (useLlm) form.append('use_llm', 'true')
      const res = await app.request('/api/resumes/read', { method: 'POST', body: form })
      return { status: res.status, body: (await res.json()) as any }
    }
    const ok = await read('cv.txt', 'Priya Nair\nBackend Engineer at Zeta\npriya@example.com\n\n5 years of experience with Python, Django and PostgreSQL.')
    expect(ok.status).toBe(200)
    expect(ok.body.extracted.fields).toMatchObject({ full_name: 'Priya Nair', email: 'priya@example.com', current_title: 'Backend Engineer', current_company: 'Zeta', years_experience: 5 })
    expect(ok.body.extracted.profile.core_skills).toEqual(expect.arrayContaining(['Python', 'Django', 'PostgreSQL']))
    expect((await read('cv.docx', 'x')).status).toBe(415)
    expect((await read('cv.txt', 'too short')).status).toBe(422)
    expect((await read('cv.txt', 'Priya Nair\nBackend Engineer with 5 years of experience in Python.', true)).status).toBe(503)
    const before = await db.selectFrom('candidate_resumes').select((eb) => eb.fn.countAll().as('n')).executeTakeFirstOrThrow()
    expect(Number(before.n)).toBe(1) // only the resume uploaded earlier; reads store nothing
  })

  it('extracts a profile with rules for free, and says plainly when the LLM is asked for without a key', async () => {
    const res = await call('POST', `/api/candidates/${candidateId}/resumes/${resumeId}/extract`, {})
    expect(res.status).toBe(200)
    expect(res.body.extracted.model).toBe('rules')
    expect(res.body.extracted.fields).toMatchObject({ full_name: 'Asha Rao', years_experience: 3.5 })
    expect(res.body.extracted.profile.core_skills).toEqual(expect.arrayContaining(['Go', 'Kafka', 'Kubernetes']))
    const llm = await call('POST', `/api/candidates/${candidateId}/resumes/${resumeId}/extract`, { use_llm: true })
    expect(llm.status).toBe(503)
    expect(llm.body.error).toContain('ANTHROPIC_API_KEY is not set')
  })

  it('matches: gates first, screens only what is new, and never rescreens a pair', async () => {
    const first = await call('POST', `/api/candidates/${candidateId}/match`, {})
    // Target titles come from the profile; "Staff"/"Senior"/"Manager" are excluded;
    // San Francisco fails the location gate.
    // No LLM key: hybrid mode keeps every rule score and says why the LLM step was skipped.
    expect(first.body).toMatchObject({
      open_jobs: 12, passed_filters: 4, already_matched: 0, screened: 4, scored: 4, failed_batches: 0,
      scorer: 'hybrid', model: null, llm_rescored: 0, llm_candidates: 0, remaining: 0,
    })
    expect(first.body.llm_error).toContain('ANTHROPIC_API_KEY is not set')
    const again = await call('POST', `/api/candidates/${candidateId}/match`, {})
    expect(again.body).toMatchObject({ passed_filters: 4, already_matched: 4, screened: 0, scored: 0 })

    matches = (await call('GET', `/api/candidates/${candidateId}/matches?status=all`)).body.matches
    expect(matches.map((m) => m.job.title).sort()).toEqual([
      'Backend Engineer (Go)',
      'Software Development Engineer, Core Infra',
      'Software Engineer II, Distributed Systems',
      'Software Engineer, Networking',
    ])
    const scores = matches.map((m) => m.score)
    expect([...scores].sort((a, b) => b - a)).toEqual(scores)
    expect(matches[0]).toMatchObject({ status: 'new', application: null, model: 'rules' })
    expect(matches[0].reason).toMatch(/^\[rules\] Title fits "/)
    expect(matches[0].rule_score).toBe(matches[0].score)
    expect(matches[0].rule_reason).toBe(matches[0].reason)
    expect(first.body.above_threshold).toBe(scores.filter((s) => s >= 6).length)
  })

  it('shortlists and dismisses matches', async () => {
    const m = matches[matches.length - 1]
    expect((await call('PATCH', `/api/matches/${m.id}`, { status: 'archived' })).status).toBe(400)
    expect((await call('PATCH', `/api/matches/${m.id}`, { status: 'dismissed' })).body.match.status).toBe('dismissed')
    expect((await call('GET', `/api/candidates/${candidateId}/matches?status=new`)).body.matches).toHaveLength(3)
    expect((await call('GET', `/api/candidates/${candidateId}/matches?status=dismissed`)).body.matches).toHaveLength(1)
    const list = (await call('GET', '/api/candidates')).body.candidates
    expect(list[0]).toMatchObject({ full_name: 'Asha Rao', has_resume: true, new_matches: 3, applications: 0 })
  })

  it('starts one application per candidate and job, with the primary resume attached', async () => {
    const top = matches[0]
    const made = await call('POST', '/api/applications', { candidate_id: candidateId, job_id: top.job.id })
    expect(made.status).toBe(201)
    expect(made.body.application).toMatchObject({ status: 'draft', match_id: top.id, resume_id: resumeId, tailored_bullets: [], cover_note: null })
    applicationId = made.body.application.id
    const dup = await call('POST', '/api/applications', { candidate_id: candidateId, job_id: top.job.id })
    expect(dup.status).toBe(200)
    expect(dup.body.application.id).toBe(applicationId)
    expect((await call('POST', '/api/applications', { candidate_id: candidateId, job_id: '00000000-0000-4000-8000-000000000000' })).status).toBe(404)
    const linked = (await call('GET', `/api/candidates/${candidateId}/matches`)).body.matches.find((m: any) => m.id === top.id)
    expect(linked.application).toEqual({ id: applicationId, status: 'draft' })
  })

  it('drafts a template kit for free, edits it, and says drafting with the LLM needs a key', async () => {
    const template = await call('POST', `/api/applications/${applicationId}/draft`, {})
    expect(template.status).toBe(200)
    expect(template.body.application.cover_note).toContain('is hiring a')
    expect(template.body.application.gaps.length + template.body.application.tailored_bullets.length).toBeGreaterThan(0)
    expect((await call('POST', `/api/applications/${applicationId}/draft`, { use_llm: true })).status).toBe(503)
    const edit = await call('PATCH', `/api/applications/${applicationId}`, {
      cover_note: 'I have run Go services on Kubernetes for three years.', tailored_bullets: ['  Cut p99 latency  ', ''], fit_summary: '',
    })
    expect(edit.body.application).toMatchObject({ tailored_bullets: ['Cut p99 latency'], fit_summary: null })
    expect((await call('PATCH', `/api/applications/${applicationId}`, { resume_id: '00000000-0000-4000-8000-000000000000' })).status).toBe(400)
  })

  it('walks approve, mark submitted and withdraw, refusing steps out of order', async () => {
    const act = (action: string) => call('POST', `/api/applications/${applicationId}/${action}`)
    expect((await act('mark-submitted')).body).toEqual({ error: 'Cannot mark as submitted an application that is draft.' })
    expect((await act('explode')).status).toBe(404)

    const approved = await act('approve')
    expect(approved.body.application.status).toBe('approved')
    expect(approved.body.application.approved_at).not.toBeNull()
    expect((await call('PATCH', `/api/applications/${applicationId}`, { cover_note: 'changed' })).status).toBe(409)
    expect((await act('approve')).status).toBe(409)

    expect((await act('reopen')).body.application).toMatchObject({ status: 'draft', approved_at: null })
    await act('approve')
    const submitted = await act('mark-submitted')
    expect(submitted.body.application.status).toBe('submitted')
    expect(submitted.body.application.submitted_at).not.toBeNull()
    expect((await act('reopen')).status).toBe(409)

    const detail = await call('GET', `/api/applications/${applicationId}`)
    expect(detail.body.candidate).toMatchObject({ full_name: 'Asha Rao', email: 'asha@example.com' })
    expect(detail.body.job.title).toBe(matches[0].job.title)
    expect(detail.body.resumes).toHaveLength(1)
    expect(detail.body.events.map((e: any) => e.type)).toEqual([
      'marked_submitted', 'approved', 'reopened', 'approved', 'kit_edited', 'kit_generated', 'created',
    ])
    expect(detail.body.events[0]).toMatchObject({ actor: 'Recruiter', detail: { method: 'manual', from: 'approved' } })

    const listed = await call('GET', `/api/applications?candidate_id=${candidateId}&status=submitted`)
    expect(listed.body.applications).toHaveLength(1)
    expect(listed.body.applications[0]).toMatchObject({ status: 'submitted', score: matches[0].score, candidate: { full_name: 'Asha Rao' } })
    expect((await call('GET', '/api/applications?status=draft')).body.applications).toEqual([])
    expect((await call('GET', '/api/applications?status=bogus')).status).toBe(400)
    expect((await act('withdraw')).body.application.status).toBe('withdrawn')
  })

  it('previews the digest and reports that email is not configured', async () => {
    const res = await app.request(`/api/candidates/${candidateId}/digest`)
    expect(res.headers.get('content-type')).toContain('text/html')
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'")
    const html = await res.text()
    expect(html).toContain('Job digest: Asha Rao')
    expect(html).toContain('I have run Go services on Kubernetes') // the kit from the application
    const send = await call('POST', `/api/candidates/${candidateId}/digest`)
    expect(send.status).toBe(503)
    expect(send.body.error).toContain('Email is not configured')
  })

  it('a board with applications cannot be deleted, only deactivated', async () => {
    const companyId = matches[0].job.company_id
    const res = await call('DELETE', `/api/companies/${companyId}`)
    expect(res.status).toBe(409)
    expect(res.body.error).toContain('Deactivate it instead')
  })

  it('deletes an application and its history, keeping the match', async () => {
    const second = await call('POST', '/api/applications', { candidate_id: candidateId, job_id: matches[1].job.id })
    expect(second.status).toBe(201)
    expect((await call('DELETE', `/api/applications/${second.body.application.id}`)).status).toBe(204)
    expect((await call('GET', `/api/applications/${second.body.application.id}`)).status).toBe(404)
    expect((await call('DELETE', `/api/applications/${second.body.application.id}`)).status).toBe(404)
    const still = (await call('GET', `/api/candidates/${candidateId}/matches?status=all`)).body.matches.find((m: any) => m.id === matches[1].id)
    expect(still).toMatchObject({ application: null })
  })

  it('deleting a candidate removes their resumes, matches and applications', async () => {
    expect((await call('DELETE', `/api/candidates/${candidateId}`)).status).toBe(204)
    expect((await call('GET', `/api/candidates/${candidateId}`)).status).toBe(404)
    for (const table of ['candidate_resumes', 'candidate_preferences', 'matches', 'applications', 'application_events'] as const) {
      const row = await db.selectFrom(table).select((eb) => eb.fn.countAll().as('n')).executeTakeFirstOrThrow()
      expect(Number(row.n), table).toBe(0)
    }
    const file = await app.request(`/api/candidates/${candidateId}/resumes/${resumeId}/file`)
    expect(file.status).toBe(404)
  })
})

describe('daily run', () => {
  it('requires the cron secret when one is set', async () => {
    process.env.CRON_SECRET = 's3cret'
    expect((await call('GET', '/api/cron/daily')).status).toBe(401)
    delete process.env.CRON_SECRET
  })

  it('prepares a template draft for each open match above threshold, skips dismissed ones, and never repeats', async () => {
    const made = await call('POST', '/api/candidates', { full_name: 'Ravi Menon' })
    const id = made.body.candidate.id
    await call('PATCH', `/api/candidates/${id}`, {
      current_title: 'Software Engineer II', years_experience: 3,
      profile: { core_skills: ['Go', 'Kafka', 'Kubernetes'], domains: ['distributed systems'], notable_projects: [], education: '', target_titles: ['Backend Engineer', 'Software Engineer'] },
    })
    await call('PUT', `/api/candidates/${id}/preferences`, {
      target_titles: [], include_title_patterns: [], exclude_title_patterns: ['\\b(staff|senior|manager)\\b'],
      locations: ['bangalore', 'bengaluru', 'india'], allow_remote: true, max_age_days: null, score_threshold: 0,
    })
    await call('POST', `/api/candidates/${id}/match`, {})
    const matches = (await call('GET', `/api/candidates/${id}/matches`)).body.matches
    expect(matches.length).toBeGreaterThan(1)
    await call('PATCH', `/api/matches/${matches[0].id}`, { status: 'dismissed' })

    const run = await runDaily({ trigger: 'manual', ingest: false })
    const row = run.candidates.find((r) => r.candidate_id === id)
    expect(row).toMatchObject({ prepared: matches.length - 1, error: null })

    const apps = (await call('GET', `/api/applications?candidate_id=${id}`)).body.applications
    expect(apps).toHaveLength(matches.length - 1)
    expect(apps.every((a: any) => a.status === 'draft')).toBe(true)
    expect(apps.map((a: any) => a.job.id)).not.toContain(matches[0].job.id)
    const detail = (await call('GET', `/api/applications/${apps[0].id}`)).body
    expect(detail.application.cover_note).toContain('is hiring a')
    expect(detail.events.map((e: any) => e.type).sort()).toEqual(['created', 'kit_generated'])

    const again = await runDaily({ trigger: 'manual', ingest: false })
    expect(again.candidates.find((r) => r.candidate_id === id)?.prepared).toBe(0)
    await call('DELETE', `/api/candidates/${id}`)
  })
})
