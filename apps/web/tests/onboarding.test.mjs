import { describe, expect, test } from 'bun:test'

import { applySignals, pendingCelebrations, stepsDoneFromData, summarize } from '../lib/onboarding.ts'

const fresh = () => ({ completedSteps: [], skippedSteps: [], celebrated: [], seeded: false, intent: 'sell' })

describe('applySignals', () => {
  test('the first read completes existing work silently', () => {
    const next = applySignals(fresh(), ['create_course', 'brand_school'])
    expect(next.seeded).toBe(true)
    expect(next.completedSteps).toEqual(['create_course', 'brand_school'])
    expect(pendingCelebrations(next)).toEqual([])
    // Other fields ride along untouched.
    expect(next.intent).toBe('sell')
  })

  test('the first read seeds even when nothing is done yet', () => {
    const next = applySignals(fresh(), [])
    expect(next.seeded).toBe(true)
    expect(next.completedSteps).toEqual([])
  })

  test('later completions are left to celebrate', () => {
    const seeded = applySignals(fresh(), ['create_course'])
    const next = applySignals(seeded, ['create_course', 'add_content'])
    expect(next.completedSteps).toEqual(['create_course', 'add_content'])
    expect(pendingCelebrations(next)).toEqual(['add_content'])
  })

  test('returns the same object when nothing changed', () => {
    const seeded = applySignals(fresh(), ['create_course'])
    expect(applySignals(seeded, ['create_course'])).toBe(seeded)
  })
})

describe('pendingCelebrations', () => {
  test('skipped steps are never celebrated', () => {
    const state = { ...fresh(), seeded: true, completedSteps: ['create_course'], skippedSteps: ['create_course'] }
    expect(pendingCelebrations(state)).toEqual([])
  })
})

describe('summarize', () => {
  const steps = [
    { completed: true, minutes: 2 },
    { completed: false, minutes: 5 },
    { completed: false, minutes: 2 },
  ]

  test('points at the first open step and adds up the time left', () => {
    expect(summarize(steps)).toEqual({ currentStepIndex: 1, allCompleted: false, progress: 1 / 3, minutesLeft: 7 })
  })

  test('all done', () => {
    const done = steps.map((s) => ({ ...s, completed: true }))
    expect(summarize(done)).toEqual({ currentStepIndex: -1, allCompleted: true, progress: 1, minutesLeft: 0 })
  })

  test('no steps', () => {
    expect(summarize([]).progress).toBe(0)
  })
})

describe('stepsDoneFromData', () => {
  const none = { courseCount: 0, hasLesson: false, hasLogo: false, memberCount: 1, inviteCount: 0, communityCount: 0 }

  test('a new org has nothing done', () => {
    expect(stepsDoneFromData(none)).toEqual([])
  })

  test('each signal maps to its step', () => {
    expect(stepsDoneFromData({ ...none, courseCount: 1 })).toEqual(['create_course'])
    expect(stepsDoneFromData({ ...none, hasLesson: true })).toEqual(['add_content'])
    expect(stepsDoneFromData({ ...none, hasLogo: true })).toEqual(['brand_school'])
    expect(stepsDoneFromData({ ...none, communityCount: 2 })).toEqual(['build_community'])
  })

  test('the admin alone is not a learner; another member or an invite is', () => {
    expect(stepsDoneFromData({ ...none, memberCount: 1 })).toEqual([])
    expect(stepsDoneFromData({ ...none, memberCount: 2 })).toEqual(['invite_learners'])
    expect(stepsDoneFromData({ ...none, inviteCount: 1 })).toEqual(['invite_learners'])
  })
})

describe('extractEmails', () => {
  test('finds every address once, lower-cased, in order', async () => {
    const { extractEmails } = await import('../lib/onboarding.ts')
    const csv = 'name,email\nAda,Ada@Example.com\nBob,bob@example.org\n"Ada again",ada@example.com\nnot-an-email,x'
    expect(extractEmails(csv)).toEqual(['ada@example.com', 'bob@example.org'])
    expect(extractEmails('a@b.co, c@d.io\ne@f.dev')).toEqual(['a@b.co', 'c@d.io', 'e@f.dev'])
    expect(extractEmails('')).toEqual([])
  })
})

describe('daysUntil', () => {
  test('rounds up, never below zero, null when unknown', async () => {
    const { daysUntil } = await import('../lib/onboarding.ts')
    const now = Date.parse('2026-11-14T00:00:00Z')
    expect(daysUntil('2026-11-16T12:00:00Z', now)).toBe(3)
    expect(daysUntil('2026-11-01T00:00:00Z', now)).toBe(0)
    expect(daysUntil(null, now)).toBe(null)
    expect(daysUntil('nope', now)).toBe(null)
  })
})
