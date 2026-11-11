import { copyFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'tsup'

const fromHere = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'es2020',
  platform: 'browser',
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  outDir: 'dist',
  // The renderer is @learnhouse/react's <learnhouse-activity>; nothing of it is
  // bundled here.
  external: ['vue', '@learnhouse/sdk', '@learnhouse/react', '@learnhouse/react/element'],
  // Ship the react package's stylesheet under this package's name, so it can
  // be imported without depending on @learnhouse/react directly (pnpm).
  async onSuccess() {
    await copyFile(fromHere('../react/dist/styles.css'), fromHere('./dist/styles.css'))
  },
})
