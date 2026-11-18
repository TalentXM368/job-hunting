// Sample ATS payloads in each provider's exact native JSON shape. They run
// through the real parsers, so tests cover everything except the HTTP hop.
// Includes deliberate junk (wrong seniority, wrong city, wrong function, a
// stale posting, an unlisted Ashby draft) so the filters have something to
// reject.
//
// Dates are computed relative to *now*, never hardcoded: a fixed date silently
// ages past max_age_days and one day every fixture is filtered out.

import { parseAshby, parseGreenhouse, parseLever, type Job } from './fetch.js'

export const STALE_DAYS = 280 // comfortably past any sane max_age_days

const ago = (days: number, now: Date) => new Date(now.getTime() - days * 86_400_000)

const BACKEND_JD = `<p>We are building the control plane for our edge platform.</p>
<p><strong>What you'll do</strong></p><ul>
<li>Design and operate low-latency distributed services handling millions of RPS</li>
<li>Work in Go and Java across caching, routing and traffic-steering systems</li>
<li>Own reliability: on-call, incident response, capacity planning</li></ul>
<p><strong>What we look for</strong></p><ul>
<li>3+ years building backend systems at scale</li>
<li>Strong fundamentals in data structures, algorithms and networking (TCP/IP, HTTP, DNS)</li>
<li>Experience with Kubernetes and observability tooling</li></ul>`

const STAFF_JD = `<p>As a Staff Engineer you will set multi-year technical direction
across three teams, mentor senior engineers, and own architecture for our
petabyte-scale storage layer.</p><ul><li>10+ years of experience required</li>
<li>Proven track record leading org-wide migrations</li></ul>`

const FRONTEND_JD = `<p>Build delightful UI in React and TypeScript. Own our design
system, animations and accessibility work.</p>`

