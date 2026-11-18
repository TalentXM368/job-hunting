// Provider-agnostic LLM clients. One small interface, five backends.
// Screening and drafting each pick their own provider from env vars, so the
// cheap pass can run on Groq or Gemini while drafting stays on Claude.
//
// Nothing here parses JSON or knows what a job is. That lives in llm.ts.

import Anthropic from '@anthropic-ai/sdk'

const TIMEOUT_MS = 120_000

/** Anything that came back wrong from a provider. */
export class LLMError extends Error {
  override name = 'LLMError'
}

/** Provider cannot read a PDF; caller should fall back to plain text. */
export class UnsupportedDocument extends LLMError {
  override name = 'UnsupportedDocument'
}

export type Stage = 'screen' | 'draft'

export interface Provider {
  readonly name: string
  /** Fail before the first call, not on batch 1 of 40. */
  preflight(): void
  /** `jsonMode` asks for valid JSON where the provider has a switch. A request, not a promise. */
  complete(model: string, system: string, user: string, maxTokens: number, jsonMode?: boolean): Promise<string>
  completeDocument(model: string, prompt: string, pdf: Uint8Array, maxTokens: number): Promise<string>
}

function env(key: string): string {
  // An empty value is a missing value. A blank line in .env otherwise sails
  // past the check and fails much later as an opaque 401.
  const value = (process.env[key] ?? '').trim()
  if (!value) throw new LLMError(`${key} is not set (see .env.example)`)
  return value
}

const toBase64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64')

async function postJson(url: string, body: unknown, headers: Record<string, string>, label: string): Promise<unknown> {
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (e) {
    throw new LLMError(`${label} unreachable: ${(e as Error).message}`)
  }
  const text = await res.text()
  if (res.status !== 200) throw new LLMError(`${label} HTTP ${res.status}: ${text.slice(0, 300)}`)
  try {
    return JSON.parse(text)
  } catch {
    throw new LLMError(`${label} malformed reply: ${text.slice(0, 300)}`)
  }
}

// ------------------------------------------------------------- Anthropic --

// Models whose safety classifiers can decline a request and that accept the
// server-side "default" fallback, which re-runs a declined request on another
// model inside the same call. Haiku has no server-side fallback.
const FALLBACK_MODELS = new Set(['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-1'])

export class AnthropicProvider implements Provider {
  readonly name = 'anthropic'

  preflight(): void {
    if (!(process.env.ANTHROPIC_API_KEY ?? '').trim() && !(process.env.ANTHROPIC_AUTH_TOKEN ?? '').trim()) {
      throw new LLMError('ANTHROPIC_API_KEY is not set (see .env.example)')
    }
  }

  private async run(model: string, system: string, content: Anthropic.MessageParam['content'], maxTokens: number): Promise<string> {
    const client = new Anthropic()
    const base = {
      model,
      max_tokens: maxTokens,
      ...(system ? { system } : {}),
      messages: [{ role: 'user' as const, content }],
    }
    try {
      // Thinking is left at the model default (adaptive) and no sampling
      // parameters are sent: current models reject non-default values.
      const msg = FALLBACK_MODELS.has(model)
        ? await client.beta.messages.create({ ...base, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
        : await client.messages.create(base)
      if (msg.stop_reason === 'refusal') {
        const category = msg.stop_details?.category ?? 'unspecified'
        throw new LLMError(`anthropic declined the request (category: ${category})`)
      }
      let text = ''
      for (const block of msg.content) {
        if (block.type === 'text') text += block.text
      }
      if (msg.stop_reason === 'max_tokens') {
        throw new LLMError(`anthropic stopped at max_tokens with ${text.length} chars of output; raise the ceiling for this stage`)
      }
      if (!text) throw new LLMError('anthropic returned no text')
      return text
    } catch (e) {
      if (e instanceof LLMError) throw e
      if (e instanceof Anthropic.AuthenticationError) throw new LLMError('anthropic rejected the API key (401)')
      if (e instanceof Anthropic.NotFoundError) throw new LLMError(`anthropic does not know model ${model} (404)`)
      if (e instanceof Anthropic.RateLimitError) throw new LLMError('anthropic rate limit hit (429); retry later')
      if (e instanceof Anthropic.APIConnectionError) throw new LLMError(`anthropic unreachable: ${e.message}`)
      if (e instanceof Anthropic.APIError) throw new LLMError(`anthropic HTTP ${e.status}: ${e.message.slice(0, 300)}`)
      throw e
    }
  }

  complete(model: string, system: string, user: string, maxTokens: number): Promise<string> {
    // No JSON switch is needed: the prompts specify the shape and the parser
    // in llm.ts tolerates fences and preambles.
    return this.run(model, system, user, maxTokens)
  }

  completeDocument(model: string, prompt: string, pdf: Uint8Array, maxTokens: number): Promise<string> {
    return this.run(model, '', [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: toBase64(pdf) } },
      { type: 'text', text: prompt },
    ], maxTokens)
  }
}

