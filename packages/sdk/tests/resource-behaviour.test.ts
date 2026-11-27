// What the resources do beyond sending one request: branching on input,
// iterators, response unwrapping, 404 handling, uploads, retries and auth
// headers on the new account and learner methods.
import { describe, expect, it, vi } from 'vitest'
import { courseProgress, createClient, findCourseRun, isActivityCompleted, LearnHouseError, type Trail } from '../src'
import { appendFile } from '../src/core/upload'
import { json, mockFetch } from './helpers'

const BASE = 'http://api.test'
const make = (...responses: Parameters<typeof mockFetch>) => {
  const m = mockFetch(...responses)
  return { m, lh: createClient({ baseUrl: BASE, fetch: m.fetch, token: 'tok' }) }
}
const path = (url: string) => url.slice(BASE.length)

const trail = {
  id: 1,
  runs: [
    {
      course_id: 10,
      course: { course_uuid: 'course_abc', name: 'A' },
      course_total_steps: 4,
      steps: [{ activity_id: 1 }, { activity_id: 2 }, { activity_id: 2 }],
    },
    { course_id: 11, course: { course_uuid: 'course_empty' }, course_total_steps: 0, steps: [] },
    { course_id: 12, course: null, course_total_steps: 3, steps: [{ activity_id: 5 }, { activity_id: 6 }, { activity_id: 7 }, { activity_id: 8 }] },
  ],
} as unknown as Trail

describe('courseProgress()', () => {
  it('counts distinct completed activities against the course total', () => {
    expect(courseProgress(trail, 'course_abc')).toMatchObject({
      enrolled: true,
      completed: 2,
      total: 4,
      percent: 50,
      completedActivityIds: [1, 2],
    })
  })

  it('finds the run by numeric id, prefixed uuid or bare uuid', () => {
    expect(courseProgress(trail, 10).run).toBe(trail.runs[0])
    expect(courseProgress(trail, 'abc').run).toBe(trail.runs[0])
    expect(findCourseRun(trail, 'course_abc')).toBe(trail.runs[0])
  })

  it('reports not enrolled for an unknown course, an empty trail or no trail', () => {
    const empty = { enrolled: false, completed: 0, total: 0, percent: 0, completedActivityIds: [], run: null }
    expect(courseProgress(trail, 'course_nope')).toEqual(empty)
    expect(courseProgress(trail, 999)).toEqual(empty)
    expect(courseProgress({ runs: [] } as unknown as Trail, 10)).toEqual(empty)
    expect(courseProgress(null, 10)).toEqual(empty)
    expect(courseProgress(undefined, 'x')).toEqual(empty)
  })

  it('gives 0% when the total is unknown and caps at 100%', () => {
    expect(courseProgress(trail, 11)).toMatchObject({ enrolled: true, total: 0, percent: 0 })
    expect(courseProgress(trail, 12)).toMatchObject({ completed: 4, total: 3, percent: 100 })
  })

  it('rounds down, so a course only shows 100% when done', () => {
    const t = { runs: [{ course_id: 1, course_total_steps: 3, steps: [{ activity_id: 1 }, { activity_id: 2 }] }] } as unknown as Trail
    expect(courseProgress(t, 1).percent).toBe(66)
  })

  it('isActivityCompleted reads the same steps', () => {
    expect(isActivityCompleted(trail, 10, 2)).toBe(true)
    expect(isActivityCompleted(trail, 10, 3)).toBe(false)
    expect(isActivityCompleted(trail, 99, 1)).toBe(false)
  })

  it('trail.getCourseProgress fetches the org trail and computes', async () => {
    const { m, lh } = make(json(trail))
    const p = await lh.trail.getCourseProgress(7, 'course_abc')
    expect(path(m.calls[0].url)).toBe('/api/v1/trail/org/7/trail')
    expect(p).toMatchObject({ completed: 2, total: 4, percent: 50 })
  })
})