export function mockPayloads(now: Date = new Date()) {
  /** Greenhouse: ISO 8601 timestamps. */
  const gh = (days: number) => ago(days, now).toISOString()
  /** Lever: epoch MILLISECONDS. Seconds here would date every posting to 1970. */
  const lever = (days: number) => ago(days, now).getTime()
  const ashby = (days: number) => ago(days, now).toISOString()

  const greenhouse: Record<string, unknown> = {
    'acme-edge': { jobs: [
      // keeper: right level, right city, fresh
      { id: 5501001, title: 'Software Engineer II, Distributed Systems',
        absolute_url: 'https://boards.greenhouse.io/acme-edge/jobs/5501001',
        location: { name: 'Bangalore, India' }, updated_at: gh(2), content: BACKEND_JD },
      // junk: wrong seniority
      { id: 5501002, title: 'Staff Software Engineer, Storage',
        absolute_url: 'https://boards.greenhouse.io/acme-edge/jobs/5501002',
        location: { name: 'Bengaluru, KA' }, updated_at: gh(3), content: STAFF_JD },
      // junk: wrong function
      { id: 5501003, title: 'Enterprise Account Executive',
        absolute_url: 'https://boards.greenhouse.io/acme-edge/jobs/5501003',
        location: { name: 'Mumbai, India' }, updated_at: gh(4),
        content: '<p>Own a $3M quota selling to CIOs.</p>' },
      // junk: wrong city, and not remote
      { id: 5501004, title: 'Backend Engineer, Payments',
        absolute_url: 'https://boards.greenhouse.io/acme-edge/jobs/5501004',
        location: { name: 'San Francisco, CA' }, updated_at: gh(1), content: BACKEND_JD },
      // junk: would pass every other gate, but it is ancient
      { id: 5501005, title: 'Senior Software Engineer, Platform',
        absolute_url: 'https://boards.greenhouse.io/acme-edge/jobs/5501005',
        location: { name: 'Remote - India' }, updated_at: gh(STALE_DAYS), content: BACKEND_JD },
    ] },
    novapay: { jobs: [
      // keeper: "SDE" spelled out; the bare regex "sde" would miss this
      { id: 7702001, title: 'Software Development Engineer, Core Infra',
        absolute_url: 'https://boards.greenhouse.io/novapay/jobs/7702001',
        location: { name: 'Bengaluru, India' }, updated_at: gh(1),
        content: BACKEND_JD + '<p>Java, Kafka, Postgres. Hybrid, 3 days in office.</p>' },
      // junk: wrong discipline
      { id: 7702002, title: 'Frontend Engineer, Design Systems',
        absolute_url: 'https://boards.greenhouse.io/novapay/jobs/7702002',
        location: { name: 'Bengaluru, India' }, updated_at: gh(2), content: FRONTEND_JD },
    ] },
  }

  const leverBoards: Record<string, unknown> = {
    quantstack: [
      { id: 'a1b2c3d4-1111-4aaa-9999-000000000001', text: 'Backend Engineer (Go)',
        hostedUrl: 'https://jobs.lever.co/quantstack/a1b2c3d4-1111-4aaa-9999-000000000001',
        applyUrl: 'https://jobs.lever.co/quantstack/a1b2c3d4-1111-4aaa-9999-000000000001/apply',
        categories: { location: 'Bangalore', team: 'Infrastructure', commitment: 'Full-time' },
        createdAt: lever(2),
        descriptionPlain: 'We run a real-time market data pipeline in Go. You will own ingestion, fan-out and the storage layer.',
        lists: [{ text: 'Requirements',
          content: '<li>2-5 years backend experience</li><li>Go or Java, strong CS fundamentals</li><li>Comfort with Kubernetes, gRPC, Kafka</li>' }],
        additionalPlain: 'We interview with one system design round and one pair-programming round. No take-home.' },
      { id: 'a1b2c3d4-1111-4aaa-9999-000000000002', text: 'Engineering Manager, Platform',
        hostedUrl: 'https://jobs.lever.co/quantstack/a1b2c3d4-1111-4aaa-9999-000000000002',
        categories: { location: 'Bangalore', team: 'Platform', commitment: 'Full-time' },
        createdAt: lever(3),
        descriptionPlain: 'Lead a team of 8 engineers. 5+ years of people management required.',
        lists: [] },
      { id: 'a1b2c3d4-1111-4aaa-9999-000000000003', text: 'Site Reliability Engineer',
        hostedUrl: 'https://jobs.lever.co/quantstack/a1b2c3d4-1111-4aaa-9999-000000000003',
        categories: { location: 'Remote (India)', team: 'SRE', commitment: 'Full-time' },
        createdAt: lever(1),
        descriptionPlain: 'Own SLOs, on-call and incident response for a multi-region Kubernetes fleet. Terraform, Prometheus, Go.',
        lists: [{ text: 'Nice to have', content: '<li>CDN or edge networking background</li>' }] },
    ],
  }

  const ashbyBoards: Record<string, unknown> = {
    helioscale: { jobs: [
      { id: '9f8e7d6c-2222-4bbb-8888-000000000001', title: 'Software Engineer, Networking',
        location: 'Bengaluru, India', isListed: true,
        jobUrl: 'https://jobs.ashbyhq.com/helioscale/9f8e7d6c-2222-4bbb-8888-000000000001',
        publishedAt: ashby(1),
        compensation: { compensationTierSummary: '₹32L – ₹48L' },
        descriptionPlain: 'Work on our anycast network and HTTP proxy layer. You will tune TCP congestion control, build DNS steering logic and reduce p99 latency across POPs. We use Rust and Go. 2+ years experience.' },
      { id: '9f8e7d6c-2222-4bbb-8888-000000000002', title: 'Software Engineer, Networking',
        location: 'Bengaluru, India', isListed: false,
        jobUrl: 'https://jobs.ashbyhq.com/helioscale/unlisted',
        publishedAt: ashby(1),
        descriptionPlain: 'Draft posting that should never surface.' },
      { id: '9f8e7d6c-2222-4bbb-8888-000000000003', title: 'Data Scientist, Growth',
        location: 'Bengaluru, India', isListed: true,
        jobUrl: 'https://jobs.ashbyhq.com/helioscale/9f8e7d6c-2222-4bbb-8888-000000000003',
        publishedAt: ashby(2),
        descriptionHtml: '<p>Causal inference, experimentation, SQL &amp; Python.</p>' },
    ] },
  }

  return { greenhouse, lever: leverBoards, ashby: ashbyBoards }
}

const titleCase = (slug: string) => slug.replace(/-/g, ' ').replace(/\b[a-z]/g, (c) => c.toUpperCase())

export function fetchAllMock(now: Date = new Date()): Job[] {
  const p = mockPayloads(now)
  const jobs: Job[] = []
  for (const [slug, body] of Object.entries(p.greenhouse)) jobs.push(...parseGreenhouse(slug, titleCase(slug), body))
  for (const [slug, body] of Object.entries(p.lever)) jobs.push(...parseLever(slug, titleCase(slug), body))
  for (const [slug, body] of Object.entries(p.ashby)) jobs.push(...parseAshby(slug, titleCase(slug), body))
  return jobs
}
