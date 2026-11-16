import { describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

/**
 * Dark mode is manual only: nothing may follow the OS color scheme, and the
 * pre-paint script (public/theme-init.js, which cannot import anything) must
 * agree with lib/theme/colorScheme.ts.
 */

const webRoot = path.resolve(import.meta.dirname, '..')
const read = (p) => fs.readFileSync(path.join(webRoot, p), 'utf8')

function walk(dir, exts, out = []) {
  for (const entry of fs.readdirSync(path.join(webRoot, dir), { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const rel = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(rel, exts, out)
    else if (exts.some((e) => entry.name.endsWith(e))) out.push(rel)
  }
  return out
}

/** Runs theme-init.js against a fake document; returns what it painted. */
function runInit({ stored, pathname = '/dash', throws = false }) {
  const attrs = {}
  const style = {}
  const ctx = {
    location: { pathname },
    localStorage: {
      getItem: (k) => {
        if (throws) throw new Error('blocked')
        return k === 'lh:theme' ? stored ?? null : null
      },
    },
    document: { documentElement: { setAttribute: (k, v) => (attrs[k] = v), style } },
  }
  vm.runInNewContext(read('public/theme-init.js'), ctx)
  return { theme: attrs['data-theme'] ?? null, colorScheme: style.colorScheme ?? null }
}

describe('theme-init.js', () => {
  test('paints dark only for a stored dark choice', () => {
    expect(runInit({ stored: 'dark' })).toEqual({ theme: 'dark', colorScheme: 'dark' })
    expect(runInit({ stored: 'light' })).toEqual({ theme: null, colorScheme: null })
    expect(runInit({ stored: null })).toEqual({ theme: null, colorScheme: null })
  })

  test('embeds follow their host, blocked storage stays light', () => {
    expect(runInit({ stored: 'dark', pathname: '/embed/acme/course/1/activity/2' }).theme).toBe(null)
    expect(runInit({ stored: 'dark', throws: true }).theme).toBe(null)
  })

  test('never reads the OS setting', () => {
    expect(read('public/theme-init.js')).not.toContain('matchMedia')
    expect(read('lib/theme/colorScheme.ts')).not.toContain('prefers-color-scheme')
  })

  test('agrees with lib/theme/colorScheme.ts', () => {
    const lib = read('lib/theme/colorScheme.ts')
    const key = lib.match(/THEME_STORAGE_KEY = '([^']+)'/)[1]
    expect(read('public/theme-init.js')).toContain(`'${key}'`)
    expect(lib).toContain('/^\\/embed\\//')
    expect(read('public/theme-init.js')).toContain('/^\\/embed\\//')
  })

  test('is inlined in the root layout before hydration', () => {
    const layout = read('app/layout.tsx')
    expect(layout).toContain('file="/theme-init.js"')
    expect(read('lib/headScripts.ts')).toContain("read('theme-init.js')")
  })
})

describe('no OS-driven dark styles', () => {
  test('stylesheets never use prefers-color-scheme: dark', () => {
    for (const file of walk('styles', ['.css'])) {
      expect({ file, hit: /prefers-color-scheme\s*:\s*dark/.test(read(file)) }).toEqual({ file, hit: false })
    }
  })

  test('the Tailwind dark variant keys off the manual attribute', () => {
    const css = read('styles/globals.css')
    expect(css).toMatch(/@custom-variant dark \(&:where\(\[data-theme='dark'\], \[data-theme='dark'\] \*\)\)/)
    expect(css).toContain('@import "./dark.css"')
  })

  test('components never query the OS color scheme', () => {
    // BlockThemeScope only re-measures its host on the change event; the
    // newsletter preview strips the media query out of email HTML.
    const allowed = new Set([
      'components/Objects/Activities/BlockTheme/BlockThemeScope.tsx',
      'ee/components/Newsletter/Public/NewsletterIssue.tsx',
    ])
    const hits = walk('components', ['.ts', '.tsx'])
      .concat(walk('app', ['.ts', '.tsx']), walk('lib', ['.ts', '.tsx']))
      .filter((f) => !allowed.has(f) && /prefers-color-scheme/.test(read(f)))
    expect(hits).toEqual([])
  })
})

/** Splits a selector list on its top-level commas (not inside :is() / [..]). */
function splitSelectors(list) {
  const out = []
  let depth = 0
  let cur = ''
  for (const ch of list) {
    if (ch === '(' || ch === '[') depth++
    if (ch === ')' || ch === ']') depth--
    if (ch === ',' && depth === 0) {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out.map((x) => x.trim()).filter(Boolean)
}

describe('dark.css', () => {
  const css = read('styles/dark.css')
  test('everything is scoped under the manual attribute', () => {
    // Strip comments, then every top-level selector must start from html[data-theme='dark'].
    const body = css.replace(/\/\*[\s\S]*?\*\//g, '')
    const selectors = [...body.matchAll(/(^|\})\s*([^{}@]+)\{/g)].map((m) => m[2].trim())
    expect(selectors.length).toBeGreaterThan(20)
    for (const list of selectors) {
      for (const sel of splitSelectors(list)) {
        expect({ sel, ok: /^(:where\()?html\[data-theme='dark'\]/.test(sel) }).toEqual({ sel, ok: true })
      }
    }
  })
})