describe('auth', () => {
  it('signup with an invite code but no org rejects without a request', async () => {
    const { m, lh } = make(json({}))
    await expect(lh.auth.signup({ email: 'a@x.io', username: 'a', password: 'p', inviteCode: 'X' })).rejects.toThrow(TypeError)
    expect(m.calls).toHaveLength(0)
  })

  it.each([
    ['login', (lh: ReturnType<typeof createClient>) => lh.auth.login({ email: 'a', password: 'b' })],
    ['loginMfa', (lh: ReturnType<typeof createClient>) => lh.auth.loginMfa({ mfaToken: 'm', code: '1' })],
    ['signup', (lh: ReturnType<typeof createClient>) => lh.auth.signup({ email: 'a', username: 'u', password: 'p', orgId: 1 })],
    ['requestMagicLink', (lh: ReturnType<typeof createClient>) => lh.auth.requestMagicLink({ email: 'a' })],
    ['verifyMagicLink', (lh: ReturnType<typeof createClient>) => lh.auth.verifyMagicLink('t')],
    ['verifyEmail', (lh: ReturnType<typeof createClient>) => lh.auth.verifyEmail({ token: 't', userUuid: 'u', orgUuid: 'o' })],
    ['resendVerification', (lh: ReturnType<typeof createClient>) => lh.auth.resendVerification({ email: 'a' })],
    ['requestPasswordReset', (lh: ReturnType<typeof createClient>) => lh.auth.requestPasswordReset({ email: 'a' })],
    ['resetPassword', (lh: ReturnType<typeof createClient>) => lh.auth.resetPassword({ email: 'a', code: 'c', newPassword: 'n' })],
    ['loginWithOAuth', (lh: ReturnType<typeof createClient>) => lh.auth.loginWithOAuth({ provider: 'google', email: 'a', accessToken: 't' })],
  ])('%s never sends the getToken bearer (anonymous route)', async (_n, run) => {
    const m = mockFetch(json({}))
    const getToken = vi.fn(() => 'stale-access-token')
    const lh = createClient({ baseUrl: BASE, fetch: m.fetch, getToken })
    await run(lh)
    expect(m.calls[0].headers.has('authorization')).toBe(false)
    expect(getToken).not.toHaveBeenCalled()
  })

  it('MFA management sends the session bearer', async () => {
    const { m, lh } = make(json({ enabled: true, backup_codes: ['a'], tokens: {} }))
    await lh.auth.mfa.confirm('123456')
    expect(m.calls[0].headers.get('authorization')).toBe('Bearer tok')
  })

  it('verifyMagicLink passes a 410 (link spent) through as LearnHouseError', async () => {
    const { lh } = make(json({ detail: { code: 'MAGIC_LINK_INVALID', message: 'This login link is no longer valid.' } }, 410))
    const err = await lh.auth.verifyMagicLink('t').catch((e) => e)
    expect(err).toBeInstanceOf(LearnHouseError)
    expect(err.status).toBe(410)
    expect(err.code).toBe('MAGIC_LINK_INVALID')
  })

  it('a validation error from signup is VALIDATION_ERROR with a readable message', async () => {
    const { lh } = make(json({ detail: [{ loc: ['body', 'email'], msg: 'value is not a valid email address', type: 'value_error' }] }, 422))
    const err = await lh.auth.signup({ email: 'nope', username: 'u', password: 'p' }).catch((e) => e)
    expect(err.code).toBe('VALIDATION_ERROR')
    expect(err.message).toBe('body.email: value is not a valid email address')
  })
})

describe('certificates.verify', () => {
  it('resolves the certificate', async () => {
    const cert = { certificate_user: { user_certification_uuid: 'c1' } }
    const { lh } = make(json(cert))
    await expect(lh.certificates.verify('c1')).resolves.toEqual(cert)
  })

  it('resolves null for an unknown id (404)', async () => {
    const { lh } = make(json({ detail: 'Certificate not found' }, 404))
    await expect(lh.certificates.verify('nope')).resolves.toBeNull()
  })

  it('still throws other errors', async () => {
    const m = mockFetch(json({ detail: 'boom' }, 500))
    const lh = createClient({ baseUrl: BASE, fetch: m.fetch, retry: false })
    await expect(lh.certificates.verify('c1')).rejects.toMatchObject({ status: 500 })
  })

  it('works when destructured', async () => {
    const { lh } = make(json({ detail: 'x' }, 404))
    const { verify } = lh.certificates
    await expect(verify('nope')).resolves.toBeNull()
  })
})

describe('podcasts.count', () => {
  it('unwraps { count }', async () => {
    const { lh } = make(json({ count: 7 }))
    await expect(lh.podcasts.count('acme')).resolves.toBe(7)
  })
  it('accepts a bare number too', async () => {
    const { lh } = make(json(3))
    await expect(lh.podcasts.count('acme')).resolves.toBe(3)
  })
  it('treats a missing count as 0', async () => {
    const { lh } = make(json({}))
    await expect(lh.podcasts.count('acme')).resolves.toBe(0)
  })
})

