import { describe, expect, test } from 'bun:test'

import {
  DEFAULT_DRIP_RULE,
  MAX_DELAY_DAYS,
  everyInterval,
  fromLocalInput,
  normalizeRule,
  releaseDate,
  timeUntil,
  toLocalInput,
} from '../lib/drip.ts'

const DAY = 24 * 60 * 60 * 1000

describe('normalizeRule', () => {
  test('fills in the defaults', () => {
    expect(normalizeRule(null)).toEqual(DEFAULT_DRIP_RULE)
    expect(normalizeRule({ mode: 'delay', delay_days: 3 })).toEqual({
      ...DEFAULT_DRIP_RULE,
      mode: 'delay',
      delay_days: 3,
    })
  })
})

describe('everyInterval', () => {
  const rules = [0, 1, 2, 3].map(() => ({ ...DEFAULT_DRIP_RULE }))

  test('one chapter a week, first one right away', () => {
    const out = everyInterval(rules, 1, 'weeks')
    expect(out.map((r) => r.mode)).toEqual(['immediate', 'delay', 'delay', 'delay'])
    expect(out.map((r) => r.delay_days)).toEqual([0, 7, 14, 21])
  })

  test('keeps "require previous" and clears fixed dates', () => {
    const input = rules.map((r, i) => ({ ...r, require_previous: i === 2, mode: 'date', release_at: '2026-01-01T00:00:00Z' }))
    const out = everyInterval(input, 3, 'days')
    expect(out[2].require_previous).toBe(true)
    expect(out.every((r) => r.release_at === null)).toBe(true)
    expect(out.map((r) => r.delay_days)).toEqual([0, 3, 6, 9])
  })

  test('clamps bad input', () => {
    expect(everyInterval(rules, 0, 'days').map((r) => r.delay_days)).toEqual([0, 1, 2, 3])
    const many = Array.from({ length: 30 }, () => ({ ...DEFAULT_DRIP_RULE }))
    expect(Math.max(...everyInterval(many, 52, 'weeks').map((r) => r.delay_days))).toBe(MAX_DELAY_DAYS)
  })
})

describe('releaseDate', () => {
  const anchor = new Date('2026-11-02T10:00:00Z')

  test('immediate and delay follow the anchor', () => {
    expect(releaseDate({ ...DEFAULT_DRIP_RULE }, anchor)).toEqual(anchor)
    expect(releaseDate({ ...DEFAULT_DRIP_RULE, mode: 'delay', delay_days: 7 }, anchor)).toEqual(
      new Date(anchor.getTime() + 7 * DAY)
    )
  })

  test('no anchor means no date, except for fixed dates', () => {
    expect(releaseDate({ ...DEFAULT_DRIP_RULE, mode: 'delay', delay_days: 7 }, null)).toBeNull()
    expect(releaseDate({ ...DEFAULT_DRIP_RULE, mode: 'date', release_at: '2026-12-01T09:00:00Z' }, null)).toEqual(
      new Date('2026-12-01T09:00:00Z')
    )
    expect(releaseDate({ ...DEFAULT_DRIP_RULE, mode: 'date', release_at: null }, anchor)).toBeNull()
  })
})

describe('timeUntil', () => {
  const now = new Date('2026-11-02T10:00:00Z')

  test('days and hours', () => {
    expect(timeUntil(new Date(now.getTime() + 2 * DAY + 5 * 3600 * 1000), now)).toEqual({ days: 2, hours: 5 })
  })

  test('never negative', () => {
    expect(timeUntil(new Date(now.getTime() - DAY), now)).toEqual({ days: 0, hours: 0 })
  })
})

describe('datetime-local round trip', () => {
  test('converts both ways', () => {
    const iso = '2026-11-09T08:30:00.000Z'
    expect(fromLocalInput(toLocalInput(iso))).toBe(iso)
  })

  test('empty and invalid values', () => {
    expect(toLocalInput(null)).toBe('')
    expect(toLocalInput('nope')).toBe('')
    expect(fromLocalInput('')).toBeNull()
    expect(fromLocalInput('nope')).toBeNull()
  })
})
