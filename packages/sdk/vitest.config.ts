import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const fromHere = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@learnhouse-web/media': fromHere('../../apps/web/services/media/media.ts'),
      '@services/config/config': fromHere('./src/media/config-shim.ts'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
})
