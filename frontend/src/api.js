const BASE = '/api'

export async function searchJobs(params) {
  const res = await fetch(`${BASE}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  if (!res.ok) throw new Error(`Search failed: ${res.status}`)
  return res.json()
}

export async function getCompanies() {
  const res = await fetch(`${BASE}/companies`)
  if (!res.ok) throw new Error('Failed to load companies')
  return res.json()
}

export async function getDefaults() {
  const res = await fetch(`${BASE}/config/defaults`)
  if (!res.ok) throw new Error('Failed to load defaults')
  return res.json()
}

export async function suggestTitles(q, useMock=false) {
  const res = await fetch(`${BASE}/suggest/titles?q=${encodeURIComponent(q)}&use_mock=${useMock}`)
  if (!res.ok) return { suggestions: [] }
  return res.json()
}

export async function suggestLocations(q, useMock=false) {
  const res = await fetch(`${BASE}/suggest/locations?q=${encodeURIComponent(q)}&use_mock=${useMock}`)
  if (!res.ok) return { suggestions: [] }
  return res.json()
}
