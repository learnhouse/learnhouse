import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['bin/learnhouse.ts'],
  format: ['esm'],
  target: 'node18',
  outDir: 'dist/bin',
  clean: true,
  splitting: false,
  bundle: true,
  platform: 'node',
  banner: {
    js: [
      '#!/usr/bin/env node',
      'import { createRequire as __createRequire } from "module";',
      'const require = __createRequire(import.meta.url);',
    ].join('\n'),
  },
  noExternal: [/@clack\/prompts/, /picocolors/, /commander/],
})
