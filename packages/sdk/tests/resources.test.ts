import { describe, expect, it } from 'vitest'
import { createClient } from '../src'
import { json, mockFetch } from './helpers'

const BASE = 'http://api.test'

function setup(body: unknown = {}) {
  const m = mockFetch(json(body))
  const client = createClient({ baseUrl: BASE, fetch: m.fetch, token: 'lh_t' })
  const last = () => {
    const c = m.calls[m.calls.length - 1]
    return `${c.method} ${c.url.slice(BASE.length)}`
  }
  return { client, m, last }
}

describe('resource methods hit the real endpoints', () => {
  it.each([
    ['orgs.get', (c: ReturnType<typeof createClient>) => c.orgs.get('acme'), 'GET /api/v1/orgs/slug/acme'],
    ['orgs.getByUuid', (c) => c.orgs.getByUuid('org_1'), 'GET /api/v1/orgs/uuid/org_1'],
    ['courses.list (defaults)', (c) => c.courses.list('acme'), 'GET /api/v1/courses/org_slug/acme/page/1/limit/20'],
    [
      'courses.list (unpublished)',
      (c) => c.courses.list('acme', { page: 3, limit: 10, includeUnpublished: true }),
      'GET /api/v1/courses/org_slug/acme/page/3/limit/10?include_unpublished=true',
    ],
    ['courses.count', (c) => c.courses.count('acme'), 'GET /api/v1/courses/org_slug/acme/count'],
    ['courses.get', (c) => c.courses.get('course_1'), 'GET /api/v1/courses/course_1'],
    ['courses.getMeta', (c) => c.courses.getMeta('course_1'), 'GET /api/v1/courses/course_1/meta'],
    [
      'courses.getMeta (slim)',
      (c) => c.courses.getMeta('course_1', { slim: true, withUnpublishedActivities: false }),
      'GET /api/v1/courses/course_1/meta?slim=true&with_unpublished_activities=false',
    ],
    ['chapters.get', (c) => c.chapters.get(42), 'GET /api/v1/chapters/42'],
    ['activities.get', (c) => c.activities.get('activity_1'), 'GET /api/v1/activities/activity_1'],
    ['activities.listForChapter', (c) => c.activities.listForChapter(7), 'GET /api/v1/activities/chapter/7'],
    [
      'search.org',
      (c) => c.search.org('acme', 'react hooks', { page: 2, limit: 5 }),
      'GET /api/v1/search/org_slug/acme?query=react%20hooks&page=2&limit=5',
    ],
    ['trail.get', (c) => c.trail.get(), 'GET /api/v1/trail/'],
    ['trail.getForOrg', (c) => c.trail.getForOrg(1), 'GET /api/v1/trail/org/1/trail'],
    ['trail.startCourse', (c) => c.trail.startCourse('course_1'), 'POST /api/v1/trail/add_course/course_1'],
    ['trail.leaveCourse', (c) => c.trail.leaveCourse('course_1'), 'DELETE /api/v1/trail/remove_course/course_1'],
    [
      'trail.completeActivity',
      (c) => c.trail.completeActivity('activity_1'),
      'POST /api/v1/trail/add_activity/activity_1',
    ],
    [
      'trail.uncompleteActivity',
      (c) => c.trail.uncompleteActivity('activity_1'),
      'DELETE /api/v1/trail/remove_activity/activity_1',
    ],
    ['users.session', (c) => c.users.session(), 'GET /api/v1/users/session'],
    ['users.getByUuid', (c) => c.users.getByUuid('user_1'), 'GET /api/v1/users/uuid/user_1'],
    ['auth.me', (c) => c.auth.me(), 'GET /api/v1/auth/me'],
    ['auth.logout', (c) => c.auth.logout(), 'DELETE /api/v1/auth/logout'],
    ['auth.refresh', (c) => c.auth.refresh(), 'GET /api/v1/auth/refresh'],
  ] as Array<[string, (c: ReturnType<typeof createClient>) => Promise<unknown>, string]>)(
    '%s',
    async (_name, call, expected) => {
      const { client, last } = setup()
      await call(client)
      expect(last()).toBe(expected)
    },
  )

  it('chapters.listForCourse returns the chapters of the slim course meta', async () => {
    const { client, last } = setup({ chapters: [{ id: 1 }, { id: 2 }] })
    const chapters = await client.chapters.listForCourse('course_1')
    expect(last()).toBe('GET /api/v1/courses/course_1/meta?slim=true')
    expect(chapters).toEqual([{ id: 1 }, { id: 2 }])
  })
})

describe('auth', () => {
  it('login posts a form body without any bearer token', async () => {
    const result = { user: { id: 1 }, tokens: { access_token: 'a', refresh_token: 'r', expiry: 1 } }
    const { client, m, last } = setup(result)
    const out = await client.auth.login({ email: 'me@x.io', password: 'p&ss word', orgSlug: 'acme' })
    expect(out).toEqual(result)
    expect(last()).toBe('POST /api/v1/auth/login')
    const call = m.calls[0]
    expect(call.headers.get('content-type')).toBe('application/x-www-form-urlencoded')
    expect(call.headers.has('authorization')).toBe(false)
    expect(call.body).toBe('username=me%40x.io&password=p%26ss%20word&org_slug=acme')
  })

  it('login omits org_slug when not given', async () => {
    const { client, m } = setup({})
    await client.auth.login({ email: 'me@x.io', password: 'p' })
    expect(m.calls[0].body).toBe('username=me%40x.io&password=p')
  })

  it('loginMfa posts JSON', async () => {
    const { client, m, last } = setup({})
    await client.auth.loginMfa({ mfaToken: 'mt', code: '123456' })
    expect(last()).toBe('POST /api/v1/auth/login/mfa')
    expect(JSON.parse(m.calls[0].body as string)).toEqual({ mfa_token: 'mt', code: '123456', is_backup_code: false })
  })

  it('refresh sends a stored refresh token as the LH_refresh cookie', async () => {
    const { client, m } = setup({ access_token: 'a2', refresh_token: 'r2', expiry: 5 })
    const tokens = await client.auth.refresh({ refreshToken: 'r1' })
    expect(tokens.refresh_token).toBe('r2')
    expect(m.calls[0].headers.get('cookie')).toBe('LH_refresh=r1')
    expect(m.calls[0].headers.has('authorization')).toBe(false)
  })
})
