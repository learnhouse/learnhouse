import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  server: { port: 3538, strictPort: true },
  // DEMO_SINGLE=1 builds one self-contained file (open it straight from disk).
  build: process.env.DEMO_SINGLE ? { rollupOptions: { output: { inlineDynamicImports: true } }, assetsInlineLimit: 1e9, cssCodeSplit: false } : {},
})
