import { afterEach, describe, expect, it, vi } from 'vitest'
import { createClient, isLearnHouseError, LearnHouseError } from '../src'
import { buildPath, joinUrl, serializeQuery } from '../src/core/http'
import { hangingFetch, json, mockFetch } from './helpers'

const BASE = 'https://api.example.test'

afterEach(() => {
  vi.useRealTimers()
})

describe('auth headers', () => {
  it('sends a static API token as a bearer token', async () => {
    const m = mockFetch(json({}))
    const client = createClient({ baseUrl: BASE, token: 'lh_abc123', fetch: m.fetch })
    await client.GET('/api/v1/users/session')
    expect(m.calls[0].headers.get('authorization')).toBe('Bearer lh_abc123')
    expect(m.calls[0].headers.get('accept')).toBe('application/json')
  })

  it('asks getToken on every request', async () => {
    const m = mockFetch(json({}))
    let n = 0
    const getToken = vi.fn(async () => `jwt-${++n}`)
    const client = createClient({ baseUrl: BASE, getToken, fetch: m.fetch })
    await client.GET('/api/v1/users/session')
    await client.GET('/api/v1/users/session')
    expect(getToken).toHaveBeenCalledTimes(2)
    expect(m.calls.map((c) => c.headers.get('authorization'))).toEqual(['Bearer jwt-1', 'Bearer jwt-2'])
  })

  it('sends no Authorization when getToken returns nothing', async () => {
    const m = mockFetch(json({}))
    const client = createClient({ baseUrl: BASE, getToken: () => null, fetch: m.fetch })
    await client.GET('/api/v1/users/session')
    expect(m.calls[0].headers.has('authorization')).toBe(false)
  })

  it('prefers the static token over getToken', async () => {
    const m = mockFetch(json({}))
    const getToken = vi.fn(() => 'jwt')
    const client = createClient({ baseUrl: BASE, token: 'lh_x', getToken, fetch: m.fetch })
    await client.GET('/api/v1/users/session')
    expect(getToken).not.toHaveBeenCalled()
    expect(m.calls[0].headers.get('authorization')).toBe('Bearer lh_x')
  })

  it('lets a per-request Authorization header win and skipAuth drop it', async () => {
    const m = mockFetch(json({}))
    const client = createClient({ baseUrl: BASE, token: 'lh_x', fetch: m.fetch })
    await client.GET('/api/v1/users/session', { headers: { Authorization: 'Bearer other' } })
    await client.GET('/api/v1/users/session', { skipAuth: true })
    expect(m.calls[0].headers.get('authorization')).toBe('Bearer other')
    expect(m.calls[1].headers.has('authorization')).toBe(false)
  })

  it('forwards credentials only when configured', async () => {
    const m = mockFetch(json({}))
    await createClient({ baseUrl: BASE, fetch: m.fetch }).GET('/api/v1/users/session')
    await createClient({ baseUrl: BASE, credentials: 'include', fetch: m.fetch }).GET('/api/v1/users/session')
    expect('credentials' in m.calls[0].init).toBe(false)
    expect(m.calls[1].init.credentials).toBe('include')
  })

  it('merges client and request headers', async () => {
    const m = mockFetch(json({}))
    const client = createClient({ baseUrl: BASE, headers: { 'X-App': 'mobile', 'X-Keep': '1' }, fetch: m.fetch })
    await client.GET('/api/v1/users/session', { headers: [['X-App', 'override']] })
    expect(m.calls[0].headers.get('x-app')).toBe('override')
    expect(m.calls[0].headers.get('x-keep')).toBe('1')
  })
})