// ---------------------------------------------------------------- Gemini --

interface GeminiCandidate {
  finishReason?: string
  content?: { parts?: { text?: string }[] }
}

export class GeminiProvider implements Provider {
  readonly name = 'gemini'
  static readonly BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

  preflight(): void {
    env('GEMINI_API_KEY')
  }

  private async post(model: string, body: unknown): Promise<string> {
    const url = `${GeminiProvider.BASE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(env('GEMINI_API_KEY'))}`
    const data = (await postJson(url, body, {}, 'gemini')) as { candidates?: GeminiCandidate[] }
    const candidate = data.candidates?.[0]
    if (!candidate) throw new LLMError(`gemini returned no candidates: ${JSON.stringify(data).slice(0, 300)}`)
    // Reasoning models spend output tokens on thinking, so a tight ceiling is
    // consumed before the answer starts. Say so plainly instead of letting it
    // surface three layers up as a JSON parse error.
    const reason = candidate.finishReason
    const text = (candidate.content?.parts ?? []).map((p) => p.text ?? '').join('')
    if (reason === 'MAX_TOKENS' || (!text && reason != null && reason !== 'STOP')) {
      throw new LLMError(`gemini stopped early (finishReason=${reason}) with ${text.length} chars of output; raise max_tokens for this stage`)
    }
    if (!text) throw new LLMError(`gemini returned no text: ${JSON.stringify(data).slice(0, 300)}`)
    return text
  }

  complete(model: string, system: string, user: string, maxTokens: number, jsonMode = false): Promise<string> {
    const generationConfig: Record<string, unknown> = { maxOutputTokens: maxTokens, temperature: 0.2 }
    if (jsonMode) generationConfig.responseMimeType = 'application/json'
    const body: Record<string, unknown> = {
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig,
    }
    if (system) body.system_instruction = { parts: [{ text: system }] }
    return this.post(model, body)
  }

  completeDocument(model: string, prompt: string, pdf: Uint8Array, maxTokens: number): Promise<string> {
    return this.post(model, {
      contents: [{ role: 'user', parts: [
        { inline_data: { mime_type: 'application/pdf', data: toBase64(pdf) } },
        { text: prompt },
      ] }],
      generationConfig: { maxOutputTokens: maxTokens, temperature: 0.2 },
    })
  }
}

// ------------------------------------------------- OpenAI-compatible / Groq --

/** Anything speaking /chat/completions: Groq, Together, OpenRouter, vLLM. */
export class OpenAICompatProvider implements Provider {
  readonly name: string = 'openai-compatible'
  protected readonly defaultBase = 'https://api.groq.com/openai/v1'
  protected readonly keyEnv = 'GROQ_API_KEY'

  preflight(): void {
    env(this.keyEnv)
  }

