import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const API = 'http://localhost:8787'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // The API server accepts the /api prefix itself, so no path rewrite.
      '/api': {
        target: API,
        configure(proxy) {
          // Vite's default error is a stack trace that says nothing about the
          // cause. Say what it is and how to fix it, once per burst.
          let lastWarned = 0
          proxy.on('error', (err, _req, res) => {
            if (err.code === 'ECONNREFUSED' && Date.now() - lastWarned > 5000) {
              lastWarned = Date.now()
              console.error(`\n[api] Nothing is running on ${API}. Start the API too:\n` +
                '       cd server && npm run dev:all     (API + UI together)\n' +
                '       or, in another terminal:  cd server && npm run dev\n')
            }
            if (res && 'writeHead' in res && !res.headersSent) {
              res.writeHead(503, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'The API server is not running. Start it with "cd server && npm run dev:all".' }))
            }
          })
        },
      },
    },
  },
})