describe('path and query serialization', () => {
  it('fills and encodes path params and serializes the query', async () => {
    const m = mockFetch(json({ chapters: [] }))
    const client = createClient({ baseUrl: `${BASE}/`, fetch: m.fetch })
    await client.GET('/api/v1/courses/{course_uuid}/meta', {
      params: { path: { course_uuid: 'course_a b/c' }, query: { slim: true, with_unpublished_activities: undefined } },
    })
    expect(m.calls[0].url).toBe(`${BASE}/api/v1/courses/course_a%20b%2Fc/meta?slim=true`)
  })

  it('numbers in path params', async () => {
    const m = mockFetch(json([]))
    const client = createClient({ baseUrl: BASE, fetch: m.fetch })
    await client.courses.list('my-org', { page: 2, limit: 5 })
    expect(m.calls[0].url).toBe(`${BASE}/api/v1/courses/org_slug/my-org/page/2/limit/5`)
  })

  it('repeats array keys, drops null/undefined, encodes dates and specials', () => {
    const d = new Date('2026-01-02T03:04:05.000Z')
    expect(serializeQuery({ a: [1, 2], b: null, c: undefined, d, e: 'x&y=z', f: false })).toBe(
      'a=1&a=2&d=2026-01-02T03%3A04%3A05.000Z&e=x%26y%3Dz&f=false',
    )
    expect(serializeQuery(undefined)).toBe('')
  })

  it('neutralizes dot segments and rejects missing params', () => {
    expect(buildPath('/api/v1/courses/{course_uuid}', { course_uuid: '..' })).toBe('/api/v1/courses/%2E%2E')
    expect(buildPath('/api/v1/courses/{course_uuid}', { course_uuid: '../admin' })).toBe(
      '/api/v1/courses/..%2Fadmin',
    )
    expect(() => buildPath('/api/v1/courses/{course_uuid}', {})).toThrow(/course_uuid/)
  })

  it('joins base URLs with or without trailing slashes and a path prefix', () => {
    expect(joinUrl('https://x.test///', '/api/v1/a', '')).toBe('https://x.test/api/v1/a')
    expect(joinUrl('https://x.test/proxy', 'api/v1/a', 'q=1')).toBe('https://x.test/proxy/api/v1/a?q=1')
  })

  it('sends JSON bodies with a content type', async () => {
    const m = mockFetch(json({}))
    const client = createClient({ baseUrl: BASE, fetch: m.fetch })
    await client.POST('/api/v1/trail/start', { body: { org_id: 1, user_id: 2 } })
    expect(m.calls[0].method).toBe('POST')
    expect(m.calls[0].headers.get('content-type')).toBe('application/json')
    expect(JSON.parse(m.calls[0].body as string)).toEqual({ org_id: 1, user_id: 2 })
  })

  it('passes FormData through untouched', async () => {
    const m = mockFetch(json({}))
    const client = createClient({ baseUrl: BASE, fetch: m.fetch })
    const fd = new FormData()
    fd.append('a', '1')
    await client.request('POST', '/api/v1/anything', { body: fd })
    expect(m.calls[0].body).toBe(fd)
    expect(m.calls[0].headers.has('content-type')).toBe(false)
  })
})

describe('responses', () => {
  it('returns undefined for 204 and text for non-JSON', async () => {
    const m = mockFetch(
      new Response(null, { status: 204 }),
      new Response('hello', { status: 200, headers: { 'content-type': 'text/plain' } }),
    )
    const client = createClient({ baseUrl: BASE, fetch: m.fetch })
    expect(await client.request('DELETE', '/x')).toBeUndefined()
    expect(await client.request('GET', '/y')).toBe('hello')
  })

  it('can hand back the raw Response', async () => {
    const m = mockFetch(json({ a: 1 }))
    const client = createClient({ baseUrl: BASE, fetch: m.fetch })
    const res = (await client.request('GET', '/x', { parseAs: 'response' })) as Response
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ a: 1 })
  })

  it('reports invalid JSON as PARSE_ERROR', async () => {
    const m = mockFetch(new Response('{nope', { status: 200, headers: { 'content-type': 'application/json' } }))
    const client = createClient({ baseUrl: BASE, fetch: m.fetch })
    await expect(client.request('GET', '/x')).rejects.toMatchObject({ code: 'PARSE_ERROR', status: 200 })
  })

  it('runs onRequest / onResponse hooks', async () => {
    const m = mockFetch(json({}))
    const seen: string[] = []
    const client = createClient({
      baseUrl: BASE,
      fetch: m.fetch,
      onRequest: (ctx) => {
        ctx.init.headers.set('X-Trace', 't1')
        seen.push(`req ${ctx.method} ${ctx.path} #${ctx.attempt}`)
      },
      onResponse: (ctx) => {
        seen.push(`res ${ctx.response.status}`)
      },
    })
    await client.GET('/api/v1/orgs/slug/{org_slug}', { params: { path: { org_slug: 'o' } } })
    expect(m.calls[0].headers.get('x-trace')).toBe('t1')
    expect(seen).toEqual(['req GET /api/v1/orgs/slug/{org_slug} #0', 'res 200'])
  })
})

