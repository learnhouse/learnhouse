import { describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'

import { chartSeries, color, cssTokenList, shadow, zIndex } from '../design/tokens.ts'
import { recipes } from '../design/recipes.ts'
import { extractTokensCss, renderTokensCss } from '../design/tokensCss.ts'

// Guards the V2 design system (design/DESIGN.md): the token file is the single
// source, and the CSS, the button recipes, the chart palette and the docs must
// not drift away from it.

const webRoot = path.resolve(import.meta.dirname, '..')
const read = (p) => fs.readFileSync(path.join(webRoot, p), 'utf8')
const css = read('styles/globals.css')

/** Tailwind arbitrary-value spelling of a CSS value (spaces become underscores). */
const arbitrary = (value) => value.replace(/ /g, '_')

describe('design tokens ↔ globals.css', () => {
  test('the @design-tokens block matches design/tokens.ts', () => {
    const block = extractTokensCss(css)
    expect(block).not.toBeNull()
    // On failure: run `bun scripts/design-tokens.mjs` from apps/web.
    expect(block).toBe(renderTokensCss())
  })

  test('lh token variables are defined only inside the generated block', () => {
    const outside = css.replace(extractTokensCss(css), '')
    expect(outside).not.toMatch(/--(color|radius|shadow|spacing|text|ease)-lh-[\w-]+\s*:/)
    expect(outside).not.toMatch(/--lh-duration-[\w-]+\s*:/)
  })

  test('every CSS token has a unique variable name', () => {
    const names = cssTokenList().map((t) => t.cssVar)
    expect(new Set(names).size).toBe(names.length)
  })

  test('hex fallbacks agree with literal hex values', () => {
    for (const [name, token] of Object.entries(color)) {
      if (/^#[0-9a-f]{6}$/i.test(token.value)) expect([name, token.hex.toLowerCase()]).toEqual([name, token.value.toLowerCase()])
    }
  })

  test('zIndex mirrors the --z-* layering in globals.css', () => {
    const fromCss = Object.fromEntries([...css.matchAll(/--z-([\w-]+):\s*(-?\d+);/g)].map((m) => [m[1], Number(m[2])]))
    expect(Object.keys(fromCss).length).toBeGreaterThan(10)
    expect(zIndex).toEqual(fromCss)
  })
})

describe('design tokens ↔ components', () => {
  const buttons = read('components/Dashboard/Shared/DashKit/buttons.ts')
  const dashKit = read('components/Dashboard/Shared/DashKit/DashKit.tsx')

  test('button reliefs in buttons.ts are the shadow tokens', () => {
    for (const key of ['btn-primary', 'btn-secondary', 'btn-danger']) {
      expect(buttons).toContain(`shadow-[${arbitrary(shadow[key].value)}]`)
    }
  })

  test('the selected track item uses the segment shadow everywhere', () => {
    const cls = `shadow-[${arbitrary(shadow.segment.value)}]`
    expect(recipes.trackItemActive).toContain(cls)
    expect(dashKit).toContain(cls)
  })

  test('recipes repeat the DashKit classes they name', () => {
    expect(dashKit).toContain(recipes.track.replace('inline-flex items-center ', ''))
    expect(read('components/Objects/AI/AIBrand.tsx')).toContain(`panel: '${recipes.card} overflow-hidden'`)
  })

  // EE is a separate checkout (symlinked in development, absent in OSS CI).
  const palettePath = path.join(webRoot, 'ee/components/Analytics/Kit/palette.ts')
  test.skipIf(!fs.existsSync(palettePath))('chart tokens match the analytics palette', () => {
    const src = fs.readFileSync(palettePath, 'utf8')
    const series = [...src.match(/SERIES = \[([\s\S]*?)\]/)[1].matchAll(/'(#[0-9a-f]{6})'/gi)].map((m) => m[1])
    expect([...chartSeries]).toEqual(series)
    expect(color['chart-previous'].value).toBe(src.match(/PREVIOUS = '(#[0-9a-f]{6})'/i)[1])
    expect(color['chart-grid'].value).toBe(src.match(/GRID = '(#[0-9a-f]{6})'/i)[1])
    expect(color['chart-axis'].value).toBe(src.match(/AXIS_TEXT = '(#[0-9a-f]{6})'/i)[1])
  })
})

describe('design index ↔ DESIGN.md', () => {
  const index = read('design/index.ts')
  const doc = read('design/DESIGN.md')

  const exported = new Set(
    [...index.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}\s+from/g)].flatMap((m) =>
      m[1]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => s.split(/\s+as\s+/).pop())
    )
  )

  const section = doc.split(/^## Public API\s*$/m)[1]?.split(/^## /m)[0] ?? ''
  const documented = new Set(
    section
      .split('\n')
      .filter((line) => line.startsWith('| `'))
      .flatMap((line) => [...line.split('|')[1].matchAll(/`([A-Za-z_]\w*)`/g)].map((m) => m[1]))
  )

  test('the index uses named re-exports only', () => {
    expect(index).not.toMatch(/^export \*/m)
    expect(exported.size).toBeGreaterThan(50)
  })

  test('everything DESIGN.md documents is exported', () => {
    expect([...documented].filter((name) => !exported.has(name))).toEqual([])
  })

  test('everything exported is documented', () => {
    expect([...exported].filter((name) => !documented.has(name))).toEqual([])
  })
})

describe('style guide', () => {
  const dir = 'app/orgs/[orgslug]/design-system'

  test('is development only', () => {
    const page = read(`${dir}/page.tsx`)
    expect(page).toMatch(/process\.env\.NODE_ENV === 'production'\) notFound\(\)/)
    expect(page).toMatch(/index: false/)
  })

  test('is not linked from the app', () => {
    const offenders = []
    const walk = (rel) => {
      for (const entry of fs.readdirSync(path.join(webRoot, rel), { withFileTypes: true })) {
        const child = path.join(rel, entry.name)
        if (entry.isDirectory()) {
          if (child !== dir && entry.name !== 'node_modules') walk(child)
        } else if (/\.(tsx?|mjs)$/.test(entry.name) && fs.readFileSync(path.join(webRoot, child), 'utf8').includes("'/design-system")) {
          offenders.push(child)
        }
      }
    }
    walk('app')
    walk('components')
    expect(offenders).toEqual([])
  })
})
