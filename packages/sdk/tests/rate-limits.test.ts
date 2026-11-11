import { afterEach, describe, expect, it, vi } from 'vitest'
import { createClient, LearnHouseError } from '../src'
import { parseRetryAfter } from '../src/core/http'
import { json, mockFetch } from './helpers'

const BASE = 'https://api.example.test'
const fast = { retries: 2, baseDelayMs: 1, maxDelayMs: 5_000 }
const limited = (headers: Record<string, string> = {}, detail: unknown = 'Too many requests. Please slow down.') =>
  json({ detail }, 429, headers)

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('parseRetryAfter', () => {
  it('reads delay-seconds, HTTP dates and rejects junk', () => {
    const now = Date.UTC(2026, 10, 8, 12, 0, 0)
    expect(parseRetryAfter('3', now)).toBe(3000)
    expect(parseRetryAfter(' 1.5 ', now)).toBe(1500)
    expect(parseRetryAfter('0', now)).toBe(0)
    expect(parseRetryAfter(new Date(now + 4000).toUTCString(), now)).toBe(4000)
    expect(parseRetryAfter(new Date(now - 60_000).toUTCString(), now)).toBe(0)
    expect(parseRetryAfter('soon', now)).toBeUndefined()
    expect(parseRetryAfter('', now)).toBeUndefined()
    expect(parseRetryAfter(null, now)).toBeUndefined()
    expect(parseRetryAfter(undefined, now)).toBeUndefined()
  })
})

describe('429 and Retry-After', () => {
  it('retries a 429 without Retry-After using the normal backoff', async () => {
    const m = mockFetch(limited(), json({ ok: 1 }))
    const client = createClient({ baseUrl: BASE, fetch: m.fetch, retry: fast })
    expect(await client.request('GET', '/x')).toEqual({ ok: 1 })
    expect(m.calls).toHaveLength(2)
  })

  it('retries a 429 for methods that change data', async () => {
    const m = mockFetch(limited({ 'Retry-After': '0' }), json({ ok: 1 }))
    const client = createClient({ baseUrl: BASE, fetch: m.fetch, retry: fast })
    expect(await client.request('POST', '/x', { body: { a: 1 } })).toEqual({ ok: 1 })
    expect(m.calls.map((c) => [c.method, c.body])).toEqual([
      ['POST', '{"a":1}'],
      ['POST', '{"a":1}'],
    ])
  })

  it('waits exactly Retry-After seconds', async () => {
    vi.useFakeTimers()
    const m = mockFetch(limited({ 'Retry-After': '2' }), json({ ok: 1 }))
    const client = createClient({ baseUrl: BASE, fetch: m.fetch, retry: fast })
    const p = client.request('GET', '/x')
    await vi.advanceTimersByTimeAsync(1999)
    expect(m.calls).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(m.calls).toHaveLength(2)
    await expect(p).resolves.toEqual({ ok: 1 })
  })

  it('waits until a Retry-After HTTP date', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(Date.UTC(2026, 10, 8, 12, 0, 0))
    const at = new Date(Date.now() + 3000).toUTCString()
    const m = mockFetch(limited({ 'Retry-After': at }), json({ ok: 1 }))
    const client = createClient({ baseUrl: BASE, fetch: m.fetch, retry: fast })
    const p = client.request('GET', '/x')
    await vi.advanceTimersByTimeAsync(2999)
    expect(m.calls).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(m.calls).toHaveLength(2)
    await expect(p).resolves.toEqual({ ok: 1 })
  })

  it("falls back to the API's detail.retry_after when the header is missing", async () => {
    vi.useFakeTimers()
    const detail = { code: 'RATE_LIMITED', message: 'Too many refresh attempts.', retry_after: 1 }
    const m = mockFetch(limited({}, detail), json({ ok: 1 }))
    const client = createClient({ baseUrl: BASE, fetch: m.fetch, retry: fast })
    const p = client.request('GET', '/x')
    await vi.advanceTimersByTimeAsync(999)
    expect(m.calls).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    await expect(p).resolves.toEqual({ ok: 1 })
  })

  it('does not wait past maxDelayMs: throws at once with retryAfterMs', async () => {
    const m = mockFetch(limited({ 'Retry-After': '60' }), json({ ok: 1 }))
    const client = createClient({ baseUrl: BASE, fetch: m.fetch, retry: fast })
    const err = (await client.request('GET', '/x').catch((e: unknown) => e)) as LearnHouseError
    expect(err).toBeInstanceOf(LearnHouseError)
    expect(err).toMatchObject({ status: 429, retryAfterMs: 60_000 })
    expect(m.calls).toHaveLength(1)
  })

  it('exposes retryAfterMs once retries run out', async () => {
    const m = mockFetch(limited({ 'Retry-After': '0' }, { code: 'RATE_LIMITED', message: 'Slow down' }))
    const client = createClient({ baseUrl: BASE, fetch: m.fetch, retry: fast })
    await expect(client.request('GET', '/x')).rejects.toMatchObject({
      status: 429,
      code: 'RATE_LIMITED',
      retryAfterMs: 0,
    })
    expect(m.calls).toHaveLength(3)
  })

  it('ignores an unparseable Retry-After and backs off instead', async () => {
    const m = mockFetch(limited({ 'Retry-After': 'later' }), json({ ok: 1 }))
    const client = createClient({ baseUrl: BASE, fetch: m.fetch, retry: fast })
    expect(await client.request('GET', '/x')).toEqual({ ok: 1 })
    const only = mockFetch(limited({ 'Retry-After': 'later' }))
    const err = (await createClient({ baseUrl: BASE, fetch: only.fetch, retry: false })
      .request('GET', '/x')
      .catch((e: unknown) => e)) as LearnHouseError
    expect(err.retryAfterMs).toBeUndefined()
    expect('retryAfterMs' in err).toBe(false)
  })

  it('does not retry a 429 when retries are off', async () => {
    const m = mockFetch(limited({ 'Retry-After': '0' }))
    const client = createClient({ baseUrl: BASE, fetch: m.fetch, retry: false })
    await expect(client.request('POST', '/x')).rejects.toMatchObject({ status: 429, retryAfterMs: 0 })
    expect(m.calls).toHaveLength(1)
  })

  it('does not resend a stream body after a 429', async () => {
    const m = mockFetch(limited({ 'Retry-After': '0' }))
    const client = createClient({ baseUrl: BASE, fetch: m.fetch, retry: fast })
    const body = new ReadableStream({ start: (c) => c.close() })
    await expect(client.request('POST', '/x', { body })).rejects.toMatchObject({ status: 429 })
    expect(m.calls).toHaveLength(1)
  })

  it('stops waiting for Retry-After when the signal aborts', async () => {
    const m = mockFetch(limited({ 'Retry-After': '4' }), json({ ok: 1 }))
    const client = createClient({ baseUrl: BASE, fetch: m.fetch, retry: fast })
    const ac = new AbortController()
    const p = client.request('GET', '/x', { signal: ac.signal })
    setTimeout(() => ac.abort(), 20)
    const err = (await p.catch((e: unknown) => e)) as Error
    expect(err).not.toBeInstanceOf(LearnHouseError)
    expect(err.name).toBe('AbortError')
    expect(m.calls).toHaveLength(1)
  })
})

