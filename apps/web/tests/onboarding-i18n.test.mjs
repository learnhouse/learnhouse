import { describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// Every string the onboarding screens render must exist in every locale, with
// the same {{placeholders}} as English, so no language falls back or breaks.
const root = join(import.meta.dir, '..')
const locales = readdirSync(join(root, 'locales')).filter((f) => f.endsWith('.json'))
const load = (f) => JSON.parse(readFileSync(join(root, 'locales', f), 'utf8'))
const en = load('en.json')

const get = (obj, path) => path.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj)
const placeholders = (s) => [...String(s).matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).sort()

const STEPS = ['create_course', 'add_content', 'brand_school', 'share_grow', 'invite_learners', 'build_community']
const INTENTS = ['customers', 'team', 'sell', 'school']
const NEXT = ['certificates', 'analytics', 'next_course']

// Keys the components build from templates, expanded over their values.
const expand = (key) => {
  if (key.includes('${') === false) return [key]
  if (/n\.key/.test(key)) return NEXT.map((v) => key.replace(/\$\{[^}]+\}/, v))
  if (/intent|it\.id/.test(key)) return INTENTS.map((v) => key.replace(/\$\{[^}]+\}/, v))
  return STEPS.map((v) => key.replace(/\$\{[^}]+\}/, v))
}

const sources = [
  'app/orgs/[orgslug]/dash/onboarding/page.tsx',
  ...readdirSync(join(root, 'components/Dashboard/Onboarding'))
    .filter((f) => /\.tsx?$/.test(f))
    .map((f) => `components/Dashboard/Onboarding/${f}`),
]
const used = new Set()
for (const file of sources) {
  const src = readFileSync(join(root, file), 'utf8')
  for (const m of src.matchAll(/\bt\(\s*'(onboarding\.[\w.]+)'/g)) used.add(m[1])
  for (const m of src.matchAll(/\bt\(\s*`(onboarding\.[^`]+)`/g)) expand(m[1]).forEach((k) => used.add(k))
}
for (const intent of INTENTS) for (const step of STEPS) used.add(`onboarding.why.${intent}.${step}`)

describe('onboarding strings', () => {
  test('the screens use some keys (the scan works)', () => {
    expect(used.size).toBeGreaterThan(40)
  })

  test('every key exists in English', () => {
    const missing = [...used].filter((k) => typeof get(en, k) !== 'string')
    expect(missing).toEqual([])
  })

  for (const file of locales) {
    test(`${file} has every key with the same placeholders`, () => {
      const loc = load(file)
      const problems = []
      for (const key of used) {
        const value = get(loc, key)
        if (typeof value !== 'string') problems.push(`missing ${key}`)
        else if (placeholders(value).join() !== placeholders(get(en, key)).join()) problems.push(`placeholders ${key}`)
      }
      expect(problems).toEqual([])
    })
  }
})
