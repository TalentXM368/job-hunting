import { z } from 'zod'

/** An error with an HTTP status. The message is shown to the recruiter. */
export class HttpError extends Error {
  constructor(readonly status: 400 | 401 | 404 | 409 | 413 | 415 | 422 | 502 | 503, message: string) {
    super(message)
    this.name = 'HttpError'
  }
}

export const notFound = (what: string) => new HttpError(404, `${what} not found`)

const uuid = z.uuid()

/** Reject a malformed id as 404 before it reaches Postgres and fails as a 500. */
export function requireUuid(value: string | undefined, what: string): string {
  const parsed = uuid.safeParse(value)
  if (!parsed.success) throw notFound(what)
  return parsed.data
}

/** Validate a request body; a failure becomes a 400 naming the offending field. */
export function parseBody<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const parsed = schema.safeParse(body ?? {})
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const path = issue?.path.join('.') || 'body'
    throw new HttpError(400, `${path}: ${issue?.message ?? 'invalid value'}`)
  }
  return parsed.data
}

// ------------------------------------------------------------ serialising --

/** Timestamps leave the API as ISO strings whatever the driver returned. */
export function iso(value: Date | string | null | undefined): string | null {
  if (value == null) return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** Postgres numeric and bigint arrive as strings from node-postgres. */
export function num(value: unknown): number | null {
  if (value == null) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/** Run `fn` over `items` with at most `limit` in flight; results keep input order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}