describe('503 and Retry-After', () => {
  it('honours Retry-After on a 503 GET', async () => {
    vi.useFakeTimers()
    const m = mockFetch(json({ detail: 'maintenance' }, 503, { 'Retry-After': '1' }), json({ ok: 1 }))
    const client = createClient({ baseUrl: BASE, fetch: m.fetch, retry: fast })
    const p = client.request('GET', '/x')
    await vi.advanceTimersByTimeAsync(999)
    expect(m.calls).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(m.calls).toHaveLength(2)
    await expect(p).resolves.toEqual({ ok: 1 })
  })

  it('still never retries a 503 for methods that change data', async () => {
    const m = mockFetch(json({ detail: 'maintenance' }, 503, { 'Retry-After': '0' }))
    const client = createClient({ baseUrl: BASE, fetch: m.fetch, retry: fast })
    await expect(client.request('POST', '/x')).rejects.toMatchObject({ status: 503, retryAfterMs: 0 })
    expect(m.calls).toHaveLength(1)
  })

  it('uses the backoff, not Retry-After, for other 5xx', async () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(1)
    const m = mockFetch(json({ detail: 'boom' }, 500, { 'Retry-After': '3' }), json({ ok: 1 }))
    const client = createClient({ baseUrl: BASE, fetch: m.fetch, retry: { retries: 1, baseDelayMs: 100 } })
    const p = client.request('GET', '/x')
    await vi.advanceTimersByTimeAsync(100)
    expect(m.calls).toHaveLength(2)
    await expect(p).resolves.toEqual({ ok: 1 })
  })
})
