import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2020',
  external: [
    'react',
    'react-dom',
    'react/jsx-runtime',
    '@tanstack/react-query',
    '@tiptap/core',
    '@tiptap/pm',
    '@tiptap/react',
    '@tiptap/starter-kit',
  ],
})