describe('error mapping', () => {
  it('maps a FastAPI string detail', async () => {
    const m = mockFetch(json({ detail: 'Course not found' }, 404))
    const client = createClient({ baseUrl: BASE, fetch: m.fetch })
    const err = await client.courses.get('course_x').catch((e) => e)
    expect(err).toBeInstanceOf(LearnHouseError)
    expect(isLearnHouseError(err)).toBe(true)
    expect(err).toMatchObject({
      status: 404,
      detail: 'Course not found',
      message: 'Course not found',
      code: 'HTTP_ERROR',
      method: 'GET',
      path: '/api/v1/courses/{course_uuid}',
      url: `${BASE}/api/v1/courses/course_x`,
    })
  })

  it('keeps structured detail codes and messages', async () => {
    const detail = { code: 'INVALID_CREDENTIALS', message: 'Wrong email or password' }
    const m = mockFetch(json({ detail }, 401))
    const client = createClient({ baseUrl: BASE, fetch: m.fetch })
    const err = await client.auth.login({ email: 'a@b.c', password: 'x' }).catch((e) => e)
    expect(err).toMatchObject({ status: 401, code: 'INVALID_CREDENTIALS', message: 'Wrong email or password', detail })
  })

  it('summarizes 422 validation errors', async () => {
    const detail = [{ loc: ['query', 'query'], msg: 'String should have at least 3 characters', type: 'string_too_short' }]
    const m = mockFetch(json({ detail }, 422))
    const client = createClient({ baseUrl: BASE, fetch: m.fetch })
    const err = await client.search.org('o', 'ab').catch((e) => e)
    expect(err.code).toBe('VALIDATION_ERROR')
    expect(err.message).toBe('query.query: String should have at least 3 characters')
  })

  it('handles non-JSON error bodies', async () => {
    const m = mockFetch(new Response('Bad Gateway', { status: 502 }))
    const client = createClient({ baseUrl: BASE, fetch: m.fetch, retry: false })
    const err = await client.request('GET', '/x').catch((e) => e)
    expect(err).toMatchObject({ status: 502, detail: 'Bad Gateway', message: 'Bad Gateway' })
  })

  it('wraps network failures', async () => {
    const m = mockFetch(new TypeError('fetch failed'))
    const client = createClient({ baseUrl: BASE, fetch: m.fetch, retry: false })
    const err = (await client.request('GET', '/x').catch((e: unknown) => e)) as LearnHouseError
    expect(err).toMatchObject({ status: 0, code: 'NETWORK_ERROR', message: 'fetch failed' })
    expect(err.cause).toBeInstanceOf(TypeError)
  })

  it('requires a baseUrl', () => {
    expect(() => createClient({} as never)).toThrow(/baseUrl/)
  })
})

