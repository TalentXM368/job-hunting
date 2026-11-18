import { describe, expect, it } from 'vitest'
import { ratio } from '../src/lib/difflib.js'
import { fetchBoard, parseGreenhouse, parseLever, stripHtml, type Job } from '../src/lib/fetch.js'
import { fetchAllMock, mockPayloads, STALE_DAYS } from '../src/lib/mock.js'
import { containsPhrase, parseDate, prefilter } from '../src/lib/prefilter.js'
import { rankSuggestions, locationSuggestions, titleSuggestions } from '../src/lib/suggest.js'
import { buildDigest } from '../src/lib/digest.js'

describe('difflib.ratio matches Python SequenceMatcher', () => {
  // Reference values produced by difflib.SequenceMatcher(None, a, b).ratio().
  const cases: [string, string, number][] = [
    ['enginer', 'engineer', 0.9333333333333333],
    ['backnd', 'backend', 0.9230769230769231],
    ['devloper', 'developer', 0.9411764705882353],
    ['react engineer', 'capacity engineer', 0.7741935483870968],
    ['backend python engineer', 'backend engineer', 0.8205128205128205],
    ['backnd enginer', 'backend engineer', 0.9333333333333333],
    ['', '', 1.0],
    ['abc', '', 0.0],
    ['golang', 'go', 0.5],
    ['data analyst', 'data scientist growth', 0.48484848484848486],
    ['site reliability', 'software engineer ii distributed systems', 0.21428571428571427],
    ['aaaaabbbbb', 'bbbbbaaaaa', 0.5],
    // 200+ items: exercises the "popular element" heuristic.
    ['x'.repeat(150) + 'needle' + 'y'.repeat(150), 'y'.repeat(150) + 'needle' + 'x'.repeat(150), 0.0196078431372549],
  ]
  it.each(cases)('ratio(%j, %j)', (a, b, expected) => {
    expect(ratio(a, b)).toBeCloseTo(expected, 12)
  })
})

describe('parsers', () => {
  const now = new Date()
  const jobs = fetchAllMock(now)
  const byId = (id: string): Job => jobs.find((j) => j.job_id === id)!

  it('parses every listed fixture and skips the unlisted Ashby draft', () => {
    expect(jobs).toHaveLength(12)
    expect(jobs.some((j) => j.url.endsWith('/unlisted'))).toBe(false)
    expect(new Set(jobs.map((j) => j.job_id)).size).toBe(12)
  })

  it('builds globally unique ids as ats:slug:id', () => {
    expect(byId('greenhouse:acme-edge:5501001').title).toBe('Software Engineer II, Distributed Systems')
    expect(byId('lever:quantstack:a1b2c3d4-1111-4aaa-9999-000000000001').company).toBe('Quantstack')
  })

  it('strips Greenhouse HTML and unescapes entities twice', () => {
    const d = byId('greenhouse:acme-edge:5501001').description
    expect(d).not.toMatch(/<[a-z]/i)
    expect(d).toContain("What you'll do")
    const escaped = parseGreenhouse('s', 'S', { jobs: [{ id: 1, title: 'T', content: '&lt;p&gt;R&amp;amp;D &amp;lt;b&amp;gt;team&lt;/p&gt;' }] })
    expect(escaped[0]!.description).toBe('R&D <b>team')
  })

  it('reads Lever createdAt as epoch milliseconds', () => {
    const posted = parseDate(byId('lever:quantstack:a1b2c3d4-1111-4aaa-9999-000000000001').posted_at)!
    expect(Math.abs(now.getTime() - 2 * 86_400_000 - posted.getTime())).toBeLessThan(1000)
  })

  it('concatenates every part of a Lever description', () => {
    const d = byId('lever:quantstack:a1b2c3d4-1111-4aaa-9999-000000000001').description
    expect(d).toContain('real-time market data pipeline')
    expect(d).toContain('Requirements')
    expect(d).toContain('2-5 years backend experience')
    expect(d).toContain('No take-home')
  })

  it('puts Lever commitment in employment_type, not salary', () => {
    const j = byId('lever:quantstack:a1b2c3d4-1111-4aaa-9999-000000000001')
    expect(j.employment_type).toBe('Full-time')
    expect(j.salary).toBeNull()
  })

  it('reads Ashby compensation and falls back to descriptionHtml', () => {
    expect(byId('ashby:helioscale:9f8e7d6c-2222-4bbb-8888-000000000001').salary).toBe('₹32L – ₹48L')
    expect(byId('ashby:helioscale:9f8e7d6c-2222-4bbb-8888-000000000003').description).toBe('Causal inference, experimentation, SQL & Python.')
  })

  it('tolerates malformed payloads', () => {
    expect(parseGreenhouse('s', 'S', null)).toEqual([])
    expect(parseLever('s', 'S', { not: 'a list' })).toEqual([])
    expect(stripHtml(undefined)).toBe('')
  })

  it('fetchBoard never throws: a dead slug reports its status', async () => {
    const dead = await fetchBoard('greenhouse', 'gone', 'Gone', (async () => new Response('nope', { status: 404 })) as typeof fetch)
    expect(dead).toMatchObject({ ok: false, http_status: 404, jobs: [] })
    const down = await fetchBoard('lever', 'x', 'X', (async () => { throw new TypeError('network down') }) as typeof fetch)
    expect(down.ok).toBe(false)
    expect(down.error).toContain('network down')
    const ok = await fetchBoard('greenhouse', 'acme-edge', 'Acme', (async () => Response.json(mockPayloads(now).greenhouse['acme-edge'])) as typeof fetch)
    expect(ok.jobs).toHaveLength(5)
  })
})

