// Autocomplete for the search box and the location filter.

import { ratio } from './difflib.js'

const normalize = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

const FALLBACK_TITLES = [
  'Backend Engineer', 'Software Engineer', 'Frontend Engineer', 'Data Scientist',
  'SDE', 'SRE', 'Python Developer', 'AI/ML Engineer',
]

const STATIC_LOCATIONS = [
  'Bangalore, India', 'Bengaluru, India', 'Hyderabad, India', 'Pune, India', 'Delhi, India',
  'Mumbai, India', 'Chennai, India', 'Remote (India)', 'Remote', 'India',
]

/** With no query, most frequent first. With a query: prefix, word, substring, then fuzzy. */
export function rankSuggestions(candidates: string[], query: string, limit = 6): string[] {
  const qNorm = normalize(query)
  const firstSpelling = new Map<string, string>()
  const counts = new Map<string, number>()
  for (const c of candidates) {
    const k = c.toLowerCase().trim()
    if (!firstSpelling.has(k)) firstSpelling.set(k, c)
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  const uniq = [...firstSpelling.values()]
  const key = (s: string) => s.toLowerCase().trim()
  const alpha = (a: string, b: string) => (a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0)

  if (!qNorm) {
    return uniq.sort((a, b) => counts.get(key(b))! - counts.get(key(a))! || alpha(a, b)).slice(0, limit)
  }
  const scored: { rank: number; c: string }[] = []
  for (const c of uniq) {
    const cn = normalize(c)
    if (cn.startsWith(qNorm)) scored.push({ rank: 0, c })
    else if (cn.split(' ').some((tok) => tok.startsWith(qNorm) || tok.includes(qNorm))) scored.push({ rank: 1, c })
    else if (cn.includes(qNorm)) scored.push({ rank: 2, c })
    else if (ratio(qNorm, cn) >= 0.6) scored.push({ rank: 3, c })
  }
  return scored.sort((a, b) => a.rank - b.rank || alpha(a.c, b.c)).slice(0, limit).map((x) => x.c)
}

export function titleSuggestions(titles: string[], query: string, limit = 6): string[] {
  const live = titles.filter(Boolean)
  return rankSuggestions(live.length > 0 ? live : FALLBACK_TITLES, query, limit)
}

export function locationSuggestions(locations: string[], query: string, limit = 6): string[] {
  const candidates = new Set<string>(STATIC_LOCATIONS)
  for (const raw of locations) {
    const loc = raw.trim()
    if (!loc) continue
    candidates.add(loc)
    for (const part of loc.split(/[,/]/)) {
      const p = part.trim()
      if (p) candidates.add(p)
    }
  }
  return rankSuggestions([...candidates], query, limit)
}
