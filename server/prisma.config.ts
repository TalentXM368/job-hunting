import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'prisma/config'

// Prisma 7 no longer reads .env by itself. Load db/.env, then the repo-root
// .env that the Python side already uses. Values already in the environment
// (Vercel, CI) win, because loadEnvFile never overwrites.
const here = dirname(fileURLToPath(import.meta.url))
for (const file of [resolve(here, '.env'), resolve(here, '..', '.env')]) {
  if (existsSync(file)) process.loadEnvFile(file)
}

// Migrations must use Neon's direct connection, not the pooled one: the pooler
// runs in transaction mode and breaks the advisory lock Prisma takes.
// These are the names Neon's Vercel integration sets.
const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL || ''

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url },
})
