import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/health': 'http://localhost:8000',
      '/companies': 'http://localhost:8000',
      '/config': 'http://localhost:8000',
      '/search': 'http://localhost:8000',
      '/suggest': 'http://localhost:8000',
    },
  },
})
