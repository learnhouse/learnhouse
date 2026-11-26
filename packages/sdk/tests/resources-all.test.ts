// Every resource method: the exact method, URL (path + query), auth header and
// body it sends, and that it hands back the parsed response. The table lives in
// calls.ts so the contract test can check the same endpoints against the
// OpenAPI snapshot.
import { describe, expect, it } from 'vitest'
import { createClient, LearnHouseError } from '../src'
import { CALLS, NOT_IN_TABLE, resourceMethodNames } from './calls'
import { json, mockFetch } from './helpers'

const BASE = 'http://api.test'

function client(response: unknown = {}) {
  const m = mockFetch(json(response))
  return { m, lh: createClient({ baseUrl: BASE, fetch: m.fetch, token: 'lh_t', retry: false }) }
}

describe.each(CALLS)('$name', (c) => {
  it(`sends ${c.method} ${c.url}`, async () => {
    const response = c.response ?? {}
    const { m, lh } = client(response)
    const out = await c.run(lh)

    expect(m.calls).toHaveLength(1)
    const call = m.calls[0]
    expect(call.method).toBe(c.method)
    expect(call.url).toBe(BASE + c.url)
    expect(call.headers.get('accept')).toBe('application/json')

    if (c.auth === false) expect(call.headers.has('authorization')).toBe(false)
    else expect(call.headers.get('authorization')).toBe('Bearer lh_t')

    if (c.formData) {
      expect(call.body).toBeInstanceOf(FormData)
      const form = call.body as FormData
      for (const [field, filename] of Object.entries(c.formData)) {
        const part = form.get(field)
        expect(part).toBeInstanceOf(Blob)
        expect((part as File).name).toBe(filename)
      }
      // The browser sets the multipart boundary; the SDK must not.
      expect(call.headers.has('content-type')).toBe(false)
    } else if (typeof c.body === 'string' && c.body.startsWith('form:')) {
      expect(call.headers.get('content-type')).toBe('application/x-www-form-urlencoded')
      expect(call.body).toBe(c.body.slice(5))
    } else if (c.body !== undefined) {
      expect(call.headers.get('content-type')).toBe('application/json')
      expect(JSON.parse(call.body as string)).toEqual(c.body)
    } else {
      expect(call.body).toBeUndefined()
    }

    // Results pass through untouched, except for the few documented helpers.
    if (!['trail.getCourseProgress', 'chapters.listForCourse', 'podcasts.count'].includes(c.name)) {
      expect(out).toEqual(response)
    }
  })

  it('maps an error response to LearnHouseError with the path template', async () => {
    const m = mockFetch(json({ detail: { code: 'NOPE', message: 'Not allowed' } }, 403))
    const lh = createClient({ baseUrl: BASE, fetch: m.fetch, token: 'lh_t', retry: false })
    const err = (await c.run(lh).catch((e) => e)) as LearnHouseError
    // (certificates.verify only turns a 404 into null; a 403 still throws.)
    expect(err).toBeInstanceOf(LearnHouseError)
    expect(err.status).toBe(403)
    expect(err.code).toBe('NOPE')
    expect(err.message).toBe('Not allowed')
    expect(err.method).toBe(c.method)
    expect(err.path).toBe(c.template)
  })

  it('forwards per-call options: an aborted signal stops it before fetch', async () => {
    const { m, lh } = client(c.response ?? {})
    const ac = new AbortController()
    ac.abort()
    await expect(c.run(withOptions(lh, { signal: ac.signal }))).rejects.toMatchObject({ name: 'AbortError' })
    expect(m.calls).toHaveLength(0)
  })

  it('forwards per-call options: headers reach the request', async () => {
    const { m, lh } = client(c.response ?? {})
    await c.run(withOptions(lh, { headers: { 'X-Trace': 'abc' } }))
    expect(m.calls[0].headers.get('x-trace')).toBe('abc')
  })
})

/** Index of a method's `options` parameter, read from its source. */
function optionsIndex(fn: (...args: unknown[]) => unknown): number {
  const head = /^[^(]*\(([^)]*)\)/.exec(fn.toString())?.[1] ?? ''
  const names = head.split(',').map((p) => p.trim().split(/[\s=:]/)[0]).filter(Boolean)
  return names.indexOf('options')
}

/**
 * The client, with every resource method merging `extra` into its `options`
 * argument. Proves each method hands its options down to the request.
 */
function withOptions<T extends object>(target: T, extra: Record<string, unknown>): T {
  return new Proxy(target, {
    get(obj, key, receiver) {
      const value = Reflect.get(obj, key, receiver)
      if (typeof value === 'function') {
        const idx = optionsIndex(value as (...args: unknown[]) => unknown)
        if (idx < 0) return value
        return (...args: unknown[]) => {
          const a = [...args]
          while (a.length < idx) a.push(undefined)
          a[idx] = { ...((a[idx] as object | undefined) ?? {}), ...extra }
          return (value as (...x: unknown[]) => unknown).apply(obj, a)
        }
      }
      if (value && typeof value === 'object') return withOptions(value as object, extra)
      return value
    },
  })
}

describe('coverage of the table', () => {
  it('lists every resource method of the client', () => {
    const { lh } = client()
    const covered = new Set(CALLS.map((c) => c.name.replace(/ \(.*\)$/, '')))
    const missing = resourceMethodNames(lh).filter((n) => !covered.has(n) && !NOT_IN_TABLE.has(n))
    expect(missing).toEqual([])
  })
})
