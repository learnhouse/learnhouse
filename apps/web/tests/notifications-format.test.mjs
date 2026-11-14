import { describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'

import {
  badgeText,
  dayBucket,
  groupByDay,
  headlineKeys,
  bodyKeys,
  headlineParams,
  placeholders,
  prependItem,
  resolveBody,
  resolveHeadline,
  rowTime,
  withoutItem,
} from '../lib/notifications/format.ts'

const en = JSON.parse(fs.readFileSync(path.join(import.meta.dir, '../locales/en.json'), 'utf8'))
const get = (obj, key) => key.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj)
const template = (key) => get(en, key)
const translate = (key, params) => template(key).replace(/{{\s*(\w+)\s*}}/g, (_, k) => String(params[k]))

const item = (over = {}) => ({
  notification_uuid: 'n1',
  type: 'assignment_graded',
  title: 'Graded: Essay',
  count: 1,
  created_at: new Date().toISOString(),
  data: { params: { assignment: 'Essay', course: 'Writing' } },
  actor: null,
  ...over,
})

describe('day grouping', () => {
  const now = new Date(2026, 10, 13, 15, 0)
  test('buckets', () => {
    expect(dayBucket(new Date(2026, 10, 13, 9).toISOString(), now)).toBe('today')
    expect(dayBucket(new Date(2026, 10, 12, 23).toISOString(), now)).toBe('yesterday')
    expect(dayBucket(new Date(2026, 10, 9).toISOString(), now)).toBe('week')
    expect(dayBucket(new Date(2026, 9, 1).toISOString(), now)).toBe('earlier')
    expect(dayBucket('not a date', now)).toBe('earlier')
  })
  test('consecutive groups keep order', () => {
    const rows = [
      { created_at: new Date(2026, 10, 13, 14).toISOString(), id: 1 },
      { created_at: new Date(2026, 10, 13, 8).toISOString(), id: 2 },
      { created_at: new Date(2026, 10, 12, 8).toISOString(), id: 3 },
      { created_at: new Date(2026, 9, 2).toISOString(), id: 4 },
    ]
    const groups = groupByDay(rows, now)
    expect(groups.map((g) => g.bucket)).toEqual(['today', 'yesterday', 'earlier'])
    expect(groups[0].items.map((r) => r.id)).toEqual([1, 2])
  })
})

describe('headline', () => {
  test('placeholders', () => {
    expect(placeholders('{{actor}} replied to {{ discussion }} ({{count, number}})')).toEqual(['actor', 'discussion', 'count'])
  })
  test('params add actor and count', () => {
    expect(headlineParams(item({ actor: { name: 'Ana' }, count: 3 }))).toEqual({ assignment: 'Essay', course: 'Writing', actor: 'Ana', count: 3 })
    // The real actor's name wins over stored copy, so the name always matches the avatar.
    expect(headlineParams(item({ data: { params: { actor: 'Bo', bad: { x: 1 } } }, actor: { name: 'Ana' } })).actor).toBe('Ana')
    expect(headlineParams(item({ data: { params: { actor: 'Bo' } } })).actor).toBe('Bo')
  })
  test('keys: live kind, collapsed, type', () => {
    expect(headlineKeys(item({ type: 'live_session', data: { kind: 'live' } }))).toEqual(['live_session_live', 'live_session'])
    expect(headlineKeys(item({ type: 'discussion_reply', count: 4 }))).toEqual(['discussion_reply_many', 'discussion_reply'])
  })
  test('translated when the template has every variable', () => {
    expect(resolveHeadline(item(), template, translate)).toBe('Graded: Essay')
    const reply = item({ type: 'discussion_reply', count: 3, data: { params: { discussion: 'Intro' } }, actor: { name: 'Ana' } })
    expect(resolveHeadline(reply, template, translate)).toBe('3 new replies to Intro')
    const live = item({ type: 'live_session', data: { kind: '15m', params: { title: 'Office hours' } } })
    expect(resolveHeadline(live, template, translate)).toBe('Starting in 15 minutes: Office hours')
  })
  test('falls back to the server title', () => {
    expect(resolveHeadline(item({ data: {} }), template, translate)).toBe('Graded: Essay')
    expect(resolveHeadline(item({ type: 'message', title: 'Ana' }), template, translate)).toBe('Ana')
    expect(resolveHeadline(item(), template, () => '{{assignment}}')).toBe('Graded: Essay')
  })
  test('every copy template names only known variables and every type has a label', () => {
    const known = new Set(['actor', 'count', 'assignment', 'course', 'update', 'chapter', 'path', 'play', 'title', 'discussion', 'activity', 'group', 'product', 'company', 'board', 'provider', 'campaign', 'limit', 'days', 'remaining', 'agent'])
    for (const [key, value] of Object.entries(en.notifications.copy)) {
      for (const p of placeholders(value)) expect(known.has(p) ? p : `${key}:${p}`).toBe(p)
      const type = key.replace(/_(many|24h|15m|live)$/, '')
      expect(en.notifications.types[type]).toBeTruthy()
    }
  })
})

