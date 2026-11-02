import { describe, expect, test } from 'bun:test'

import {
  DEFAULT_DRIP_RULE,
  MAX_DELAY_DAYS,
  buildIcs,
  everyInterval,
  fromLocalInput,
  normalizeRule,
  previewHorizon,
  releaseDate,
  stateOnDay,
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

describe('stateOnDay', () => {
  const rule = (extra) => ({ ...DEFAULT_DRIP_RULE, ...extra })

  test('opens on its day and closes after its window', () => {
    const r = rule({ mode: 'delay', delay_days: 7, available_days: 3 })
    expect(stateOnDay(r, 6)).toBe('upcoming')
    expect(stateOnDay(r, 7)).toBe('open')
    expect(stateOnDay(r, 9)).toBe('open')
    expect(stateOnDay(r, 10)).toBe('closed')
  })

  test('immediate is open from day 0, fixed dates are off the day line', () => {
    expect(stateOnDay(rule({}), 0)).toBe('open')
    expect(stateOnDay(rule({ mode: 'date', release_at: '2026-12-01T00:00:00Z' }), 3)).toBe('dated')
  })
})

describe('previewHorizon', () => {
  test('covers the last opening or closing plus a week, at least three weeks', () => {
    expect(previewHorizon([{ ...DEFAULT_DRIP_RULE }])).toBe(21)
    expect(previewHorizon([{ ...DEFAULT_DRIP_RULE, mode: 'delay', delay_days: 28, available_days: 7 }])).toBe(42)
    expect(previewHorizon([{ ...DEFAULT_DRIP_RULE, mode: 'delay', delay_days: MAX_DELAY_DAYS }])).toBe(MAX_DELAY_DAYS)
  })
})

describe('buildIcs', () => {
  const now = new Date('2026-11-02T10:00:00Z')

  test('one event per release, escaped and CRLF-terminated', () => {
    const ics = buildIcs('Seller; Bootcamp', [
      { uid: 'chapter_3', title: 'Week 3, payments', start: new Date('2026-11-07T09:30:00Z'), url: 'https://a.test/course/x' },
      { uid: 'chapter_4', title: 'Week 4', start: new Date('2026-11-14T09:30:00Z') },
    ], now)
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true)
    expect(ics).toContain('X-WR-CALNAME:Seller\\; Bootcamp')
    expect(ics).toContain('SUMMARY:Week 3\\, payments')
    expect(ics).toContain('DTSTART:20261107T093000Z')
    expect(ics).toContain('DTEND:20261107T100000Z')
    expect(ics).toContain('DTSTAMP:20261102T100000Z')
    expect(ics).toContain('UID:chapter_3@learnhouse')
    expect(ics).toContain('URL:https://a.test/course/x')
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2)
  })
})
