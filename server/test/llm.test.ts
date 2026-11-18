// The LLM layer with the provider stubbed: no network, no key, no cost.

import { afterEach, describe, expect, it } from 'vitest'
import { asList, buildProfile, draft, DRAFT_KEYS, keywordScreen, parseJson, screen, type ScreenJob } from '../src/lib/llm.js'
import { LLMError, resolve, UnsupportedDocument, type Provider } from '../src/lib/providers.js'

interface Call {
  model: string
  system: string
  user: string
  maxTokens: number
  jsonMode?: boolean
}

function stub(reply: (call: Call, n: number) => string): Provider & { calls: Call[] } {
  const calls: Call[] = []
  return {
    name: 'stub',
    calls,
    preflight() {},
    async complete(model, system, user, maxTokens, jsonMode) {
      const call = { model, system, user, maxTokens, jsonMode }
      calls.push(call)
      return reply(call, calls.length)
    },
    async completeDocument(model, prompt) {
      calls.push({ model, system: '', user: prompt, maxTokens: 0 })
      return reply({ model, system: '', user: prompt, maxTokens: 0 }, calls.length)
    },
  }
}

const jobs = (n: number): ScreenJob[] => Array.from({ length: n }, (_, i) => ({
  job_id: `gh:acme:${i}`, company: 'Acme', title: `Engineer ${i}`, location: 'Bangalore', description: 'x'.repeat(5000),
}))

/** Echo a score for every job in the batch the stub was sent. */
const echo = (call: Call) => {
  const sent = JSON.parse(call.user.split('JOBS:\n')[1]!) as { job_id: string }[]
  return JSON.stringify(sent.map((j) => ({ job_id: j.job_id, score: 7.5, reason: 'ok' })))
}

describe('parseJson', () => {
  it('parses plain JSON', () => {
    expect(parseJson('[{"a":1}]')).toEqual([{ a: 1 }])
  })
  it('strips markdown fences', () => {
    expect(parseJson('```json\n{"a": 1}\n```')).toEqual({ a: 1 })
    expect(parseJson('```\n[1, 2]\n```')).toEqual([1, 2])
  })
  it('skips a preamble and trailing commentary', () => {
    expect(parseJson('Here is the JSON:\n[{"job_id": "x", "score": 7}]\nHope that helps!')).toEqual([{ job_id: 'x', score: 7 }])
    expect(parseJson('Sure. {"fit_summary": "good"} Done.')).toEqual({ fit_summary: 'good' })
  })
  it('throws on garbage and on an empty reply', () => {
    expect(() => parseJson('no json here')).toThrow(/could not parse JSON/)
    expect(() => parseJson(null)).toThrow(/empty model reply/)
  })
})

describe('asList', () => {
  it('accepts an array, a wrapped array, or a bare object', () => {
    expect(asList([{ a: 1 }, 'junk', null])).toEqual([{ a: 1 }])
    expect(asList({ results: [{ a: 1 }] })).toEqual([{ a: 1 }])
    expect(asList({ job_id: 'x' })).toEqual([{ job_id: 'x' }])
    expect(() => asList('nope')).toThrow(/expected a JSON array/)
  })
})

describe('screen', () => {
  it('splits jobs into batches of the configured size', async () => {
    const p = stub(echo)
    const out = await screen(jobs(19), { name: 'A' }, p, 'm', { batchSize: 8 })
    expect(p.calls).toHaveLength(3)
    expect(p.calls.map((c) => (JSON.parse(c.user.split('JOBS:\n')[1]!) as unknown[]).length)).toEqual([8, 8, 3])
    expect(out.results.size).toBe(19)
    expect(out.failedBatches).toBe(0)
  })

  it('truncates each description before sending and asks for JSON', async () => {
    const p = stub(echo)
    await screen(jobs(2), {}, p, 'cheap-model', { jdChars: 1400 })
    const sent = JSON.parse(p.calls[0]!.user.split('JOBS:\n')[1]!) as { description: string }[]
    expect(sent.every((j) => j.description.length === 1400)).toBe(true)
    expect(p.calls[0]).toMatchObject({ model: 'cheap-model', jsonMode: true })
    expect(p.calls[0]!.system).toContain('You are strict')
    expect(p.calls[0]!.user).toContain('CANDIDATE PROFILE:')
  })

  it('lands scores on the right job when the reply is out of order, fenced and wrapped', async () => {
    const p = stub(() => '```json\n{"results": [' +
      '{"job_id": "gh:acme:2", "score": 9, "reason": " strong "},' +
      '{"job_id": "gh:acme:0", "score": "3.5", "reason": "weak"},' +
      '{"job_id": "gh:acme:999", "score": 10, "reason": "not ours"}]}\n```')
    const out = await screen(jobs(3), {}, p, 'm')
    expect(out.results.get('gh:acme:2')).toEqual({ score: 9, reason: 'strong' })
    expect(out.results.get('gh:acme:0')).toEqual({ score: 3.5, reason: 'weak' })
    expect(out.results.has('gh:acme:1')).toBe(false) // the model skipped it: retried next run
    expect(out.results.has('gh:acme:999')).toBe(false)
  })

  it('clamps scores to 0..10 and treats a non-number as 0', async () => {
    const p = stub(() => JSON.stringify([
      { job_id: 'gh:acme:0', score: 14 }, { job_id: 'gh:acme:1', score: -2 }, { job_id: 'gh:acme:2', score: 'high' },
    ]))
    const out = await screen(jobs(3), {}, p, 'm')
    expect([...out.results.values()].map((r) => r.score)).toEqual([10, 0, 0])
  })

  it('a failed batch is recorded and the run continues', async () => {
    const p = stub((call, n) => {
      if (n === 1) throw new LLMError('rate limit hit')
      if (n === 2) return 'I cannot help with that.'
      return echo(call)
    })
    const out = await screen(jobs(20), {}, p, 'm', { batchSize: 8 })
    expect(out.failedBatches).toBe(2)
    expect(out.errors[0]).toContain('batch 1: rate limit hit')
    expect(out.errors[1]).toContain('batch 2: could not parse JSON')
    expect(out.results.size).toBe(4)
  })
})

