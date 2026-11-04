import { fileURLToPath } from 'node:url'
import { defineConfig } from 'tsup'

const fromHere = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  target: 'es2020',
  platform: 'neutral',
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: false,
  treeshake: true,
  outDir: 'dist',
  esbuildOptions(options) {
    // apps/web/services/media/media.ts is compiled in from source. Its only
    // import, @services/config/config, is replaced by a shim bound to the
    // client's baseUrl/mediaUrl. esbuild applies `alias` before tsconfig paths,
    // so apps/web's own @services/* mapping never pulls in the Next config.
    options.alias = {
      '@learnhouse-web/media': fromHere('../../apps/web/services/media/media.ts'),
      '@services/config/config': fromHere('./src/media/config-shim.ts'),
    }
  },
})
