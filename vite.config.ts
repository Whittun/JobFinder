import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { hhApi } from './server/hh.ts'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), hhApi()],
  server: {
    watch: { ignored: ['**/data/**', '**/*.tmp.html'] },
    fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/data/**'] },
  },
})
