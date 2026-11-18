// Local server: `npm run dev` in server/. Loads .env, then listens on :8787,
// which is where the Vite dev proxy sends /api.

import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { serve } from '@hono/node-server'

const here = dirname(fileURLToPath(import.meta.url))
// server/.env first, then the repo-root .env. Values already in the
// environment win, because loadEnvFile never overwrites.
for (const file of [resolve(here, '..', '.env'), resolve(here, '..', '..', '.env')]) {
  if (existsSync(file)) process.loadEnvFile(file)
}

// Imported after the env is loaded so nothing reads a variable too early.
const { default: app } = await import('./app.js')
const { getDbKind } = await import('./db/client.js')

const port = Number(process.env.PORT) || 8787
serve({ fetch: app.fetch, port }, async () => {
  const kind = await getDbKind()
  console.log(`jobhunt API on http://localhost:${port}  (database: ${kind === 'neon' ? 'Neon' : 'embedded PGlite in server/.data'})`)
})
