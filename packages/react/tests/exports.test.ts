import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import * as runtime from '../dist/index.js'

// dist/index.d.ts comes from src/public.ts, written by hand; keep it honest.
describe('public surface', () => {
  it('declares exactly what the bundle exports', () => {
    const declared = [...readFileSync(path.join(import.meta.dirname, '../src/public.ts'), 'utf8').matchAll(/export declare (?:const|function) (\w+)/g)].map((m) => m[1])
    expect(Object.keys(runtime).sort()).toEqual(declared.sort())
  })

  it('reports the OSS version it was built from', () => {
    const web = JSON.parse(readFileSync(path.join(import.meta.dirname, '../../../apps/web/package.json'), 'utf8'))
    expect(runtime.VERSION).toBe(web.version)
  })
})
