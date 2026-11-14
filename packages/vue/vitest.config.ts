import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 20000,
    server: { deps: { inline: [/@tiptap\//, /katex/, /@learnhouse\/react/] } },
    css: false,
  },
})
