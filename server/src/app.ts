// HTTP routes. Every route is reachable at both /x and /api/x: the browser and
// Vercel call /api/x, and nothing depends on a proxy stripping the prefix.
//
// There is no login yet. Anyone who can reach this API can read and change
// every candidate, so keep real candidate data off a public deployment until
// authentication is added.

import { Hono, type Context } from 'hono'
import { getDb, getDbKind } from './db/client.js'
import { HttpError, requireUuid } from './http.js'
import { mailConfig } from './lib/mailer.js'
import { LLMError, resolve } from './lib/providers.js'
import { storageKind } from './lib/storage.js'
import * as applications from './services/applications.js'
import * as automation from './services/automation.js'
import * as candidates from './services/candidates.js'
import * as companies from './services/companies.js'
import { candidateDigest, sendCandidateDigest } from './services/digest.js'
import * as jobs from './services/jobs.js'
import * as matching from './services/matching.js'

const api = new Hono()

/** A missing or malformed JSON body is treated as an empty object. */
const json = async (c: Context): Promise<unknown> => c.req.json().catch(() => ({}))
const id = (c: Context, name: string, what: string): string => requireUuid(c.req.param(name), what)

// ------------------------------------------------------------------ status --

function llmStatus() {
  const scorer = matching.scorerMode()
  const rescore = matching.rescoreLimits()
  try {
    const screen = resolve('screen')
    const draft = resolve('draft')
    return { configured: true, scorer, rescore, provider: screen.provider.name, screen_model: screen.model, draft_model: draft.model, error: null }
  } catch (e) {
    if (!(e instanceof LLMError)) throw e
    return { configured: false, scorer, rescore, provider: null, screen_model: null, draft_model: null, error: e.message }
  }
}

api.get('/health', async (c) => {
  const db = await getDb()
  await companies.ensureSeeded(db)
  const boards = await db.selectFrom('companies').select((eb) => eb.fn.countAll().as('n')).where('is_active', '=', true).executeTakeFirstOrThrow()
  const open = await db.selectFrom('jobs').select((eb) => eb.fn.countAll().as('n')).where('closed_at', 'is', null).executeTakeFirstOrThrow()
  const mail = mailConfig()
  return c.json({
    status: 'ok',
    db: await getDbKind(),
    boards: Number(boards.n),
    open_jobs: Number(open.n),
    llm: llmStatus(),
    storage: storageKind(),
    mail: { configured: mail !== null, to: mail?.to ?? null },
  })
})

api.get('/config/defaults', (c) => c.json({ filters: candidates.DEFAULT_PREFERENCES }))

// ------------------------------------------------------------------ boards --

api.get('/companies', async (c) => c.json({ companies: await companies.listCompanies() }))
api.post('/companies', async (c) => c.json({ company: await companies.createCompany(await json(c)) }, 201))
api.patch('/companies/:id', async (c) => c.json({ company: await companies.updateCompany(id(c, 'id', 'board'), await json(c)) }))
api.delete('/companies/:id', async (c) => {
  await companies.deleteCompany(id(c, 'id', 'board'))
  return c.body(null, 204)
})

api.post('/ingest', async (c) => {
  const body = (await json(c)) as { company_id?: unknown }
  const companyId = body.company_id == null || body.company_id === '' ? undefined : requireUuid(String(body.company_id), 'board')
  return c.json(await companies.ingest(companyId))
})

// ------------------------------------------------------------------ search --

api.post('/search', async (c) => c.json(await jobs.search(await json(c))))
api.get('/suggest/titles', async (c) => c.json({ suggestions: await jobs.suggestTitles(c.req.query('q') ?? '', c.req.query('limit')) }))
api.get('/suggest/locations', async (c) => c.json({ suggestions: await jobs.suggestLocations(c.req.query('q') ?? '', c.req.query('limit')) }))

// -------------------------------------------------------------- candidates --

api.get('/candidates', async (c) => c.json({ candidates: await candidates.listCandidates() }))
api.post('/candidates', async (c) => c.json({ candidate: await candidates.createCandidate(await json(c)) }, 201))
api.get('/candidates/:id', async (c) => c.json(await candidates.getCandidate(id(c, 'id', 'candidate'))))
api.patch('/candidates/:id', async (c) => c.json({ candidate: await candidates.updateCandidate(id(c, 'id', 'candidate'), await json(c)) }))
api.delete('/candidates/:id', async (c) => {
  await candidates.deleteCandidate(id(c, 'id', 'candidate'))
  return c.body(null, 204)
})
api.put('/candidates/:id/preferences', async (c) =>
  c.json({ preferences: await candidates.savePreferences(id(c, 'id', 'candidate'), await json(c)) }))

api.post('/candidates/:id/resumes', async (c) => {
  const candidateId = id(c, 'id', 'candidate')
  // Refuse an oversized upload from its declared length, before buffering it.
  if (Number(c.req.header('content-length') ?? 0) > candidates.MAX_RESUME_BYTES + 64 * 1024) {
    throw new HttpError(413, 'The file is larger than 4 MB.')
  }
  const form = await c.req.parseBody().catch(() => {
    throw new HttpError(400, 'file: attach the resume as multipart field "file"')
  })
  return c.json({ resume: await candidates.addResume(candidateId, form.file) }, 201)
})

