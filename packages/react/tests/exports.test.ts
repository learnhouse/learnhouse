import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import * as runtime from '../dist/index.js'
import * as element from '../dist/element.js'

// dist/index.d.ts comes from src/public.ts, written by hand; keep it honest.
describe('public surface', () => {
  it('declares exactly what the bundle exports', () => {
    const declared = [...readFileSync(path.join(import.meta.dirname, '../src/public.ts'), 'utf8').matchAll(/export declare (?:const|function) (\w+)/g)].map((m) => m[1])
    expect(Object.keys(runtime).sort()).toEqual(declared.sort())
  })

  it('declares exactly what the element entry exports', () => {
    const declared = [...readFileSync(path.join(import.meta.dirname, '../src/element-public.ts'), 'utf8').matchAll(/export declare (?:const|function|class) (\w+)/g)].map((m) => m[1])
    expect(Object.keys(element).sort()).toEqual(declared.sort())
  })

  it('reports the OSS version it was built from', () => {
    const web = JSON.parse(readFileSync(path.join(import.meta.dirname, '../../../apps/web/package.json'), 'utf8'))
    expect(runtime.VERSION).toBe(web.version)
  })

  // dependencies are what every consumer installs: compiler-only packages
  // (pulled in as peers of i18next, @tiptap/react…) don't belong there.
  it('depends on no type packages or compiler', () => {
    const pkg = JSON.parse(readFileSync(path.join(import.meta.dirname, '../package.json'), 'utf8'))
    const buildOnly = Object.keys(pkg.dependencies ?? {}).filter((name) => name === 'typescript' || name.startsWith('@types/'))
    expect(buildOnly).toEqual([])
  })

  // npm rewrites a bare https repository URL on publish and warns about it.
  it('keeps package.json in the shape npm publishes', () => {
    for (const dir of ['sdk', 'react', 'vue']) {
      const pkg = JSON.parse(readFileSync(path.join(import.meta.dirname, `../../${dir}/package.json`), 'utf8'))
      expect(pkg.repository.url, dir).toMatch(/^git\+https:\/\//)
    }
  })

  // The component runs on other people's sites: LearnHouse's own product
  // analytics must stay out of it (blocks report through onEvent instead).
  it('bundles no product analytics client', () => {
    const pkg = JSON.parse(readFileSync(path.join(import.meta.dirname, '../package.json'), 'utf8'))
    expect(Object.keys(pkg.dependencies ?? {})).not.toContain('posthog-js')
    const dist = path.join(import.meta.dirname, '../dist')
    const files = readdirSync(dist, { recursive: true }).filter((f) => String(f).endsWith('.js'))
    for (const file of files) expect(readFileSync(path.join(dist, String(file)), 'utf8')).not.toMatch(/posthog/i)
  })
})
