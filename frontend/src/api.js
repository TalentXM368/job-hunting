// Every network call the app makes lives here.
// Non-2xx responses carry JSON `{ error: string }`; that message is what
// `ApiError.message` holds, so callers can show it to the user as is.

const BASE = '/api'

export class ApiError extends Error {
  constructor(message, status) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

function query(params) {
  const usp = new URLSearchParams()
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null && v !== '') usp.set(k, String(v))
  }
  const s = usp.toString()
  return s ? `?${s}` : ''
}

async function request(path, { method = 'GET', body, form } = {}) {
  const init = { method }
  if (form) {
    init.body = form
  } else if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' }
    init.body = JSON.stringify(body)
  }

  let res
  try {
    res = await fetch(`${BASE}${path}`, init)
  } catch {
    throw new ApiError('Could not reach the server. Check that the API is running.', 0)
  }
  if (res.status === 204) return null

  const text = await res.text()
  let data = null
  if (text) {
    try { data = JSON.parse(text) } catch { data = null }
  }
  if (!res.ok) {
    throw new ApiError(data?.error || `Request failed (${res.status})`, res.status)
  }
  return data
}

// ---- status ---------------------------------------------------------------
export const getHealth = () => request('/health')
export const getDefaults = () => request('/config/defaults')

// ---- career boards --------------------------------------------------------
export const listCompanies = () => request('/companies')
export const createCompany = (body) => request('/companies', { method: 'POST', body })
export const updateCompany = (id, body) => request(`/companies/${id}`, { method: 'PATCH', body })
export const deleteCompany = (id) => request(`/companies/${id}`, { method: 'DELETE' })
// Pass a company id to fetch one board; omit it to refresh every active board.
export const runIngest = (companyId) =>
  request('/ingest', { method: 'POST', body: companyId ? { company_id: companyId } : {} })

// ---- job search -----------------------------------------------------------
export const searchJobs = (params) => request('/search', { method: 'POST', body: params })

// Suggestions are a convenience: a failure should leave the box empty, not
// interrupt typing with an error.
async function suggest(kind, q, limit) {
  try {
    const data = await request(`/suggest/${kind}${query({ q, limit })}`)
    return data?.suggestions || []
  } catch {
    return []
  }
}
export const suggestTitles = (q, limit = 6) => suggest('titles', q, limit)
export const suggestLocations = (q, limit = 6) => suggest('locations', q, limit)

// ---- candidates -----------------------------------------------------------
export const listCandidates = () => request('/candidates')
export const createCandidate = (body) => request('/candidates', { method: 'POST', body })
export const getCandidate = (id) => request(`/candidates/${id}`)
export const updateCandidate = (id, body) => request(`/candidates/${id}`, { method: 'PATCH', body })
export const deleteCandidate = (id) => request(`/candidates/${id}`, { method: 'DELETE' })
export const savePreferences = (id, body) => request(`/candidates/${id}/preferences`, { method: 'PUT', body })

// ---- resumes --------------------------------------------------------------
export function uploadResume(candidateId, file) {
  const form = new FormData()
  form.append('file', file)
  return request(`/candidates/${candidateId}/resumes`, { method: 'POST', form })
}
export const resumeFileUrl = (candidateId, resumeId) => `${BASE}/candidates/${candidateId}/resumes/${resumeId}/file`
export const setPrimaryResume = (candidateId, resumeId) =>
  request(`/candidates/${candidateId}/resumes/${resumeId}/primary`, { method: 'POST' })
export const deleteResume = (candidateId, resumeId) =>
  request(`/candidates/${candidateId}/resumes/${resumeId}`, { method: 'DELETE' })
// Reads a file without storing it; the "new candidate" form fills itself from the result.
export function readResume(file, useLlm = false) {
  const form = new FormData()
  form.append('file', file)
  if (useLlm) form.append('use_llm', 'true')
  return request('/resumes/read', { method: 'POST', form })
}
// body: { use_llm?: boolean }. Default reads the resume with rules, for free.
export const extractResume = (candidateId, resumeId, body = {}) =>
  request(`/candidates/${candidateId}/resumes/${resumeId}/extract`, { method: 'POST', body })

// ---- matching -------------------------------------------------------------
// body: { limit?: number, use_llm?: boolean }. Omit use_llm to follow the server's scoring mode.
export const runMatch = (candidateId, body = {}) =>
  request(`/candidates/${candidateId}/match`, { method: 'POST', body })
export const listMatches = (candidateId, status = 'all') =>
  request(`/candidates/${candidateId}/matches${query({ status })}`)
export const updateMatch = (matchId, status) => request(`/matches/${matchId}`, { method: 'PATCH', body: { status } })
export const digestPreviewUrl = (candidateId) => `${BASE}/candidates/${candidateId}/digest`
export const sendDigest = (candidateId) => request(`/candidates/${candidateId}/digest`, { method: 'POST' })

// ---- applications ---------------------------------------------------------
export const listApplications = (filters) => request(`/applications${query(filters)}`)
export const createApplication = (body) => request('/applications', { method: 'POST', body })
export const getApplication = (id) => request(`/applications/${id}`)
export const updateApplication = (id, body) => request(`/applications/${id}`, { method: 'PATCH', body })
export const deleteApplication = (id) => request(`/applications/${id}`, { method: 'DELETE' })
// action: 'draft' | 'approve' | 'reopen' | 'mark-submitted' | 'withdraw'
// 'draft' takes body { use_llm?: boolean }; the default builds a free template kit.
export const applicationAction = (id, action, body = {}) => request(`/applications/${id}/${action}`, { method: 'POST', body })
