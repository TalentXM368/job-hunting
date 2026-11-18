import { Pool } from '@neondatabase/serverless'
import { Kysely, PostgresDialect, sql, type PostgresPool, type RawBuilder } from 'kysely'
import type { DB } from './generated/types.js'

export type Database = Kysely<DB>
export type DbKind = 'neon' | 'pglite'

/**
 * Open a Kysely handle on Neon.
 *
 * Uses Neon's WebSocket `Pool` rather than its HTTP driver because the HTTP
 * driver cannot hold a transaction open, and ingest and approval both need one.
 * Pass the pooled connection string (DATABASE_URL); only migrations use the
 * direct one.
 */
export function createNeonDb(connectionString: string): Database {
  const neonPool = new Pool({
    connectionString,
    // Neon's proxy closes WebSocket connections that sit idle; release ours
    // first so a query never lands on a dead socket.
    idleTimeoutMillis: 20_000,
  })
  // An idle connection dropping (laptop sleep, network blip, Neon restart)
  // surfaces as an 'error' event on the pool. With no listener, Node treats
  // it as unhandled and kills the whole process. Log it; the next query gets
  // a fresh connection.
  neonPool.on('error', (err: Error) => {
    console.warn('[db] idle Neon connection dropped:', err.message || err)
  })
  // Hand Kysely only the three members it needs. Neon's `Pool.Client` is typed
  // with an older `connect(): Promise<void>` signature that Kysely 0.29 rejects;
  // without it Kysely cancels aborted queries over a pooled connection instead.
  const pool: PostgresPool = {
    connect: () => neonPool.connect(),
    end: () => neonPool.end(),
    options: neonPool.options,
  }
  return new Kysely<DB>({ dialect: new PostgresDialect({ pool }) })
}

let handle: Promise<{ db: Database; kind: DbKind }> | undefined

async function open(): Promise<{ db: Database; kind: DbKind }> {
  const url = (process.env.DATABASE_URL ?? '').trim()
  if (url) return { db: createNeonDb(url), kind: 'neon' }
  if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
    throw new Error('DATABASE_URL is not set')
  }
  // No database configured on a developer machine: use an embedded Postgres
  // (PGlite) stored under server/.data so the app runs with zero setup.
  const { createLocalDb } = await import('./local.js')
  return { db: await createLocalDb(), kind: 'pglite' }
}

function opened(): Promise<{ db: Database; kind: DbKind }> {
  if (!handle) {
    const attempt = open()
    handle = attempt
    // A failed open (network blip, cold start) must not be cached forever.
    attempt.catch(() => {
      if (handle === attempt) handle = undefined
    })
  }
  return handle
}

/** The process-wide database handle. Opened on first use. */
export async function getDb(): Promise<Database> {
  return (await opened()).db
}

export async function getDbKind(): Promise<DbKind> {
  return (await opened()).kind
}

/** Tests inject an in-memory database here. */
export function setDb(db: Database, kind: DbKind = 'pglite'): void {
  handle = Promise.resolve({ db, kind })
}

/** A jsonb value. Serialised here so both drivers send the same thing. */
export function jsonb(value: unknown): RawBuilder<unknown> {
  return value == null ? sql`null` : sql`${JSON.stringify(value)}::jsonb`
}

export * from './generated/enums.js'
export type * from './generated/types.js'
