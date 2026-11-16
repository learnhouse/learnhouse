import { describe, expect, test } from 'bun:test'

import {
  ACTION_SENTENCES,
  KEY_PREFIX,
  UI_STRINGS,
  actionKey,
  actorName,
  allStrings,
  dateRangeBounds,
  describeEntry,
  formatValue,
  humanizeField,
  initials,
  outcomeStatus,
} from '../components/Dashboard/Pages/Org/OrgAuditLogs/auditFormat.ts'

const names = (actor = 'Maya') => ({
  actor,
  system: 'System',
  unknown: 'Someone',
  target: 'an item',
  type: (t) => ({ course: 'course', role: 'role' })[t] ?? t,
})

describe('describeEntry', () => {
  test('a single-field update reads as the field change', () => {
    const s = describeEntry(
      { id: 1, created_at: '', action: 'course.updated', category: 'content', target_type: 'course', target_name: 'DNS', changes: { name: { from: 'A', to: 'B' } } },
      names(),
    )
    expect(s.key).toBe(KEY_PREFIX + 'generic.changed_field')
    expect(s.values).toMatchObject({ actor: 'Maya', target: 'DNS', type: 'course', field: 'name', from: 'A', to: 'B' })
  })

  test('typed actions use their own sentence', () => {
    const s = describeEntry({ id: 1, created_at: '', action: 'members.role_changed', category: 'members', target_name: 'Bob', changes: { role: { from: 'User', to: 'Admin' } } }, names())
    expect(s.key).toBe(KEY_PREFIX + actionKey('members.role_changed'))
    expect(s.defaults).toBe(ACTION_SENTENCES['members.role_changed'])
    expect(s.values).toMatchObject({ from: 'User', to: 'Admin', target: 'Bob' })
  })

  test('acting on someone else picks the _other variant', () => {
    const base = { id: 1, created_at: '', category: 'enrollment', user_id: 1, target_name: 'DNS', details: { learner_id: 2, learner_name: 'Bob' } }
    expect(describeEntry({ ...base, action: 'enrollment.created' }, names()).key).toBe(KEY_PREFIX + actionKey('enrollment.created_other'))
    expect(describeEntry({ ...base, action: 'enrollment.created', details: { learner_id: 1 } }, names()).key).toBe(KEY_PREFIX + actionKey('enrollment.created'))
    expect(describeEntry({ ...base, action: 'members.removed', target_type: 'organization', details: { count: 3 } }, names()).values.count).toBe(3)
  })

  test('untyped rows read as the raw request', () => {
    const s = describeEntry({ id: 1, created_at: '', action: 'PUT /api/v1/courses/x', method: 'PUT', path: '/api/v1/courses/x' }, names())
    expect(s.key).toBe(KEY_PREFIX + 'generic.request')
    expect(s.values).toMatchObject({ method: 'PUT', path: '/api/v1/courses/x' })
  })

  test('untyped Atlas and AI app rows read as their action', () => {
    const s = describeEntry({ id: 1, created_at: '', action: 'Atlas: Update course', method: 'ATLAS' }, names())
    expect(s.key).toBe(KEY_PREFIX + 'generic.other')
    expect(s.values.event).toBe('Update course')
  })

  test('unknown typed actions fall back to a generic sentence', () => {
    expect(describeEntry({ id: 1, created_at: '', action: 'collection.created', category: 'content', target_type: 'collection' }, names()).key).toBe(KEY_PREFIX + 'generic.created')
    expect(describeEntry({ id: 1, created_at: '', action: 'collection.updated', category: 'content', target_type: 'collection', changes: { name: { from: 1, to: 2 } } }, names()).key).toBe(KEY_PREFIX + 'generic.changed_field')
    const other = describeEntry({ id: 1, created_at: '', action: 'ai.custom_thing', category: 'ai' }, names())
    expect(other.key).toBe(KEY_PREFIX + 'generic.other')
    expect(other.values.event).toBe('ai custom thing')
  })

  test('a missing target name falls back to the id, then a placeholder', () => {
    expect(describeEntry({ id: 1, created_at: '', action: 'course.deleted', category: 'content', target_id: 'course_1' }, names()).values.target).toBe('course_1')
    expect(describeEntry({ id: 1, created_at: '', action: 'course.deleted', category: 'content' }, names()).values.target).toBe('an item')
  })
})

describe('helpers', () => {
  test('formatValue', () => {
    expect(formatValue(null)).toBe('empty')
    expect(formatValue('', '—')).toBe('—')
    expect(formatValue(true)).toBe('on')
    expect(formatValue(3)).toBe('3')
    expect(formatValue(['a', 'b'])).toBe('a, b')
    expect(formatValue([{ a: 1 }])).toBe('1 items')
    expect(formatValue({ a: 1 })).toBe('{"a":1}')
    expect(formatValue('x'.repeat(200)).endsWith('…')).toBe(true)
  })

  test('humanizeField, initials, outcome, actor', () => {
    expect(humanizeField('customization.primary_color')).toBe('customization › primary color')
    expect(humanizeField('default_role_id')).toBe('default role')
    expect(initials('Maya Kite Base')).toBe('MB')
    expect(initials('  ')).toBe('?')
    expect(outcomeStatus('denied')).toBe('warning')
    expect(outcomeStatus('failed')).toBe('danger')
    expect(outcomeStatus(undefined)).toBe('success')
    const fb = { system: 'System', unknown: 'Someone' }
    expect(actorName({ actor_name: 'Maya' }, fb)).toBe('Maya')
    expect(actorName({ username: 'maya' }, fb)).toBe('maya')
    expect(actorName({ via: 'system' }, fb)).toBe('System')
    expect(actorName({ user_id: 3 }, fb)).toBe('Someone')
  })

  test('dateRangeBounds', () => {
    const now = new Date('2026-11-09T15:00:00')
    expect(dateRangeBounds('all', now)).toEqual({})
    expect(new Date(dateRangeBounds('today', now).start).getDate()).toBe(9)
    expect(new Date(dateRangeBounds('7d', now).start).getDate()).toBe(2)
  })

  test('every string has an English value and placeholders are balanced', () => {
    const strings = allStrings()
    expect(Object.keys(strings).length).toBeGreaterThan(Object.keys(UI_STRINGS).length)
    for (const [key, value] of Object.entries(strings)) {
      expect(key.startsWith(KEY_PREFIX)).toBe(true)
      expect(value.length).toBeGreaterThan(0)
      expect((value.match(/<b>/g) || []).length).toBe((value.match(/<\/b>/g) || []).length)
      expect((value.match(/\{\{/g) || []).length).toBe((value.match(/\}\}/g) || []).length)
    }
  })
})
