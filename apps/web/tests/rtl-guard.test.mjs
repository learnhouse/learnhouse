import { describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Guards the RTL invariants that ESLint can't see: raw CSS, and a constant
 * that is deliberately duplicated into a file the bundler never touches.
 */

const webRoot = path.resolve(import.meta.dirname, '..')
const read = (p) => fs.readFileSync(path.join(webRoot, p), 'utf8')

describe('RTL language set', () => {
  // public/dir-init.js runs before any bundle loads, so it cannot import
  // lib/direction.ts and has to carry its own copy of the RTL list. That makes
  // it exactly the kind of constant that drifts silently.
  test('dir-init.js matches RTL_LANGUAGES in lib/direction.ts', () => {
    const initSrc = read('public/dir-init.js')
    const directionSrc = read('lib/direction.ts')

    const initBlock = initSrc.match(/var RTL = \{([\s\S]*?)\}/)
    expect(initBlock).not.toBeNull()
    const initCodes = [...initBlock[1].matchAll(/(\w+):\s*1/g)].map((m) => m[1]).sort()

    const setBlock = directionSrc.match(/RTL_LANGUAGES = new Set\(\[([\s\S]*?)\]\)/)
    expect(setBlock).not.toBeNull()
    const setCodes = [...setBlock[1].matchAll(/'([a-z]+)'/g)].map((m) => m[1]).sort()

    expect(initCodes.length).toBeGreaterThan(0)
    expect(initCodes).toEqual(setCodes)
  })

  test('Arabic and Persian are RTL', () => {
    const src = read('lib/direction.ts')
    const setBlock = src.match(/RTL_LANGUAGES = new Set\(\[([\s\S]*?)\]\)/)[1]
    expect(setBlock).toContain("'ar'")
    expect(setBlock).toContain("'fa'")
  })
})

describe('language registry', () => {
  const src = read('lib/languages.ts')
  const entries = [...src.matchAll(/\{\s*code:\s*'([a-z]+)'[^}]*\}/g)]

  test('every language declares a direction', () => {
    expect(entries.length).toBeGreaterThan(20)
    for (const entry of entries) {
      expect(entry[0]).toMatch(/dir:\s*'(ltr|rtl)'/)
    }
  })

  test('ar and fa are the RTL entries', () => {
    const rtl = entries.filter((e) => /dir:\s*'rtl'/.test(e[0])).map((e) => e[1]).sort()
    expect(rtl).toEqual(['ar', 'fa'])
  })

  // A locale that loads but isn't in the registry can never be picked, and one
  // in the registry without a loader falls back to English with no warning.
  test('registry and lazy loaders agree', () => {
    const i18nSrc = read('lib/i18n.ts')
    // The type annotation contains `=>`, so match lazily up to the assignment.
    const loaderBlock = i18nSrc.match(/LOCALE_LOADERS[\s\S]*?=\s*\{([\s\S]*?)\n\}/)[1]
    const loaderCodes = [...loaderBlock.matchAll(/^\s*(\w+):/gm)].map((m) => m[1]).sort()

    const registryCodes = entries.map((e) => e[1]).filter((c) => c !== 'en').sort()
    expect(loaderCodes).toEqual(registryCodes)
  })
})

describe('globals.css', () => {
  const css = read('styles/globals.css')
  const lines = css.split('\n')

  const DIRECTIONAL = new RegExp(
    [
      String.raw`(^|[^-\w])(left|right)\s*:`,
      String.raw`margin-(left|right)`,
      String.raw`padding-(left|right)`,
      String.raw`border-(left|right)`,
      String.raw`text-align\s*:\s*(left|right)`,
      String.raw`float\s*:\s*(left|right)`,
    ].join('|')
  )

  // Physical declarations are allowed, but only with a stated reason — so the
  // next person doesn't have to guess whether it was deliberate.
  test('every physical declaration is justified', () => {
    const unjustified = []
    lines.forEach((line, i) => {
      if (!DIRECTIONAL.test(line)) return
      const context = lines.slice(Math.max(0, i - 8), i).join('\n')
      if (/rtl-ok|mirrored|no logical form/.test(context)) return
      unjustified.push(`${i + 1}: ${line.trim()}`)
    })
    expect(unjustified).toEqual([])
  })

  test('RTL affordances are present', () => {
    expect(css).toContain('--font-arabic')
    expect(css).toContain('unicode-bidi: plaintext')
    expect(css).toMatch(/\[dir='rtl'\]/)
  })

  // Being present in the source is not enough — a rule can be valid, correct,
  // and still never reach the browser. The icon-mirroring block was silently
  // swallowed once because a comment above it contained `*/`, which closed the
  // comment early and took the following rule with it. Nothing failed: no
  // build error, no lint error, the app just quietly stopped mirroring icons.
  // So assert against the COMPILED output, not the source.
  test('RTL rules survive compilation', async () => {
    const { default: tailwind } = await import('@tailwindcss/postcss')
    const { default: postcss } = await import('postcss')

    const result = await postcss([tailwind({ base: webRoot, optimize: { minify: true } })])
      .process(css, { from: path.join(webRoot, 'styles/globals.css') })

    for (const needle of [
      'lucide-chevron-right', // directional icon mirroring
      'data-dir-flip', // opt-in for icon libraries without per-icon classes
      'recharts-wrapper', // charts locked to LTR
      'unicode-bidi', // per-block direction for authored content
      '--leading-tight', // Arabic line-height
      'lh-toast', // toast direction
      'lh-org-font-root', // Tajawal overriding the inline org font
    ]) {
      expect(result.css).toContain(needle)
    }

    // Tajawal must be forced, not offered as a fallback. next/font injects a
    // local "<Family> Fallback" face for CLS, and on macOS that adjusted system
    // font covers Arabic — so a per-glyph fallback stack resolves there and the
    // real Arabic face never loads. Two !important rules (one per layer,
    // because the base font-family is declared in both) are what prevent that.
    const forced = result.css.match(/font-family:var\(--font-arabic\)[^}]*!important/g) ?? []
    expect(forced.length).toBe(2)
  }, 60_000)
})

describe('Arabic translations', () => {
  const en = JSON.parse(read('locales/en.json'))
  const ar = JSON.parse(read('locales/ar.json'))

  const flatten = (obj, prefix = '') =>
    Object.entries(obj).flatMap(([k, v]) =>
      v && typeof v === 'object' && !Array.isArray(v)
        ? flatten(v, `${prefix}${k}.`)
        : [`${prefix}${k}`]
    )

  test('ar.json covers every en.json key', () => {
    const missing = flatten(en).filter((k) => !new Set(flatten(ar)).has(k))
    expect(missing).toEqual([])
  })
})