describe('retries', () => {
  const fast = { retries: 2, baseDelayMs: 1, maxDelayMs: 2 }

  it('retries GET on 5xx then succeeds', async () => {
    const m = mockFetch(json({ detail: 'boom' }, 503), json({ detail: 'boom' }, 500), json({ ok: 1 }))
    const client = createClient({ baseUrl: BASE, fetch: m.fetch, retry: fast })
    expect(await client.request('GET', '/x')).toEqual({ ok: 1 })
    expect(m.calls).toHaveLength(3)
  })

  it('retries GET on network errors and gives up after the limit', async () => {
    const m = mockFetch(new TypeError('socket hang up'))
    const client = createClient({ baseUrl: BASE, fetch: m.fetch, retry: fast })
    await expect(client.request('GET', '/x')).rejects.toMatchObject({ code: 'NETWORK_ERROR' })
    expect(m.calls).toHaveLength(3)
  })

  it('never retries 4xx', async () => {
    const m = mockFetch(json({ detail: 'nope' }, 404))
    const client = createClient({ baseUrl: BASE, fetch: m.fetch, retry: fast })
    await expect(client.request('GET', '/x')).rejects.toMatchObject({ status: 404 })
    expect(m.calls).toHaveLength(1)
  })

  it('never retries non-GET methods', async () => {
    const m = mockFetch(json({ detail: 'boom' }, 503))
    const client = createClient({ baseUrl: BASE, fetch: m.fetch, retry: fast })
    await expect(client.trail.completeActivity('activity_1')).rejects.toMatchObject({ status: 503 })
    expect(m.calls).toHaveLength(1)
  })

  it('does not retry the refresh call', async () => {
    const m = mockFetch(json({ detail: 'boom' }, 502))
    const client = createClient({ baseUrl: BASE, fetch: m.fetch, retry: fast })
    await expect(client.auth.refresh()).rejects.toMatchObject({ status: 502 })
    expect(m.calls).toHaveLength(1)
  })

  it('backs off exponentially', async () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(1) // no jitter: delay = full exponential
    const m = mockFetch(json({}, 500), json({}, 500), json({ ok: true }))
    const client = createClient({ baseUrl: BASE, fetch: m.fetch, retry: { retries: 2, baseDelayMs: 100, maxDelayMs: 1000 } })
    const p = client.request('GET', '/x')
    await vi.advanceTimersByTimeAsync(0)
    expect(m.calls).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(99)
    expect(m.calls).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(m.calls).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(199)
    expect(m.calls).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(m.calls).toHaveLength(3)
    await expect(p).resolves.toEqual({ ok: true })
    vi.restoreAllMocks()
  })
})

describe('timeouts and cancellation', () => {
  it('times out with a TIMEOUT error', async () => {
    const h = hangingFetch()
    const client = createClient({ baseUrl: BASE, fetch: h.fetch, timeoutMs: 20, retry: false })
    const err = (await client.request('GET', '/slow').catch((e: unknown) => e)) as LearnHouseError
    expect(err).toBeInstanceOf(LearnHouseError)
    expect(err).toMatchObject({ code: 'TIMEOUT', status: 0, message: 'Request timed out after 20ms' })
  })

  it('retries a timed-out GET with a fresh timeout', async () => {
    const h = hangingFetch()
    const client = createClient({ baseUrl: BASE, fetch: h.fetch, timeoutMs: 10, retry: { retries: 1, baseDelayMs: 1 } })
    await expect(client.request('GET', '/slow')).rejects.toMatchObject({ code: 'TIMEOUT' })
    expect(h.calls).toHaveLength(2)
  })

  it('a per-request timeout overrides the client default', async () => {
    const h = hangingFetch()
    const client = createClient({ baseUrl: BASE, fetch: h.fetch, timeoutMs: 60_000, retry: false })
    await expect(client.request('GET', '/slow', { timeoutMs: 5 })).rejects.toMatchObject({ code: 'TIMEOUT' })
  })

  it("rejects with the caller's abort reason and does not retry", async () => {
    const h = hangingFetch()
    const client = createClient({ baseUrl: BASE, fetch: h.fetch, retry: 3 })
    const ac = new AbortController()
    const p = client.request('GET', '/slow', { signal: ac.signal })
    setTimeout(() => ac.abort(), 5)
    const err = (await p.catch((e: unknown) => e)) as Error
    expect(err).not.toBeInstanceOf(LearnHouseError)
    expect(err.name).toBe('AbortError')
    expect(h.calls).toHaveLength(1)
  })

  it('does not call fetch when the signal is already aborted', async () => {
    const m = mockFetch(json({}))
    const client = createClient({ baseUrl: BASE, fetch: m.fetch })
    const ac = new AbortController()
    ac.abort()
    await expect(client.request('GET', '/x', { signal: ac.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(m.calls).toHaveLength(0)
  })

  it('stops waiting between retries when aborted', async () => {
    const m = mockFetch(json({}, 500))
    const client = createClient({ baseUrl: BASE, fetch: m.fetch, retry: { retries: 3, baseDelayMs: 10_000 } })
    const ac = new AbortController()
    const p = client.request('GET', '/x', { signal: ac.signal })
    setTimeout(() => ac.abort(), 20)
    await expect(p).rejects.toMatchObject({ name: 'AbortError' })
    expect(m.calls).toHaveLength(1)
  })
})