describe('small helpers', () => {
  test('row time follows the day group', () => {
    const now = new Date(2026, 10, 14, 15, 0)
    expect(rowTime(new Date(2026, 10, 14, 14, 59, 40).toISOString(), 'en', now)).toBe('now')
    expect(rowTime(new Date(2026, 10, 14, 14, 46).toISOString(), 'en', now)).toBe('14m')
    expect(rowTime(new Date(2026, 10, 14, 12, 10).toISOString(), 'en', now)).toBe('2h')
    expect(rowTime(new Date(2026, 10, 13, 14, 20).toISOString(), 'en', now)).toMatch(/^2:20\s?PM$/)
    expect(rowTime(new Date(2026, 10, 10, 9, 5).toISOString(), 'en', now)).toMatch(/^Tue 9:05\s?AM$/)
    expect(rowTime(new Date(2026, 9, 3).toISOString(), 'en', now)).toBe('Oct 3')
    expect(rowTime(new Date(2025, 9, 3).toISOString(), 'en', now)).toBe('Oct 3, 2025')
    expect(rowTime('nope', 'en', now)).toBe('')
  })
  test('body: localized detail from params, else the server body', () => {
    const fmt = (iso) => `@${iso.slice(0, 10)}`
    const graded = item({ body: 'server', data: { params: { grade: '92%', course: 'Writing', feedback: 'Great structure' } } })
    expect(bodyKeys(graded)).toEqual(['assignment_graded_feedback', 'assignment_graded'])
    expect(resolveBody(graded, template, translate, fmt)).toBe('Grade: 92% · “Great structure”')
    const due = item({ type: 'assignment_due', body: 'server', data: { params: { course: 'Writing', due_at: '2026-11-20T10:00:00Z' } } })
    expect(resolveBody(due, template, translate, fmt)).toBe('Writing · due @2026-11-20')
    const live = item({ type: 'live_session', body: 'server', data: { kind: 'live', params: { title: 'Q&A' } } })
    expect(resolveBody(live, template, translate, fmt)).toBe('The host has started. Join now.')
    const chapters = item({ type: 'chapter_unlocked', body: 'server', data: { params: { course: 'C', count: 3 } } })
    expect(resolveBody(chapters, template, translate, fmt)).toBe('3 new chapters are open')
    // No template, or a missing variable: the server's body.
    expect(resolveBody(item({ type: 'message', body: 'hi' }), template, translate, fmt)).toBe('hi')
    expect(resolveBody(item({ type: 'assignment_due', body: 'srv', data: { params: {} } }), template, translate, fmt)).toBe('srv')
    expect(resolveBody(item({ type: 'assignment_due', data: { params: {} } }), template, translate, fmt)).toBe('')
    expect(resolveBody(graded, template, () => '{{x}}', fmt)).toBe('server')
  })
  test('badge', () => {
    expect(badgeText(5)).toBe('5')
    expect(badgeText(120)).toBe('99+')
  })
  test('list edits', () => {
    const rows = [{ notification_uuid: 'a', read: false, type: 'm' }, { notification_uuid: 'b', read: true, type: 'm' }]
    expect(withoutItem(rows, 'a')).toEqual({ items: [rows[1]], wasUnread: true })
    expect(withoutItem(rows, 'b').wasUnread).toBe(false)
    const next = prependItem(rows, { notification_uuid: 'c', type: 'm' }, (x, y) => x.type === y.type && x.notification_uuid === 'b')
    expect(next.map((r) => r.notification_uuid)).toEqual(['c', 'a'])
    expect(prependItem(rows, { notification_uuid: 'a', type: 'm' }).map((r) => r.notification_uuid)).toEqual(['a', 'b'])
  })
})

