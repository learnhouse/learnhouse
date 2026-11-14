import { afterEach, describe, expect, it } from 'vitest'
import { createClient } from '../src'
import { json, mockFetch } from './helpers'

const BASE = 'http://api.test'
const SESSION = {
  access_token: 'jwt',
  token_type: 'bearer',
  expires_in: 900,
  expires_at: 1_900_000_000,
  user_id: 7,
  user_uuid: 'user_7',
  org_id: 1,
}

describe('embed.createSession', () => {
  afterEach(() => {
    delete (globalThis as { document?: unknown }).document
  })

  it('posts the learner to the embed-session endpoint with the API token', async () => {
    const m = mockFetch(json(SESSION))
    const client = createClient({ baseUrl: BASE, fetch: m.fetch, token: 'lh_secret' })

    const session = await client.embed.createSession({ orgSlug: 'acme', userId: 7 })

    expect(session).toEqual(SESSION)
    const call = m.calls[0]
    expect(`${call.method} ${call.url.slice(BASE.length)}`).toBe('POST /api/v1/admin/acme/auth/embed-session')
    expect(call.headers.get('authorization')).toBe('Bearer lh_secret')
    expect(JSON.parse(call.body as string)).toEqual({ user_id: 7 })
  })

  it('sends ttl_seconds when given and encodes the slug', async () => {
    const m = mockFetch(json(SESSION))
    const client = createClient({ baseUrl: BASE, fetch: m.fetch, token: 'lh_secret' })

    await client.embed.createSession({ orgSlug: 'a/b', userId: 7, ttlSeconds: 300 })

    expect(m.calls[0].url).toBe(`${BASE}/api/v1/admin/a%2Fb/auth/embed-session`)
    expect(JSON.parse(m.calls[0].body as string)).toEqual({ user_id: 7, ttl_seconds: 300 })
  })

  it('refuses to run in a browser, before any request', async () => {
    ;(globalThis as { document?: unknown }).document = {}
    const m = mockFetch(json(SESSION))
    const client = createClient({ baseUrl: BASE, fetch: m.fetch, token: 'lh_secret' })

    await expect(client.embed.createSession({ orgSlug: 'acme', userId: 7 })).rejects.toThrow(/never in the browser/)
    expect(m.calls).toHaveLength(0)
  })
})