api.get('/candidates/:id/resumes/:rid/file', async (c) => {
  const file = await candidates.readResumeFile(id(c, 'id', 'candidate'), id(c, 'rid', 'resume'))
  const ascii = file.file_name.replace(/[^\x20-\x7e]|["\\]/g, '_')
  const disposition = file.mime_type === 'application/pdf' ? 'inline' : 'attachment'
  return new Response(new Uint8Array(file.bytes), {
    headers: {
      'Content-Type': file.mime_type === 'application/pdf' ? file.mime_type : 'text/plain; charset=utf-8',
      'Content-Disposition': `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.file_name)}`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  })
})

// Reads a resume without storing it, for the "new candidate" form.
api.post('/resumes/read', async (c) => {
  if (Number(c.req.header('content-length') ?? 0) > candidates.MAX_RESUME_BYTES + 64 * 1024) {
    throw new HttpError(413, 'The file is larger than 4 MB.')
  }
  const form = await c.req.parseBody().catch(() => {
    throw new HttpError(400, 'file: attach the resume as multipart field "file"')
  })
  return c.json({ extracted: await candidates.readResumeUpload(form.file, form.use_llm) })
})

api.post('/candidates/:id/resumes/:rid/primary', async (c) =>
  c.json({ resume: await candidates.setPrimaryResume(id(c, 'id', 'candidate'), id(c, 'rid', 'resume')) }))
api.delete('/candidates/:id/resumes/:rid', async (c) => {
  await candidates.deleteResume(id(c, 'id', 'candidate'), id(c, 'rid', 'resume'))
  return c.body(null, 204)
})
api.post('/candidates/:id/resumes/:rid/extract', async (c) =>
  c.json({ extracted: await candidates.extractFromResume(id(c, 'id', 'candidate'), id(c, 'rid', 'resume'), await json(c)) }))

// ---------------------------------------------------------------- matching --

api.post('/candidates/:id/match', async (c) => c.json(await matching.runMatch(id(c, 'id', 'candidate'), await json(c))))
api.get('/candidates/:id/matches', async (c) =>
  c.json({ matches: await matching.listMatches(id(c, 'id', 'candidate'), c.req.query('status')) }))
api.patch('/matches/:id', async (c) => c.json({ match: await matching.updateMatch(id(c, 'id', 'match'), await json(c)) }))

api.get('/candidates/:id/digest', async (c) => {
  const digest = await candidateDigest(id(c, 'id', 'candidate'))
  // The page holds job-board and model text. It is escaped, and this stops
  // anything that slipped through from running.
  c.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'")
  return c.html(digest.html)
})
api.post('/candidates/:id/digest', async (c) => c.json(await sendCandidateDigest(id(c, 'id', 'candidate'))))

// ------------------------------------------------------------ applications --

api.get('/applications', async (c) => c.json({ applications: await applications.listApplications(c.req.query()) }))
api.post('/applications', async (c) => {
  const res = await applications.createApplication(await json(c))
  return c.json({ application: res.application }, res.created ? 201 : 200)
})
api.get('/applications/:id', async (c) => c.json(await applications.getApplication(id(c, 'id', 'application'))))
api.patch('/applications/:id', async (c) =>
  c.json({ application: await applications.updateApplication(id(c, 'id', 'application'), await json(c)) }))
api.delete('/applications/:id', async (c) => {
  await applications.deleteApplication(id(c, 'id', 'application'))
  return c.body(null, 204)
})
api.post('/applications/:id/draft', async (c) =>
  c.json({ application: await applications.draftApplication(id(c, 'id', 'application'), await json(c)) }))
api.post('/applications/:id/:action', async (c) =>
  c.json({ application: await applications.transition(id(c, 'id', 'application'), c.req.param('action')) }))

// ----------------------------------------------------------------- schedule --

/**
 * The daily run: refresh the boards, screen new jobs for every active
 * candidate, prepare draft applications for the matches above threshold, and
 * email a digest where SMTP is configured. Nothing is submitted. Vercel Cron
 * calls this with `Authorization: Bearer $CRON_SECRET`.
 */
api.get('/cron/daily', async (c) => {
  const secret = (process.env.CRON_SECRET ?? '').trim()
  if (secret && c.req.header('authorization') !== `Bearer ${secret}`) throw new HttpError(401, 'unauthorized')
  return c.json(await automation.runDaily({ trigger: 'cron' }))
})

// ------------------------------------------------------------------ errors --

function onError(err: Error, c: Context) {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status)
  if (err instanceof LLMError) return c.json({ error: err.message }, 502)
  console.error(`[${c.req.method} ${c.req.path}]`, err)
  return c.json({ error: 'Something went wrong on the server. The error has been logged.' }, 500)
}

const app = new Hono()
app.route('/api', api)
app.route('/', api)
app.onError(onError)
app.notFound((c) => c.json({ error: 'not found' }, 404))

export default app
