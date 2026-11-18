// Fetch jobs from public ATS APIs. No auth, no scraping.
//
// HTTP is kept out of the parsers on purpose: each parse* function takes
// already-decoded JSON, so fixtures exercise the real code path.

export type Ats = 'greenhouse' | 'lever' | 'ashby'

export interface Job {
  /** Stable global id for dedupe: "<ats>:<slug>:<id>". */
  job_id: string
  ats: Ats
  company: string
  title: string
  location: string
  url: string
  description: string
  posted_at: string | null
  salary: string | null
  employment_type: string | null
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’',
  ldquo: '“', rdquo: '”', hellip: '…', bull: '•',
  middot: '·', copy: '©', reg: '®', trade: '™',
  deg: '°', euro: '€', pound: '£', rupee: '₹',
  eacute: 'é', egrave: 'è', aacute: 'á', uuml: 'ü',
  ouml: 'ö', auml: 'ä', ccedil: 'ç', ntilde: 'ñ',
}

export function unescapeHtml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole
  })
}

export function stripHtml(raw: unknown): string {
  if (typeof raw !== 'string' || !raw) return ''
  // Greenhouse sends HTML-entity-escaped HTML: unescape before stripping tags
  // and again after, or "&amp;" ends up in the prompt.
  let text = unescapeHtml(raw)
  text = text.replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6])\s*\/?>/gi, '\n')
  text = text.replace(/<[^>]+>/g, ' ')
  text = unescapeHtml(text)
  text = text.replace(/[ \t\r\f\v]+/g, ' ')
  text = text.replace(/\n{3,}/g, '\n\n')
  // Postgres text cannot hold NUL.
  return text.replace(/\u0000/g, '').trim()
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

export function parseGreenhouse(slug: string, company: string, body: unknown): Job[] {
  return list(obj(body).jobs).map((raw) => {
    const j = obj(raw)
    return {
      job_id: `greenhouse:${slug}:${j.id}`,
      ats: 'greenhouse' as const,
      company,
      title: str(j.title).trim(),
      location: str(obj(j.location).name).trim(),
      url: str(j.absolute_url),
      description: stripHtml(j.content),
      posted_at: str(j.updated_at) || str(j.first_published) || null,
      salary: null,
      employment_type: null,
    }
  })
}

export function parseLever(slug: string, company: string, body: unknown): Job[] {
  return list(body).map((raw) => {
    const j = obj(raw)
    const cats = obj(j.categories)
    // Lever splits the JD across descriptionPlain + lists[] + additionalPlain.
    // Drop any of them and the requirements section is gone.
    const chunks = [str(j.descriptionPlain) || stripHtml(j.description)]
    for (const item of list(j.lists)) {
      const l = obj(item)
      chunks.push(str(l.text))
      chunks.push(stripHtml(l.content))
    }
    chunks.push(str(j.additionalPlain) || stripHtml(j.additional))
    // createdAt is epoch MILLISECONDS.
    const posted = typeof j.createdAt === 'number' ? new Date(j.createdAt).toISOString() : null
    return {
      job_id: `lever:${slug}:${j.id}`,
      ats: 'lever' as const,
      company,
      title: str(j.text).trim(),
      location: str(cats.location).trim(),
      url: str(j.hostedUrl) || str(j.applyUrl),
      description: chunks.filter(Boolean).join('\n\n').replace(/\u0000/g, '').trim(),
      posted_at: posted,
      salary: null,
      employment_type: str(cats.commitment).trim() || null,
    }
  })
}

export function parseAshby(slug: string, company: string, body: unknown): Job[] {
  const out: Job[] = []
  for (const raw of list(obj(body).jobs)) {
    const j = obj(raw)
    if (j.isListed === false) continue // unpublished draft
    const comp = obj(j.compensation)
    const summary = comp.compensationTierSummary ?? comp.summaryComponents
    out.push({
      job_id: `ashby:${slug}:${j.id}`,
      ats: 'ashby',
      company,
      title: str(j.title).trim(),
      location: str(j.location).trim(),
      url: str(j.jobUrl) || str(j.applyUrl),
      description: (str(j.descriptionPlain) || stripHtml(j.descriptionHtml)).replace(/\u0000/g, '').trim(),
      posted_at: str(j.publishedAt) || null,
      salary: typeof summary === 'string' ? summary : null,
      employment_type: str(j.employmentType).trim() || null,
    })
  }
  return out
}

type Parser = (slug: string, company: string, body: unknown) => Job[]

export const ENDPOINTS: Record<Ats, { url: (slug: string) => string; parse: Parser }> = {
  greenhouse: {
    url: (s) => `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(s)}/jobs?content=true`,
    parse: parseGreenhouse,
  },
  lever: {
    url: (s) => `https://api.lever.co/v0/postings/${encodeURIComponent(s)}?mode=json`,
    parse: parseLever,
  },
  ashby: {
    url: (s) => `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(s)}?includeCompensation=true`,
    parse: parseAshby,
  },
}

export interface BoardResult {
  ok: boolean
  http_status: number | null
  jobs: Job[]
  error: string | null
}

const UA = { 'User-Agent': 'jobhunt/1.0 (job search agent)' }

/** Hit one company's public board. Never throws: a dead slug must not kill a run. */
export async function fetchBoard(ats: Ats, slug: string, company: string, fetchImpl: typeof fetch = fetch): Promise<BoardResult> {
  const endpoint = ENDPOINTS[ats]
  if (!endpoint) return { ok: false, http_status: null, jobs: [], error: `unknown ATS: ${ats}` }
  try {
    const res = await fetchImpl(endpoint.url(slug), { headers: UA, signal: AbortSignal.timeout(30_000) })
    if (res.status !== 200) {
      return { ok: false, http_status: res.status, jobs: [], error: `HTTP ${res.status}` }
    }
    const jobs = endpoint.parse(slug, company || slug, await res.json())
    return { ok: true, http_status: 200, jobs, error: null }
  } catch (e) {
    const err = e as Error
    return { ok: false, http_status: null, jobs: [], error: `${err.name}: ${err.message}` }
  }
}