describe('prefilter', () => {
  const jobs = fetchAllMock()
  const cfg = {
    include_titles: ['software engineer', '\\bsde\\b', 'software development engineer', 'backend engineer', 'site reliability engineer'],
    exclude_titles: ['\\b(staff|principal)\\b', '\\bsenior\\b', '\\b(manager|management)\\b', '\\b(frontend|front-end)\\b'],
    locations: ['bangalore', 'bengaluru', 'india'],
    allow_remote: true,
    max_age_days: 30,
  }

  it('keeps the five planted keepers and counts each rejection', () => {
    const { kept, stats } = prefilter(jobs, cfg)
    expect(kept.map((j) => j.title).sort()).toEqual([
      'Backend Engineer (Go)',
      'Site Reliability Engineer',
      'Software Development Engineer, Core Infra',
      'Software Engineer II, Distributed Systems',
      'Software Engineer, Networking',
    ])
    expect(stats).toEqual({ title: 6, location: 1, age: 0 })
  })

  it('drops a stale posting that passes every other gate', () => {
    const stale = jobs.filter((j) => j.title === 'Senior Software Engineer, Platform')
    const { kept, stats } = prefilter(stale, { ...cfg, exclude_titles: [] })
    expect(kept).toEqual([])
    expect(stats.age).toBe(1)
    expect(STALE_DAYS).toBeGreaterThan(cfg.max_age_days)
  })

  it('the bare regex "sde" does not match "Software Development Engineer"', () => {
    const spelled = jobs.filter((j) => j.title.startsWith('Software Development Engineer'))
    expect(prefilter(spelled, { include_titles: ['\\bsde\\b'] }).kept).toEqual([])
    expect(prefilter(spelled, { include_titles: ['software development engineer'] }).kept).toHaveLength(1)
  })

  it('matches locations on whole phrases and lets remote through', () => {
    expect(containsPhrase('Indianapolis, Indiana', 'india')).toBe(false)
    expect(containsPhrase('Remote - India', 'india')).toBe(true)
    const j = [{ title: 'Engineer', location: 'Remote (EMEA)', posted_at: null }]
    expect(prefilter(j, { locations: ['bangalore'], allow_remote: true }).kept).toHaveLength(1)
    expect(prefilter(j, { locations: ['bangalore'], allow_remote: false }).kept).toHaveLength(0)
  })

  it('no config filters nothing, a null age disables the gate, and bad regexes are ignored', () => {
    expect(prefilter(jobs, {}).kept).toHaveLength(jobs.length)
    expect(prefilter(jobs, { max_age_days: null }).kept).toHaveLength(jobs.length)
    expect(prefilter(jobs, { exclude_titles: ['(unclosed'] }).kept).toHaveLength(jobs.length)
  })

  it('reads a timestamp with no zone as UTC', () => {
    expect(parseDate('2026-01-02T03:04:05')!.toISOString()).toBe('2026-01-02T03:04:05.000Z')
    expect(parseDate('2026-01-02')!.toISOString()).toBe('2026-01-02T00:00:00.000Z')
    expect(parseDate('not a date')).toBeNull()
  })
})

describe('suggestions', () => {
  const titles = fetchAllMock().map((j) => j.title)

  it('returns the most common titles when the query is empty', () => {
    expect(titleSuggestions(titles, '', 6)).toHaveLength(6)
    expect(rankSuggestions(['Zeta', 'Alpha', 'zeta', 'Beta'], '')).toEqual(['Zeta', 'Alpha', 'Beta'])
  })

  it('ranks prefix matches first', () => {
    expect(titleSuggestions(titles, 'back', 6)[0]).toMatch(/^Backend/)
    expect(rankSuggestions(['Data Engineer', 'Engineer, Data', 'Metadata Lead'], 'data')).toEqual(['Data Engineer', 'Engineer, Data', 'Metadata Lead'])
  })

  it('falls back to a static list with no jobs, and mixes live locations in', () => {
    // "SRE" is one letter off "sde", so the fuzzy rank picks it up after the prefix hit.
    expect(titleSuggestions([], 'sde')).toEqual(['SDE', 'SRE'])
    expect(locationSuggestions(['San Francisco, CA'], 'san')).toContain('San Francisco, CA')
    expect(locationSuggestions([], 'ban')[0]).toBe('Bangalore, India')
  })
})

describe('digest', () => {
  it('escapes job text and refuses non-http links', () => {
    const { subject, html } = buildDigest('Asha <b>', [{
      job_id: 'x:y:1', title: '<script>alert(1)</script>', company: 'A&B', location: '', ats: 'lever',
      url: 'javascript:alert(1)', score: 8.6, reason: 'Fits "well"', kit: { cover_note: 'Hello', tailored_bullets: ['one'] },
    }], { open_jobs: 10, matches: 3, applications: 1 })
    expect(subject).toContain('1 job worth applying to for Asha <b>')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('A&amp;B')
    expect(html).toContain('href="#"')
    expect(html).toContain('8.6')
  })

  it('says so when nothing cleared the bar', () => {
    const { subject, html } = buildDigest('Asha', [], { open_jobs: 0, matches: 0, applications: 0 })
    expect(subject).toMatch(/^No new matches for Asha/)
    expect(html).toContain('Nothing cleared the score threshold')
  })
})
