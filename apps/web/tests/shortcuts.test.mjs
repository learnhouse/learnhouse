import { describe, expect, test } from 'bun:test'

import {
  SequenceMatcher,
  isIgnoredTarget,
  parseBinding,
  tokenFromEvent,
} from '../lib/shortcuts/matcher.ts'

const bindings = [
  { id: 'help', keys: '?' },
  { id: 'next', keys: 'j' },
  { id: 'courses', keys: 'g c' },
  { id: 'home', keys: 'g h' },
]

describe('tokens', () => {
  test('letters are lowercased, modifiers disqualify', () => {
    expect(tokenFromEvent({ key: 'J' })).toBe('j')
    expect(tokenFromEvent({ key: '?' })).toBe('?')
    expect(tokenFromEvent({ key: 'k', metaKey: true })).toBeNull()
    expect(tokenFromEvent({ key: 'k', ctrlKey: true })).toBeNull()
    expect(tokenFromEvent({ key: 'Shift' })).toBeNull()
    expect(tokenFromEvent({ key: 'Escape' })).toBe('escape')
  })

  test('bindings split into tokens', () => {
    expect(parseBinding(' G  c ')).toEqual(['g', 'c'])
  })
})

describe('sequence matcher', () => {
  const make = () => new SequenceMatcher(() => bindings, 900)

  test('single key fires at once', () => {
    const m = make()
    expect(m.feed('j', 0).fired?.id).toBe('next')
    expect(m.feed('?', 10).fired?.id).toBe('help')
  })

  test('chord waits for its second key', () => {
    const m = make()
    const first = m.feed('g', 0)
    expect(first.fired).toBeNull()
    expect(first.pending).toBe(true)
    expect(m.feed('c', 200).fired?.id).toBe('courses')
  })

  test('chord times out', () => {
    const m = make()
    m.feed('g', 0)
    const late = m.feed('c', 2000)
    expect(late.fired).toBeNull()
    expect(late.pending).toBe(false)
  })

  test('a broken chord does not swallow the next shortcut', () => {
    const m = make()
    m.feed('g', 0)
    expect(m.feed('j', 100).fired?.id).toBe('next')
  })

  test('unknown keys reset the buffer', () => {
    const m = make()
    m.feed('g', 0)
    expect(m.feed('x', 50).fired).toBeNull()
    expect(m.feed('c', 100).fired).toBeNull()
  })

  test('bindings are read live', () => {
    let live = [...bindings]
    const m = new SequenceMatcher(() => live, 900)
    live = live.filter((b) => b.id !== 'next')
    expect(m.feed('j', 0).fired).toBeNull()
  })
})

describe('ignored targets', () => {
  test('typing surfaces are ignored', () => {
    expect(isIgnoredTarget({ tagName: 'INPUT' })).toBe(true)
    expect(isIgnoredTarget({ tagName: 'textarea' })).toBe(true)
    expect(isIgnoredTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true)
  })

  test('opted-out ancestors are ignored, plain elements are not', () => {
    expect(isIgnoredTarget({ tagName: 'DIV', matchesAncestor: () => true })).toBe(true)
    expect(isIgnoredTarget({ tagName: 'BODY', matchesAncestor: () => false })).toBe(false)
    expect(isIgnoredTarget(null)).toBe(false)
  })
})

describe('aliases and activation keys', () => {
  test('aliases expand into extra bindings for the same action', () => {
    const { expandBindings } = require('../lib/shortcuts/matcher.ts')
    expect(expandBindings([{ id: 'next', keys: 'j', aliases: ['arrowdown'] }, { id: 'help', keys: '?' }])).toEqual([
      { id: 'next', keys: 'j' },
      { id: 'next', keys: 'arrowdown' },
      { id: 'help', keys: '?' },
    ])
  })

  test('space and enter on a button or link belong to that control', () => {
    const { isActivationKeyOnControl } = require('../lib/shortcuts/matcher.ts')
    expect(isActivationKeyOnControl('space', { tagName: 'BUTTON' })).toBe(true)
    expect(isActivationKeyOnControl('enter', { tagName: 'a' })).toBe(true)
    expect(isActivationKeyOnControl('enter', { tagName: 'DIV', role: 'button' })).toBe(true)
    expect(isActivationKeyOnControl('j', { tagName: 'BUTTON' })).toBe(false)
    expect(isActivationKeyOnControl('space', { tagName: 'BODY' })).toBe(false)
    expect(isActivationKeyOnControl('space', null)).toBe(false)
  })
})

describe('list navigation index', () => {
  const { nextIndex } = require('../lib/shortcuts/listNavigation.ts')
  test('enters the list from either end and clamps', () => {
    expect(nextIndex(-1, 1, 3)).toBe(0)
    expect(nextIndex(-1, -1, 3)).toBe(2)
    expect(nextIndex(2, 1, 3)).toBe(2)
    expect(nextIndex(0, -1, 3)).toBe(0)
    expect(nextIndex(1, 1, 3)).toBe(2)
    expect(nextIndex(0, 1, 0)).toBe(-1)
  })
})
