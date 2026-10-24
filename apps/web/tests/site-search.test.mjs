import { describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'

import { normalizeForMatch, queryTerms, rankPages, scorePage } from '../lib/site-search/match.ts'
import { extractPreviewText } from '../lib/site-search/preview.ts'

const webRoot = path.resolve(import.meta.dirname, '..')
const read = (p) => fs.readFileSync(path.join(webRoot, p), 'utf8')

const pages = [
  { id: 'home', title: 'Home', description: 'Back to the start page', keywords: 'home, start, landing' },
  { id: 'courses', title: 'Courses', description: 'Browse every course', keywords: 'catalog, classes, lessons, learn' },
  { id: 'trail', title: 'Progress', description: 'Your progress across courses', keywords: 'trail, my courses, continue' },
  { id: 'store', title: 'Store', description: 'Paid courses and bundles', keywords: 'shop, buy, pricing' },
]

describe('query terms', () => {
  test('splits on whitespace, lowercases and NFC-normalizes', () => {
    expect(queryTerms('  My   Courses ')).toEqual(['my', 'courses'])
    expect(normalizeForMatch('Café')).toBe('café')
  })

  test('empty query has no terms', () => {
    expect(queryTerms('')).toEqual([])
    expect(queryTerms(null)).toEqual([])
  })
})

describe('page matching', () => {
  test('every word has to match, in any order', () => {
    expect(scorePage(pages[2], 'courses my')).toBeGreaterThan(0)
    expect(scorePage(pages[2], 'courses rust')).toBe(0)
  })

  test('keywords alone are enough to match', () => {
    expect(scorePage(pages[3], 'buy')).toBeGreaterThan(0)
  })

  test('a title hit outranks a keyword hit', () => {
    const ranked = rankPages(pages, 'courses').map((p) => p.id)
    expect(ranked[0]).toBe('courses')
    expect(ranked).toContain('trail')
    expect(ranked).toContain('store')
    expect(ranked).not.toContain('home')
  })

  test('an empty query keeps registry order', () => {
    expect(rankPages(pages, '   ').map((p) => p.id)).toEqual(['home', 'courses', 'trail', 'store'])
  })

  test('ties keep registry order', () => {
    const tied = [
      { id: 'a', title: 'Alpha', keywords: 'shared' },
      { id: 'b', title: 'Beta', keywords: 'shared' },
    ]
    expect(rankPages(tied, 'shared').map((p) => p.id)).toEqual(['a', 'b'])
  })
})

describe('discussion preview', () => {
  test('flattens a tiptap document', () => {
    const doc = JSON.stringify({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }, { type: 'text', text: 'world' }] }],
    })
    expect(extractPreviewText(doc)).toBe('Hello world')
  })

  test('passes plain strings through', () => {
    expect(extractPreviewText('  plain  ')).toBe('plain')
    expect(extractPreviewText(null)).toBe('')
  })
})

describe('page registry', () => {
  const en = JSON.parse(read('locales/en.json'))
  const lookup = (key) => key.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), en)

  const metaFiles = fs
    .readdirSync(path.join(webRoot, 'app/orgs/[orgslug]/(withmenu)'), { recursive: true })
    .filter((f) => String(f).endsWith('page.search.ts') && !String(f).includes('account'))
    .map((f) => path.join('app/orgs/[orgslug]/(withmenu)', String(f)))

  test('finds the learner page metadata files', () => {
    expect(metaFiles.length).toBeGreaterThanOrEqual(11)
  })

  test('every page translates its title, description and keywords', () => {
    for (const file of metaFiles) {
      const src = read(file)
      for (const field of ['titleKey', 'descriptionKey', 'keywordsKey']) {
        const match = src.match(new RegExp(`${field}: '([^']+)'`))
        expect(match, `${file} has no ${field}`).not.toBeNull()
        expect(typeof lookup(match[1]), `${file}: ${match[1]} missing from en.json`).toBe('string')
      }
    }
  })

  test('page ids are unique', () => {
    const ids = metaFiles.map((f) => read(f).match(/id: '([^']+)'/)[1])
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('the registry lists every page file', () => {
    const registry = read('lib/site-search/registry.ts')
    for (const file of metaFiles) {
      const importPath = file.replace(/\/page\.search\.ts$/, '').replace(/^app/, '@/app')
      expect(registry, `${importPath} not imported by the registry`).toContain(`'${importPath}/page.search'`)
    }
  })
})
