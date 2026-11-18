import { describe, expect, it } from 'vitest'
import { pdfToText } from '../src/lib/pdf.js'
import { canonicalSkills, detectSkills, readResumeText, ruleScore, templateKit, yearsRequired } from '../src/lib/rules.js'
import { candidateLevel, titleLevel } from '../src/lib/vocab.js'

const profile = {
  name: 'Asha Rao',
  current_title: 'Software Engineer II',
  current_company: 'Acme Edge',
  years_experience: 3,
  seniority: 'mid',
  location: 'Bengaluru, India',
  core_skills: ['Go', 'Java', 'Kubernetes', 'Kafka', 'gRPC', 'PostgreSQL', 'distributed systems'],
  domains: ['backend services', 'distributed systems'],
  notable_projects: ['Rebuilt a request-routing layer in Go, cutting p99 latency from 340ms to 95ms', 'Migrated 40 services onto Kubernetes with zero downtime'],
  education: 'B.E. Computer Science, 2022',
  target_titles: ['Software Engineer', 'Backend Engineer'],
}

const backendJd = `We are building the control plane for our edge platform. You will work in Go and Java across caching,
routing and traffic-steering systems on Kubernetes with Kafka and gRPC. 3+ years building backend systems at scale.
Own reliability: on-call, incident response.`

describe('vocabulary', () => {
  it('reads seniority from titles and from years', () => {
    expect(titleLevel('Staff Software Engineer, Storage')).toBe(5)
    expect(titleLevel('Senior Backend Engineer')).toBe(4)
    expect(titleLevel('Software Engineer II, Distributed Systems')).toBe(3)
    expect(titleLevel('Software Engineer, New Grad')).toBe(1)
    expect(titleLevel('Engineering Manager, Platform')).toBe(6)
    expect(titleLevel('Backend Engineer (Go)')).toBeNull()
    expect(candidateLevel('mid', null)).toBe(3)
    expect(candidateLevel(null, 6)).toBe(4)
    expect(candidateLevel(null, null)).toBeNull()
  })

  it('maps spellings to canonical skills and keeps short names honest', () => {
    expect(canonicalSkills(['K8s', 'Golang', 'Postgres', 'Kafka', 'Erlang'])).toEqual(['kubernetes', 'go', 'postgresql', 'kafka', 'erlang'])
    const found = detectSkills('We use Go, k8s and Postgres. Please go to the office. C++ and C are welcome; see www.google.com.')
    expect(found.get('go')).toBe(1) // "go to" and "google" do not count
    expect(found.get('kubernetes')).toBe(1)
    expect(found.get('postgresql')).toBe(1)
    expect(found.get('c++')).toBe(1)
    expect(found.get('c')).toBe(1)
    expect(detectSkills('machine learning models').has('machine learning')).toBe(true)
  })

  it('finds the minimum years a posting asks for', () => {
    expect(yearsRequired('5+ years of experience; 3-5 years with Go')).toBe(3)
    expect(yearsRequired('We ship every 2 weeks')).toBeNull()
  })
})

describe('ruleScore', () => {
  it('rewards a fitting title, matched skills, same level and domain', () => {
    const r = ruleScore({ title: 'Software Engineer II, Edge', company: 'Acme', location: 'Bengaluru', description: backendJd }, profile)
    expect(r.title_fit).toBe('target')
    expect(r.matched_skills).toEqual(expect.arrayContaining(['go', 'java', 'kubernetes', 'kafka', 'grpc']))
    expect(r.score).toBeGreaterThanOrEqual(8)
    expect(r.reason).toMatch(/^\[rules\] Title fits "Software Engineer"\. Skills: /)
    expect(r.reason).toContain('same level (+1)')
    expect(r.blockers).toEqual([])
  })

  it('penalises a staff role and a years gap, and names the missing skills', () => {
    const r = ruleScore({ title: 'Staff Software Engineer, Storage', company: 'Acme', location: '', description: 'Rust and C++ storage layer. 10+ years of experience required.' }, profile)
    expect(r.job_level).toBe(5)
    expect(r.reason).toContain('Asks for 10+ years, candidate has 3 (-3)')
    expect(r.missing_skills).toEqual(expect.arrayContaining(['rust', 'c++']))
    expect(r.score).toBeLessThanOrEqual(3.5)
  })

  it('scores an unrelated role near the floor and flags blockers', () => {
    const sales = ruleScore({ title: 'Enterprise Account Executive', company: 'Acme', location: '', description: 'Own a $3M quota selling to CIOs.' }, profile)
    expect(sales.title_fit).toBe('none')
    expect(sales.score).toBeLessThanOrEqual(2.5)
    const cleared = ruleScore({ title: 'Software Engineer', company: 'Gov', location: '', description: 'Go services. Active security clearance (TS/SCI) required.' }, profile)
    expect(cleared.blockers).toEqual(['asks for a security clearance'])
    expect(cleared.score).toBeLessThan(ruleScore({ title: 'Software Engineer', company: 'Gov', location: '', description: 'Go services.' }, profile).score)
    const sponsor = ruleScore({ title: 'Software Engineer', company: 'X', location: '', description: 'Go. We are unable to sponsor visas.' }, { ...profile, requires_sponsorship: true })
    expect(sponsor.blockers).toEqual(['no visa sponsorship, candidate needs it'])
  })

  it('is deterministic and stays within 0..10 in half steps', () => {
    const job = { title: 'Backend Engineer', company: 'A', location: '', description: backendJd }
    const a = ruleScore(job, profile)
    expect(ruleScore(job, profile)).toEqual(a)
    expect(a.score * 2).toBe(Math.round(a.score * 2))
    expect(ruleScore(job, {}).score).toBeGreaterThanOrEqual(0)
  })
})

