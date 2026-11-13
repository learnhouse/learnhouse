import { describe, expect, it, vi } from 'vitest'
import {
  REFRESH_MARGIN_MS,
  SessionStore,
  createClient,
  refreshDelay,
  resolveSession,
  tokenExpiry,
  withSessionRetry,
} from '../src'
import { json, mockFetch } from './helpers'

const BASE = 'http://api.test'

/** An unsigned JWT-shaped token: only `exp` is ever read client-side. */
function jwt(claims: Record<string, unknown>) {
  const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
  return `${b64({ alg: 'HS256' })}.${b64(claims)}.sig`
}
const inMinutes = (m: number) => Math.floor(Date.now() / 1000) + m * 60

describe('session helpers', () => {
  it('reads the expiry of a JWT and of a minted session', () => {
    const exp = inMinutes(15)
    expect(tokenExpiry(jwt({ exp }))).toBe(exp * 1000)
    expect(tokenExpiry('not-a-jwt')).toBeNull()
    expect(tokenExpiry('a.@@@.c')).toBeNull()
    expect(resolveSession({ access_token: 'x', expires_at: 100 })).toEqual({ token: 'x', expiresAt: 100_000 })
    expect(resolveSession(null)).toBeNull()
    expect(resolveSession({ access_token: '' })).toBeNull()
  })

  it('refuses org API tokens', () => {
    expect(() => resolveSession('lh_secret')).toThrow(/API token/)
    expect(() => resolveSession({ access_token: 'lh_secret' })).toThrow(/API token/)
  })

  it('refreshes a minute before expiry, sooner for short sessions', () => {
    const now = 1_000_000
    expect(refreshDelay({ token: 't', expiresAt: now + 15 * 60_000 }, now)).toBe(15 * 60_000 - REFRESH_MARGIN_MS)
    expect(refreshDelay({ token: 't', expiresAt: now + 30_000 }, now)).toBe(20_000)
    expect(refreshDelay({ token: 't', expiresAt: now - 1 }, now)).toBe(0)
    expect(refreshDelay({ token: 't', expiresAt: null }, now)).toBeNull()
    expect(refreshDelay(null, now)).toBeNull()
  })

  it('shares one getSession call and fetches a new session when the old one runs out', async () => {
    const old = jwt({ exp: Math.floor(Date.now() / 1000) + 2 })
    const fresh = jwt({ exp: inMinutes(15), n: 2 })
    const getSession = vi.fn(async () => ({ access_token: fresh }))
    const store = new SessionStore(old, getSession)
    const seen: (string | undefined)[] = []
    store.subscribe((s) => seen.push(s?.token))

    const [a, b] = await Promise.all([store.getToken(), store.getToken()])
    expect(a).toBe(fresh)
    expect(b).toBe(fresh)
    expect(getSession).toHaveBeenCalledTimes(1)
    expect(seen).toEqual([fresh])
    expect(store.canRefresh).toBe(true)
  })

  it('keeps the old session when getSession fails, and drops an expired one without getSession', async () => {
    const store = new SessionStore(
      'opaque',
      vi.fn(async () => {
        throw new Error('host down')
      }),
    )
    expect(await store.refresh()).toBeNull()
    expect(store.session?.token).toBe('opaque')

    const expired = new SessionStore(jwt({ exp: Math.floor(Date.now() / 1000) - 10 }))
    expect(await expired.getToken()).toBeNull()
    expect(await expired.refresh()).toBe(expired.session)
    const lasting = new SessionStore('opaque')
    expect(await lasting.getToken()).toBe('opaque')
  })

  it('surfaces an API token coming from getSession', async () => {
    const store = new SessionStore(null, async () => 'lh_secret')
    await expect(store.refresh()).rejects.toThrow(/API token/)
  })

  it('stops notifying once disposed', () => {
    const store = new SessionStore('a')
    const listener = vi.fn()
    store.subscribe(listener)
    store.set('a')
    expect(listener).not.toHaveBeenCalled()
    store.dispose()
    store.set('b')
    expect(listener).not.toHaveBeenCalled()
  })

})

describe('createClient with a learner session', () => {
  it('sends the session token and ignores a static token', async () => {
    const m = mockFetch(json({}))
    const token = jwt({ exp: inMinutes(15) })
    const client = createClient({ baseUrl: BASE, fetch: m.fetch, token: 'other', session: { access_token: token } })
    await client.users.session()
    expect(m.calls[0].headers.get('authorization')).toBe(`Bearer ${token}`)
    expect(client.session?.session?.token).toBe(token)
  })

  it('fetches the first session from getSession', async () => {
    const m = mockFetch(json({}))
    const token = jwt({ exp: inMinutes(15) })
    const client = createClient({ baseUrl: BASE, fetch: m.fetch, getSession: async () => token })
    await client.users.session()
    expect(m.calls[0].headers.get('authorization')).toBe(`Bearer ${token}`)
  })

  it('retries once with a new session on 401', async () => {
    const stale = jwt({ exp: inMinutes(15), n: 1 })
    const fresh = jwt({ exp: inMinutes(15), n: 2 })
    const m = mockFetch((call) =>
      call.headers.get('authorization') === `Bearer ${stale}` ? json({ detail: 'expired' }, 401) : json({ ok: true }),
    )
    const getSession = vi.fn(async () => fresh)
    const client = createClient({ baseUrl: BASE, fetch: m.fetch, session: stale, getSession })
    await expect(client.users.session()).resolves.toEqual({ ok: true })
    expect(getSession).toHaveBeenCalledTimes(1)
    expect(m.calls.map((c) => c.headers.get('authorization'))).toEqual([`Bearer ${stale}`, `Bearer ${fresh}`])
  })

  it('shares a store between clients', () => {
    const store = new SessionStore('opaque')
    const a = createClient({ baseUrl: BASE, sessionStore: store })
    const b = createClient({ baseUrl: BASE, sessionStore: store })
    expect(a.session).toBe(store)
    expect(b.session).toBe(store)
    expect(createClient({ baseUrl: BASE }).session).toBeNull()
  })
})

describe('withSessionRetry', () => {
  it('leaves other responses and anonymous requests alone', async () => {
    const store = new SessionStore('a', async () => 'b')
    const refresh = vi.spyOn(store, 'refresh')
    const ok = vi.fn(async () => new Response('{}', { status: 200 }))
    await withSessionRetry(ok, store)('u', { headers: { Authorization: 'Bearer a' } })
    const denied = vi.fn(async () => new Response('{}', { status: 401 }))
    await withSessionRetry(denied, store)('u', {})
    await withSessionRetry(denied, store)('u', { headers: { Authorization: 'Basic x' } })
    expect(refresh).not.toHaveBeenCalled()
  })

  it('gives up when no new session comes back', async () => {
    const denied = vi.fn(async () => new Response('{}', { status: 401 }))
    const same = new SessionStore('a', async () => 'a')
    expect((await withSessionRetry(denied, same)('u', { headers: { Authorization: 'Bearer a' } })).status).toBe(401)
    const none = new SessionStore('a', async () => null)
    expect((await withSessionRetry(denied, none)('u', { headers: { Authorization: 'Bearer a' } })).status).toBe(401)
    const fixed = new SessionStore('a')
    expect((await withSessionRetry(denied, fixed)('u', { headers: { Authorization: 'Bearer a' } })).status).toBe(401)
    expect(denied).toHaveBeenCalledTimes(3)
  })
})