describe('locales', () => {
  test('every locale has every notification key (or its plural forms)', () => {
    const flat = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? flat(v, `${p}${k}.`) : [`${p}${k}`]))
    const base = new Set(flat(en.notifications).map((k) => k.replace(/_(one|other)$/, '')))
    const dir = path.join(import.meta.dir, '../locales')
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      const loc = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))
      const keys = new Set(flat(loc.notifications || {}).map((k) => k.replace(/_(zero|one|two|few|many|other)$/, '')))
      // Collapsed-sentence keys end in _many on purpose; normalize both sides the same way.
      const missing = [...base].map((k) => k.replace(/_many$/, '')).filter((k) => !keys.has(k) && !keys.has(`${k}_many`))
      expect(`${file}: ${missing.join(', ')}`).toBe(`${file}: `)
    }
  })
})

describe('catalog', () => {
  // The API catalog is the source of truth: every type it can write must
  // render here (a label, a translated headline or a deliberate fallback)
  // and have a deep link.
  const src = fs.readFileSync(path.join(import.meta.dir, '../../api/src/db/notifications.py'), 'utf8')
  const block = (name) => src.slice(src.indexOf(`${name}`), src.indexOf('\n}\n', src.indexOf(`${name}`)))
  const types = [...block('NOTIFICATION_TYPE_META: dict').matchAll(/^\s+"([a-z_]+)": TypeMeta\(/gm)].map((m) => m[1])
  const links = Object.fromEntries([...block('NOTIFICATION_LINKS: dict').matchAll(/^\s+"([a-z_]+)": "([^"]+)"/gm)].map((m) => [m[1], m[2]]))
  // Titles that are already the right words (the sender's name for a DM).
  const TITLE_ONLY = new Set(['message'])

  test('the catalog parses', () => {
    expect(types.length).toBeGreaterThan(40)
  })
  test('every type has a label, a headline and a deep link', () => {
    const missing = []
    for (const t of types) {
      if (!en.notifications.types[t]) missing.push(`${t}: label`)
      const copy = en.notifications.copy
      if (!TITLE_ONLY.has(t) && !copy[t] && !Object.keys(copy).some((k) => k.startsWith(`${t}_`))) missing.push(`${t}: headline`)
      if (!links[t] || !links[t].startsWith('/')) missing.push(`${t}: link`)
    }
    expect(missing).toEqual([])
  })
  test('every category the API knows has a label and a hint', () => {
    const cats = [...src.matchAll(/^(?:PERSONAL|ADMIN)_CATEGORIES = \(([^)]*)\)/gms)].flatMap((m) => [...m[1].matchAll(/"([a-z]+)"/g)].map((x) => x[1]))
    expect(cats.length).toBe(14)
    for (const c of cats) {
      expect(en.notifications.categories[c]).toBeTruthy()
      expect(en.notifications.category_hints[c]).toBeTruthy()
    }
  })
})