describe('readResumeText', () => {
  const resume = `Asha Rao
Software Engineer II at Acme Edge
Bengaluru, India · asha.rao@example.com · +91 98765 43210
linkedin.com/in/asharao · github.com/asharao

Summary
Backend engineer with 3 years of experience building distributed systems in Go and Java on Kubernetes.

Experience
Acme Edge — Software Engineer II (2023 – present)
• Rebuilt a request-routing layer in Go, cutting p99 latency from 340ms to 95ms
• Migrated 40 services onto Kubernetes with zero customer-facing downtime
• Built a Kafka-based event pipeline handling 1.2B events/day

Skills
Go, Java, Python, Kubernetes, Kafka, gRPC, PostgreSQL, Redis, Terraform

Education
B.E. Computer Science, 2022`

  it('reads contact details, title, years, skills, projects and education', () => {
    const r = readResumeText(resume)
    expect(r.fields).toMatchObject({
      full_name: 'Asha Rao',
      email: 'asha.rao@example.com',
      linkedin_url: 'https://linkedin.com/in/asharao',
      github_url: 'https://github.com/asharao',
      current_title: 'Software Engineer II',
      current_company: 'Acme Edge',
      years_experience: 3,
      seniority: 'mid',
      location: 'Bengaluru, India',
    })
    expect(r.fields.phone?.replace(/\D/g, '')).toBe('919876543210')
    expect(r.profile.core_skills.slice(0, 3)).toEqual(expect.arrayContaining(['Go', 'Kubernetes']))
    expect(r.profile.core_skills).toEqual(expect.arrayContaining(['Java', 'Python', 'Kafka', 'gRPC', 'PostgreSQL', 'Redis', 'Terraform']))
    expect(r.profile.notable_projects).toHaveLength(3)
    expect(r.profile.notable_projects[0]).toMatch(/^Rebuilt a request-routing layer/)
    expect(r.profile.education).toBe('B.E. Computer Science, 2022')
    expect(r.profile.target_titles).toEqual(['Software Engineer'])
    expect(r.profile.domains).toContain('backend services')
  })

  it('leaves out what the text does not state', () => {
    const r = readResumeText('Just a line with nothing useful on it at all.')
    expect(r.fields).toEqual({})
    expect(r.profile.core_skills).toEqual([])
    expect(r.profile.target_titles).toEqual([])
  })
})

describe('templateKit', () => {
  it('builds every key from the evidence, with a cover note in the target length', () => {
    const job = { title: 'Backend Engineer, Edge', company: 'Acme', location: 'Bengaluru', description: backendJd }
    const kit = templateKit(job, profile, ruleScore(job, profile))
    expect(kit.fit_summary).toMatch(/^Asha's profile covers \d of the skills this Backend Engineer, Edge posting at Acme names/)
    expect(kit.tailored_bullets[0]).toMatch(/^Rebuilt a request-routing layer/)
    expect(kit.tailored_bullets.length).toBeGreaterThanOrEqual(2)
    expect(kit.cover_note).toContain('Acme is hiring a Backend Engineer, Edge')
    expect(kit.cover_note).toContain('3 years as a Software Engineer II at Acme Edge')
    const words = kit.cover_note.split(/\s+/).length
    expect(words).toBeGreaterThanOrEqual(80)
    expect(words).toBeLessThanOrEqual(170)
    expect(kit.questions_to_ask).toHaveLength(2)
    expect(kit.questions_to_ask[1]).toContain('on-call')
  })

  it('turns missing skills, a level gap and blockers into gaps', () => {
    const job = { title: 'Staff Engineer', company: 'Acme', location: '', description: 'Rust. 10+ years. Security clearance required.' }
    const kit = templateKit(job, profile, ruleScore(job, profile))
    expect(kit.gaps.some((g) => g.startsWith('The posting asks for Rust'))).toBe(true)
    expect(kit.gaps.some((g) => g.startsWith('Seniority: a staff-level role for a mid-level candidate'))).toBe(true)
    expect(kit.gaps.some((g) => g.startsWith('Years: the posting asks for 10+'))).toBe(true)
    expect(kit.gaps.some((g) => g.includes('security clearance'))).toBe(true)
  })
})

describe('pdfToText', () => {
  it('reads the text layer of a small PDF', async () => {
    // A minimal one-page PDF with the text "Asha Rao Go Kubernetes".
    const content = 'BT /F1 18 Tf 40 700 Td (Asha Rao Go Kubernetes) Tj ET'
    const objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ]
    let pdf = '%PDF-1.4\n'
    const offsets: number[] = []
    objects.forEach((obj, i) => {
      offsets.push(pdf.length)
      pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`
    })
    const xref = pdf.length
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
    const text = await pdfToText(new TextEncoder().encode(pdf))
    expect(text).toContain('Asha Rao Go Kubernetes')
  })
})
