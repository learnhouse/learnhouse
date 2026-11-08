import { describe, expect, it } from 'vitest'
import { createClient, LearnHouseError, type CourseMeta } from '../src'
import { json, mockFetch } from './helpers'

const BASE = 'http://api.test'
const activity = { activity_uuid: 'activity_payouts', name: 'How payouts work', content: { type: 'doc' } }
const meta = {
  course_uuid: 'course_abc',
  chapters: [
    { name: 'Empty', activities: [{ activity_uuid: 'activity_unnamed' }] },
    { name: 'No list' },
    { name: 'Basics', activities: [{ name: 'How payouts work!', activity_uuid: 'activity_payouts' }] },
  ],
} as unknown as CourseMeta

/** Answers by path so call order does not matter. */
function api(routes: Record<string, unknown>) {
  const m = mockFetch((call) => {
    const path = call.url.slice(BASE.length).split('?')[0]
    return path in routes ? json(routes[path]) : json({ detail: 'Not found' }, 404)
  })
  const client = createClient({ baseUrl: BASE, fetch: m.fetch, retry: false })
  const urls = () => m.calls.map((c) => c.url.slice(BASE.length))
  return { client, m, urls }
}

describe('activities.resolve', () => {
  it('loads a prefixed id directly', async () => {
    const { client, urls } = api({ '/api/v1/activities/activity_payouts': activity })
    expect(await client.activities.resolve({ activityId: 'activity_payouts' })).toEqual(activity)
    expect(urls()).toEqual(['/api/v1/activities/activity_payouts'])
  })

  it('adds the prefix to a bare id from a site URL', async () => {
    const { client, urls } = api({ '/api/v1/activities/activity_payouts': activity })
    await client.activities.resolve({ activityId: 'payouts', courseId: 'abc' })
    expect(urls()).toEqual(['/api/v1/activities/activity_payouts'])
  })

  it('finds a name in the course meta, ignoring case and punctuation', async () => {
    const { client, urls } = api({
      '/api/v1/courses/course_abc/meta': meta,
      '/api/v1/activities/activity_payouts': activity,
    })
    const { resolve } = client.activities // still works destructured
    expect(await resolve({ courseId: 'abc', activityName: '  how payouts WORK ' })).toEqual(activity)
    expect(urls()).toEqual(['/api/v1/courses/course_abc/meta?slim=true', '/api/v1/activities/activity_payouts'])
  })

  it('reuses a course meta you pass, or one still loading', async () => {
    const { client, urls } = api({ '/api/v1/activities/activity_payouts': activity })
    await client.activities.resolve({ courseId: 'course_abc', activityName: 'How payouts work!' }, { courseMeta: meta })
    await client.activities.resolve(
      { courseId: 'course_abc', activityName: 'how-payouts-work' },
      { courseMeta: Promise.resolve(meta) },
    )
    expect(urls()).toEqual(['/api/v1/activities/activity_payouts', '/api/v1/activities/activity_payouts'])
  })

  it('throws ACTIVITY_NOT_FOUND for an unknown name', async () => {
    const { client, urls } = api({ '/api/v1/courses/course_abc/meta': meta })
    const err = (await client.activities
      .resolve({ courseId: 'course_abc', activityName: 'Refunds' })
      .catch((e: unknown) => e)) as LearnHouseError
    expect(err).toBeInstanceOf(LearnHouseError)
    expect(err).toMatchObject({
      status: 404,
      code: 'ACTIVITY_NOT_FOUND',
      message: 'No activity named "Refunds" in this course',
      path: '/api/v1/courses/{course_uuid}/meta',
      url: '/api/v1/courses/course_abc/meta',
    })
    expect(urls()).toHaveLength(1)
    const noChapters = {} as CourseMeta
    await expect(
      client.activities.resolve({ courseId: 'course_abc', activityName: 'x' }, { courseMeta: noChapters }),
    ).rejects.toMatchObject({ code: 'ACTIVITY_NOT_FOUND' })
  })

  it('passes request options through and surfaces API errors', async () => {
    const { client, m } = api({})
    const ac = new AbortController()
    await expect(
      client.activities.resolve({ activityId: 'activity_gone' }, { signal: ac.signal, headers: { 'X-Test': '1' } }),
    ).rejects.toMatchObject({ status: 404 })
    expect(m.calls[0].headers.get('x-test')).toBe('1')
    await expect(client.activities.resolve({ courseId: 'missing', activityName: 'x' })).rejects.toMatchObject({
      status: 404,
      url: `${BASE}/api/v1/courses/course_missing/meta?slim=true`,
    })
  })

  it('needs an id, or a name with a course', async () => {
    const { client, m } = api({})
    await expect(client.activities.resolve({} as never)).rejects.toThrow(TypeError)
    await expect(client.activities.resolve({ activityName: 'x' } as never)).rejects.toThrow(TypeError)
    expect(m.calls).toHaveLength(0)
  })
})
