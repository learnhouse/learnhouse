import { describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// Every string the editor's loader and live editing notices render must exist
// in every locale, so no language falls back to English.
const root = join(import.meta.dir, '..')
const locales = readdirSync(join(root, 'locales')).filter((f) => f.endsWith('.json'))
const load = (f) => JSON.parse(readFileSync(join(root, 'locales', f), 'utf8'))
const get = (obj, path) => path.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj)

const sources = [
  'components/Objects/Editor/EditorLoader.tsx',
  'components/Objects/Editor/EditorWrapper.tsx',
  'components/Objects/Editor/Collab/CollabNotice.tsx',
]
const used = new Set()
for (const file of sources) {
  const text = readFileSync(join(root, file), 'utf8')
  for (const m of text.matchAll(/\bt\(\s*['"`](editor\.(?:loader|live_editing)\.[\w.]+)['"`]/g)) used.add(m[1])
}

describe('editor loader and live editing strings', () => {
  test('finds the keys it checks', () => {
    for (const key of ['editor.loader.signed_out', 'editor.loader.stalled', 'editor.loader.sign_in', 'editor.live_editing.reconnecting', 'editor.live_editing.unavailable_manual', 'editor.live_editing.forbidden']) {
      expect(used.has(key)).toBe(true)
    }
  })

  test.each(locales)('%s has every key', (file) => {
    const strings = load(file)
    const missing = [...used].filter((key) => typeof get(strings, key) !== 'string' || !get(strings, key).trim())
    expect(missing).toEqual([])
  })
})