describe('iterators', () => {
  it('notifications.listAll follows next_cursor and keeps the filters', async () => {
    const pages = [
      { items: [{ notification_uuid: 'a' }, { notification_uuid: 'b' }], next_cursor: '5' },
      { items: [{ notification_uuid: 'c' }], next_cursor: null },
    ]
    let i = 0
    const m = mockFetch(() => json(pages[i++]))
    const lh = createClient({ baseUrl: BASE, fetch: m.fetch })
    const seen: string[] = []
    for await (const n of lh.notifications.listAll({ unreadOnly: true, limit: 2 })) seen.push(n.notification_uuid)
    expect(seen).toEqual(['a', 'b', 'c'])
    expect(m.calls.map((c) => path(c.url))).toEqual([
      '/api/v1/notifications?unread_only=true&limit=2',
      '/api/v1/notifications?unread_only=true&cursor=5&limit=2',
    ])
  })

  it('notifications.listAll stops on an empty page even with a cursor', async () => {
    const m = mockFetch(json({ items: [], next_cursor: '9' }))
    const lh = createClient({ baseUrl: BASE, fetch: m.fetch })
    const all = []
    for await (const n of lh.notifications.listAll()) all.push(n)
    expect(all).toEqual([])
    expect(m.calls).toHaveLength(1)
  })

  it('notifications.listAll stops fetching when the consumer breaks', async () => {
    const m = mockFetch(json({ items: [{ notification_uuid: 'a' }, { notification_uuid: 'b' }], next_cursor: 'x' }))
    const lh = createClient({ baseUrl: BASE, fetch: m.fetch })
    for await (const _n of lh.notifications.listAll()) break
    expect(m.calls).toHaveLength(1)
  })

  it('communities.listAll pages until a short page', async () => {
    const full = Array.from({ length: 2 }, (_, k) => ({ community_uuid: `c${k}` }))
    let i = 0
    const m = mockFetch(() => json(i++ === 0 ? full : [{ community_uuid: 'last' }]))
    const lh = createClient({ baseUrl: BASE, fetch: m.fetch })
    const got = []
    for await (const c of lh.communities.listAll(3, { pageSize: 2 })) got.push(c.community_uuid)
    expect(got).toEqual(['c0', 'c1', 'last'])
    expect(m.calls.map((c) => path(c.url))).toEqual([
      '/api/v1/communities/org/3/page/1/limit/2',
      '/api/v1/communities/org/3/page/2/limit/2',
    ])
  })

  it('podcasts.listAll pages until an empty page and forwards includeUnpublished', async () => {
    let i = 0
    const m = mockFetch(() => json(i++ === 0 ? [{ podcast_uuid: 'p1' }] : []))
    const lh = createClient({ baseUrl: BASE, fetch: m.fetch })
    const got = []
    for await (const p of lh.podcasts.listAll('acme', { pageSize: 1, includeUnpublished: true })) got.push(p.podcast_uuid)
    expect(got).toEqual(['p1'])
    expect(m.calls.map((c) => path(c.url))).toEqual([
      '/api/v1/podcasts/org_slug/acme/page/1/limit/1?include_unpublished=true',
      '/api/v1/podcasts/org_slug/acme/page/2/limit/1?include_unpublished=true',
    ])
  })

  it('an aborted signal stops listAll between pages', async () => {
    const ac = new AbortController()
    const m = mockFetch(() => {
      ac.abort()
      return json([{ community_uuid: 'a' }, { community_uuid: 'b' }])
    })
    const lh = createClient({ baseUrl: BASE, fetch: m.fetch })
    const it = lh.communities.listAll(1, { pageSize: 2, signal: ac.signal })
    await expect((async () => {
      for await (const _c of it) {
        // keep going
      }
    })()).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('uploads', () => {
  it('a File keeps its own name', async () => {
    const { m, lh } = make(json({}))
    const f = new File(['x'], 'me.jpg', { type: 'image/jpeg' })
    await lh.users.updateAvatar(1, f)
    expect(((m.calls[0].body as FormData).get('avatar_file') as File).name).toBe('me.jpg')
  })

  it('a bare Blob gets the filename option', async () => {
    const { m, lh } = make(json({ file_uuid: 'f' }))
    const out = await lh.assignments.uploadTaskFile('assignment_1', 'task_1', new Blob(['x']), { filename: 'essay.pdf' })
    expect(out).toEqual({ file_uuid: 'f' })
    expect(((m.calls[0].body as FormData).get('sub_file') as File).name).toBe('essay.pdf')
  })

  it("passes React Native's { uri, name, type } object to FormData as-is", () => {
    const append = vi.fn()
    const rn = { uri: 'file:///tmp/a.png', name: 'a.png', type: 'image/png' }
    appendFile({ append } as unknown as FormData, 'avatar_file', rn, 'fallback.png')
    expect(append).toHaveBeenCalledWith('avatar_file', rn)
  })

  it('a Blob gets the fallback name and a File is appended without one', () => {
    const append = vi.fn()
    const blob = new Blob(['x'])
    appendFile({ append } as unknown as FormData, 'f', blob, 'fallback.bin')
    expect(append).toHaveBeenLastCalledWith('f', blob, 'fallback.bin')
    const file = new File(['x'], 'named.txt')
    appendFile({ append } as unknown as FormData, 'f', file, 'fallback.bin')
    expect(append).toHaveBeenLastCalledWith('f', file)
  })

  it('a rate-limited upload (429 + Retry-After) is retried once the server allows it', async () => {
    const m = mockFetch(json({ detail: { code: 'RATE_LIMITED', retry_after: 0 } }, 429, { 'retry-after': '0' }), json({ file_uuid: 'ok' }))
    const lh = createClient({ baseUrl: BASE, fetch: m.fetch, token: 't' })
    await expect(lh.assignments.uploadTaskFile('a', 't', new Blob(['x']))).resolves.toEqual({ file_uuid: 'ok' })
    expect(m.calls).toHaveLength(2)
  })
})

describe('retries on the new resources', () => {
  it('a GET (notifications.list) is retried after a 503', async () => {
    const m = mockFetch(json({ detail: 'down' }, 503), json({ items: [], next_cursor: null }))
    const lh = createClient({ baseUrl: BASE, fetch: m.fetch, retry: { retries: 1, baseDelayMs: 1 } })
    await expect(lh.notifications.list()).resolves.toEqual({ items: [], next_cursor: null })
    expect(m.calls).toHaveLength(2)
  })

  it('a write (assignments.submit) is not retried after a 503', async () => {
    const m = mockFetch(json({ detail: 'down' }, 503), json({}))
    const lh = createClient({ baseUrl: BASE, fetch: m.fetch, retry: { retries: 3, baseDelayMs: 1 } })
    await expect(lh.assignments.submit('a')).rejects.toMatchObject({ status: 503 })
    expect(m.calls).toHaveLength(1)
  })

  it('a write refused with 429 is retried (the server did nothing)', async () => {
    const m = mockFetch(json({ detail: 'slow down' }, 429, { 'retry-after': '0' }), json({ id: 1 }))
    const lh = createClient({ baseUrl: BASE, fetch: m.fetch })
    await expect(lh.discussions.reply('d', 'hi')).resolves.toEqual({ id: 1 })
    expect(m.calls).toHaveLength(2)
    expect(JSON.parse(m.calls[1].body as string)).toEqual({ content: 'hi' })
  })

  it('a 429 asking for longer than maxDelayMs throws with retryAfterMs', async () => {
    const m = mockFetch(json({ detail: 'later' }, 429, { 'retry-after': '120' }))
    const lh = createClient({ baseUrl: BASE, fetch: m.fetch })
    const err = await lh.admin.enrollments.bulkEnroll('acme', 'course_1', [1]).catch((e) => e)
    expect(err.status).toBe(429)
    expect(err.retryAfterMs).toBe(120_000)
    expect(m.calls).toHaveLength(1)
  })

  it('auth.refresh is never retried, even on a 503', async () => {
    const m = mockFetch(json({ detail: 'down' }, 503), json({}))
    const lh = createClient({ baseUrl: BASE, fetch: m.fetch, retry: 5 })
    await expect(lh.auth.refresh({ refreshToken: 'r' })).rejects.toMatchObject({ status: 503 })
    expect(m.calls).toHaveLength(1)
  })
})

describe('admin', () => {
  it('a user session is refused with the API error passed through', async () => {
    const { lh } = make(json({ detail: 'This endpoint requires API token authentication' }, 403))
    const err = await lh.admin.users.getByEmail('acme', 'a@x.io').catch((e) => e)
    expect(err).toBeInstanceOf(LearnHouseError)
    expect(err.status).toBe(403)
    expect(err.path).toBe('/api/v1/admin/{org_slug}/users/by-email/{email}')
  })

  it('magicLink leaves out the fields not given', async () => {
    const { m, lh } = make(json({ url: 'u', token: 't', expires_at: 1 }))
    await lh.admin.auth.magicLink('acme', { userId: 5 })
    expect(JSON.parse(m.calls[0].body as string)).toEqual({ user_id: 5 })
  })

  it('an org slug with reserved characters is encoded as one path segment', async () => {
    const { m, lh } = make(json([]))
    await lh.admin.progress.listForUser('a/b', 1)
    expect(path(m.calls[0].url)).toBe('/api/v1/admin/a%2Fb/progress/1')
  })
})

describe('path safety on the new resources', () => {
  it.each([
    ['..', '/api/v1/discussions/%2E%2E'],
    ['.', '/api/v1/discussions/%2E'],
    ['a/../b', '/api/v1/discussions/a%2F..%2Fb'],
  ])('discussion id %j cannot leave its segment', async (id, expected) => {
    const { m, lh } = make(json({}))
    await lh.discussions.get(id)
    expect(path(m.calls[0].url)).toBe(expected)
  })

  it('an empty id is refused before any request', async () => {
    const { m, lh } = make(json({}))
    await expect(lh.assignments.get('')).rejects.toThrow(TypeError)
    expect(m.calls).toHaveLength(0)
  })
})
