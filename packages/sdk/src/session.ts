// Learner sessions in the browser.
//
// A host app mints an embed session on its server (`client.embed.createSession`)
// and hands it to the browser, either as a value or through `getSession`.
// Sessions are short-lived and have no refresh token, so the store asks
// `getSession` for a new one shortly before the current one expires, and once
// more if the API answers 401. `createClient({ getSession })` uses it, and so
// do @learnhouse/react and @learnhouse/vue.

import type { FetchLike } from './core/http'

/** What a host may pass as a session: the token, or the minted session object. */
export type LearnHouseSessionInput =
  | string
  | {
      access_token: string
      /** Unix time in seconds, as returned by the API. Read from the token when absent. */
      expires_at?: number
    }

export type GetLearnHouseSession = () =>
  | LearnHouseSessionInput
  | null
  | undefined
  | Promise<LearnHouseSessionInput | null | undefined>

export interface ResolvedSession {
  token: string
  /** Epoch milliseconds, or null when unknown. */
  expiresAt: number | null
}

/** Refresh this long before expiry (capped to a third of a short session). */
export const REFRESH_MARGIN_MS = 60_000

function decodeBase64Url(part: string): string | null {
  try {
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
    return typeof atob === 'function' ? atob(padded) : null
  } catch {
    return null
  }
}

/**
 * Expiry (epoch ms) of a JWT, read without verifying it: only used to know
 * when to ask for a new session, never to trust the token.
 */
export function tokenExpiry(token: string): number | null {
  const payload = token.split('.')[1]
  if (!payload) return null
  const json = decodeBase64Url(payload)
  if (!json) return null
  try {
    const exp = JSON.parse(json)?.exp
    return typeof exp === 'number' && Number.isFinite(exp) ? exp * 1000 : null
  } catch {
    return null
  }
}

export function resolveSession(input: LearnHouseSessionInput | null | undefined): ResolvedSession | null {
  if (!input) return null
  if (typeof input === 'string') {
    if (input.startsWith('lh_')) throw apiTokenError()
    return { token: input, expiresAt: tokenExpiry(input) }
  }
  if (typeof input.access_token !== 'string' || !input.access_token) return null
  if (input.access_token.startsWith('lh_')) throw apiTokenError()
  const expiresAt =
    typeof input.expires_at === 'number' && Number.isFinite(input.expires_at)
      ? input.expires_at * 1000
      : tokenExpiry(input.access_token)
  return { token: input.access_token, expiresAt }
}

/** Thrown when an org API token (`lh_…`) is passed where a session belongs. */
export class ApiTokenInBrowserError extends Error {}

function apiTokenError() {
  // An org API token in the browser gives every visitor the org's API.
  return new ApiTokenInBrowserError(
    '@learnhouse: an `lh_` API token was passed as the session. Mint an embed session on your server ' +
      '(client.embed.createSession) and pass that instead; API tokens must never reach the browser.',
  )
}

/** Milliseconds from `now` until the session should be refreshed, or null. */
export function refreshDelay(session: ResolvedSession | null, now = Date.now()): number | null {
  if (!session?.expiresAt) return null
  const remaining = session.expiresAt - now
  const margin = Math.min(REFRESH_MARGIN_MS, Math.max(remaining / 3, 0))
  return Math.max(remaining - margin, 0)
}

type Listener = (session: ResolvedSession | null) => void

/**
 * Holds the current session and fetches a new one when it is about to expire.
 * Concurrent callers share one in-flight `getSession` call.
 */
export class SessionStore {
  private current: ResolvedSession | null
  private source: GetLearnHouseSession | undefined
  private inflight: Promise<ResolvedSession | null> | null = null
  private listeners = new Set<Listener>()
  private disposed = false

  constructor(initial: LearnHouseSessionInput | null | undefined, source?: GetLearnHouseSession) {
    this.current = resolveSession(initial)
    this.source = source
  }

  get session(): ResolvedSession | null {
    return this.current
  }

  /** Whether a new session can be fetched (a `getSession` was given). */
  get canRefresh(): boolean {
    return !!this.source
  }

  setSource(source: GetLearnHouseSession | undefined) {
    this.source = source
  }

  /** Replace the session with one the host passed directly. */
  set(input: LearnHouseSessionInput | null | undefined) {
    this.update(resolveSession(input))
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  dispose() {
    this.disposed = true
    this.listeners.clear()
  }

  /** A token valid for at least a moment longer, fetching a new session if needed. */
  async getToken(now = Date.now()): Promise<string | null> {
    const session = this.current
    if (session && (!session.expiresAt || session.expiresAt - now > 5_000)) return session.token
    if (!this.source) return session && (!session.expiresAt || session.expiresAt > now) ? session.token : null
    return (await this.refresh())?.token ?? null
  }

  /** Ask the host for a new session (deduplicated). */
  refresh(): Promise<ResolvedSession | null> {
    if (!this.source) return Promise.resolve(this.current)
    if (this.inflight) return this.inflight
    const source = this.source
    this.inflight = (async () => {
      try {
        const next = resolveSession(await source())
        this.update(next)
        return next
      } catch (error) {
        // Keep the old session; the caller decides what a failure means.
        if (error instanceof ApiTokenInBrowserError) throw error
        return null
      } finally {
        this.inflight = null
      }
    })()
    return this.inflight
  }

  private update(next: ResolvedSession | null) {
    if (this.disposed) return
    const prev = this.current
    if (prev?.token === next?.token && prev?.expiresAt === next?.expiresAt) return
    this.current = next
    this.listeners.forEach((listener) => listener(next))
  }
}

function bearerOf(init: RequestInit | undefined): string | null {
  const header = new Headers(init?.headers).get('authorization')
  if (!header || !/^bearer /i.test(header)) return null
  return header.slice(7).trim()
}

/**
 * Wraps `fetch` so a 401 on a request made with a session token fetches a new
 * session and retries once with it. Covers a session that expired between the
 * refresh timer and the request (a sleeping laptop, a slow host).
 */
export function withSessionRetry(fetchImpl: FetchLike, store: SessionStore): FetchLike {
  return async (input, init) => {
    const res = await fetchImpl(input, init)
    const used = bearerOf(init)
    if (res.status !== 401 || !used || !store.canRefresh) return res
    const next = await store.refresh()
    if (!next || next.token === used) return res
    const headers = new Headers(init?.headers)
    headers.set('Authorization', `Bearer ${next.token}`)
    return fetchImpl(input, { ...init, headers })
  }
}