  async complete(model: string, system: string, user: string, maxTokens: number, jsonMode = false): Promise<string> {
    const base = (process.env.LLM_BASE_URL || this.defaultBase).replace(/\/+$/, '')
    const messages = [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: user }]
    const payload: Record<string, unknown> = { model, messages, max_tokens: maxTokens, temperature: 0.2 }
    if (jsonMode) payload.response_format = { type: 'json_object' }
    const data = (await postJson(`${base}/chat/completions`, payload, { Authorization: `Bearer ${env(this.keyEnv)}` }, this.name)) as {
      choices?: { message?: { content?: string } }[]
    }
    const content = data.choices?.[0]?.message?.content
    if (typeof content !== 'string') throw new LLMError(`${this.name} malformed reply: ${JSON.stringify(data).slice(0, 300)}`)
    return content
  }

  completeDocument(): Promise<string> {
    return Promise.reject(new UnsupportedDocument(`${this.name} cannot read PDFs here; upload a .txt or .md resume instead`))
  }
}

export class GroqProvider extends OpenAICompatProvider {
  override readonly name = 'groq'
}

// ---------------------------------------------------------------- Ollama --

/** Fully local. No key, no cost, no rate limit, just a slower model. */
export class OllamaProvider implements Provider {
  readonly name = 'ollama'

  preflight(): void {}

  async complete(model: string, system: string, user: string, maxTokens: number, jsonMode = false): Promise<string> {
    const base = (process.env.OLLAMA_HOST || 'http://localhost:11434').replace(/\/+$/, '')
    const messages = [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: user }]
    const payload: Record<string, unknown> = {
      model, messages, stream: false,
      options: { temperature: 0.2, num_predict: maxTokens },
    }
    if (jsonMode) payload.format = 'json'
    const data = (await postJson(`${base}/api/chat`, payload, {}, 'ollama')) as { message?: { content?: string } }
    const content = data.message?.content
    if (typeof content !== 'string') throw new LLMError(`ollama malformed reply: ${JSON.stringify(data).slice(0, 300)}`)
    return content
  }

  completeDocument(): Promise<string> {
    return Promise.reject(new UnsupportedDocument('ollama cannot read PDFs here; upload a .txt or .md resume instead'))
  }
}

// ---------------------------------------------------------------- registry --

export const PROVIDERS: Record<string, () => Provider> = {
  anthropic: () => new AnthropicProvider(),
  gemini: () => new GeminiProvider(),
  groq: () => new GroqProvider(),
  'openai-compatible': () => new OpenAICompatProvider(),
  ollama: () => new OllamaProvider(),
}

// What each provider gets if no model is named. Screening reads every
// surviving job and wants the cheapest decent model; drafting runs a handful
// of times and wants a stronger one.
export const DEFAULT_MODELS: Record<string, Record<Stage, string>> = {
  anthropic: { screen: 'claude-haiku-5-5', draft: 'claude-sonnet-5-5' },
  gemini: { screen: 'gemini-3.5-flash-lite', draft: 'gemini-3.6-flash' },
  groq: { screen: 'llama-3.3-70b-versatile', draft: 'llama-3.3-70b-versatile' },
  'openai-compatible': { screen: 'gpt-4o-mini', draft: 'gpt-4o' },
  ollama: { screen: 'llama3.1', draft: 'llama3.1' },
}

export function getProvider(name: string): Provider {
  const make = PROVIDERS[name]
  if (!make) throw new LLMError(`unknown provider '${name}'; pick one of ${Object.keys(PROVIDERS).join(', ')}`)
  return make()
}

/**
 * Which provider + model handles this stage?
 * Precedence: stage-specific env var, then the global one, then the default.
 * Throws LLMError when credentials are missing, so callers can bail early.
 */
export function resolve(stage: Stage, check = true): { provider: Provider; model: string } {
  const upper = stage.toUpperCase()
  const name = (process.env[`${upper}_PROVIDER`] || process.env.LLM_PROVIDER || 'anthropic').trim().toLowerCase()
  // Resolve the provider first: a typo'd name should say "unknown provider",
  // not send you hunting for a model id it was never going to use.
  const provider = getProvider(name)
  const model = (process.env[`${upper}_MODEL`] ?? '').trim() || DEFAULT_MODELS[name]?.[stage]
  if (!model) throw new LLMError(`set ${upper}_MODEL for provider '${name}'`)
  if (check) provider.preflight()
  return { provider, model }
}