describe('draft', () => {
  const job = { title: 'Backend Engineer', company: 'Acme', location: '', url: 'https://x', description: 'y'.repeat(9000) }

  it('returns every key the UI renders, with the right types', async () => {
    const p = stub(() => JSON.stringify({ fit_summary: 'Good fit.', tailored_bullets: ['a', 2], cover_note: 'Hello' }))
    const kit = await draft(job, { name: 'A' }, p, 'best-model')
    expect(Object.keys(kit).sort()).toEqual([...DRAFT_KEYS].sort())
    expect(kit).toEqual({ fit_summary: 'Good fit.', tailored_bullets: ['a', '2'], gaps: [], cover_note: 'Hello', questions_to_ask: [] })
  })

  it('sends at most 6000 characters of the description and names the missing location', async () => {
    const p = stub(() => '{}')
    await draft(job, {}, p, 'm')
    expect(p.calls[0]!.user).toContain('(location not stated)')
    expect(p.calls[0]!.user.match(/y+$/)![0]).toHaveLength(6000)
    expect(p.calls[0]!.system).toContain('never invent experience')
  })

  it('throws when the reply is not an object', async () => {
    await expect(draft(job, {}, stub(() => '[1,2]'), 'm')).rejects.toThrow(/did not return a JSON object/)
  })
})

describe('buildProfile', () => {
  it('sends a text resume inline and a PDF as a document', async () => {
    const p = stub(() => '{"name": "Asha", "core_skills": ["Go"]}')
    expect(await buildProfile({ kind: 'text', text: 'Asha, Go engineer' }, p, 'm')).toEqual({ name: 'Asha', core_skills: ['Go'] })
    expect(p.calls[0]!.user).toContain('--- RESUME ---\nAsha, Go engineer')
    await buildProfile({ kind: 'pdf', bytes: new Uint8Array([37, 80, 68, 70]) }, p, 'm')
    expect(p.calls[1]!.user).not.toContain('--- RESUME ---')
  })

  it('adds a tip when the provider cannot read PDFs', async () => {
    const p = stub(() => '{}')
    p.completeDocument = async () => { throw new UnsupportedDocument('groq cannot read PDFs here') }
    await expect(buildProfile({ kind: 'pdf', bytes: new Uint8Array() }, p, 'm')).rejects.toThrow(/upload the resume as \.txt/)
  })
})

describe('keywordScreen', () => {
  it('scores by skill overlap plus a title bonus, and labels itself', () => {
    const out = keywordScreen([
      { job_id: 'a', company: 'X', title: 'Backend Engineer', location: '', description: 'Go and Kafka services' },
      { job_id: 'b', company: 'X', title: 'Account Executive', location: '', description: 'Quota' },
    ], { core_skills: ['Go', 'Kafka', 'Rust', 'Java'], target_titles: ['Backend Engineer'] })
    expect(out.get('a')).toEqual({ score: 8.5, reason: '[keyword stub] matched: go, kafka' })
    expect(out.get('b')).toEqual({ score: 0, reason: '[keyword stub] no skill overlap' })
  })
})

describe('resolve', () => {
  const saved = { ...process.env }
  afterEach(() => {
    process.env = { ...saved }
  })
  const clear = () => {
    for (const k of ['LLM_PROVIDER', 'SCREEN_PROVIDER', 'DRAFT_PROVIDER', 'SCREEN_MODEL', 'DRAFT_MODEL',
      'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'GEMINI_API_KEY', 'GROQ_API_KEY']) delete process.env[k]
  }

  it('prefers the stage variable, then the global one, then anthropic', () => {
    clear()
    process.env.LLM_PROVIDER = 'gemini'
    process.env.DRAFT_PROVIDER = 'ollama'
    process.env.SCREEN_MODEL = 'my-flash'
    expect(resolve('screen', false)).toMatchObject({ provider: { name: 'gemini' }, model: 'my-flash' })
    expect(resolve('draft', false)).toMatchObject({ provider: { name: 'ollama' }, model: 'llama3.1' })
    clear()
    expect(resolve('screen', false)).toMatchObject({ provider: { name: 'anthropic' }, model: 'claude-haiku-5-5' })
    expect(resolve('draft', false).model).toBe('claude-sonnet-5-5')
  })

  it('fails early on a missing or blank key and on an unknown provider', () => {
    clear()
    expect(() => resolve('screen')).toThrow(/ANTHROPIC_API_KEY is not set/)
    process.env.LLM_PROVIDER = 'gemini'
    process.env.GEMINI_API_KEY = '   '
    expect(() => resolve('screen')).toThrow(/GEMINI_API_KEY is not set/)
    process.env.LLM_PROVIDER = 'gemnii'
    expect(() => resolve('screen')).toThrow(/unknown provider 'gemnii'/)
    process.env.LLM_PROVIDER = 'ollama'
    expect(resolve('screen').provider.name).toBe('ollama')
  })
})
