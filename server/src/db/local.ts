// Embedded Postgres (PGlite) for local development and tests. It applies the
// same migration SQL that Prisma deploys to Neon, so the schema cannot drift.

import { mkdir, readdir, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { Kysely, PGliteDialect } from 'kysely'
import type { DB } from './generated/types.js'

const here = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = resolve(here, '..', '..', 'prisma', 'migrations')
const DEFAULT_DATA_DIR = resolve(here, '..', '..', '.data', 'pglite')

async function migrate(pg: PGlite): Promise<void> {
  await pg.exec('create table if not exists _local_migrations (name text primary key, applied_at timestamptz not null default now())')
  const done = new Set((await pg.query<{ name: string }>('select name from _local_migrations')).rows.map((r) => r.name))
  const entries = await readdir(MIGRATIONS_DIR, { withFileTypes: true })
  for (const name of entries.filter((e) => e.isDirectory()).map((e) => e.name).sort()) {
    if (done.has(name)) continue
    const sqlText = await readFile(resolve(MIGRATIONS_DIR, name, 'migration.sql'), 'utf8')
    await pg.transaction(async (tx) => {
      await tx.exec(sqlText)
      await tx.query('insert into _local_migrations (name) values ($1)', [name])
    })
  }
}

/** Pass `null` for a throwaway in-memory database (tests). */
export async function createLocalDb(dataDir: string | null = DEFAULT_DATA_DIR): Promise<Kysely<DB>> {
  if (dataDir) await mkdir(dataDir, { recursive: true })
  const pg = dataDir ? new PGlite(dataDir) : new PGlite()
  await pg.waitReady
  await migrate(pg)
  return new Kysely<DB>({ dialect: new PGliteDialect({ pglite: pg }) })
}
