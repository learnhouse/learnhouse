import { getAPIUrl, getDeploymentMode } from '@services/config/config'

/**
 * Transport for org analytics events (the backend sink of useLHAnalytics).
 *
 * Events are queued in memory and sent in batches to `POST signals/batch`:
 * every few seconds, as soon as a queue fills up, and when the page is hidden
 * or unloaded. The path is deliberately neutral; the old `analytics/events`
 * matched EasyPrivacy's `/analytics/event` rule, so visitors running uBlock
 * Origin, Brave or AdGuard were never counted.
 *
 * Batches go out with `fetch(..., { keepalive: true })` rather than
 * `sendBeacon` so signed-in requests can still carry their Authorization
 * header after the page is gone. Keepalive bodies share a 64KB budget per
 * page, hence the per-request cap below.
 *
 * The endpoint ships with Enterprise Edition, so an OSS deployment queues and
 * sends nothing.
 *
 * Nothing in here throws: analytics must never break the app.
 */

// lgtm[js/hardcoded-credentials] -- not a secret, just a sessionStorage key name
const SESSION_KEY = 'lh_analytics_session_id'
const FLUSH_INTERVAL_MS = 3000
/** Flush early once a queue holds this many events. */
const FLUSH_AT = 20
/** The API takes at most 25 events per batch. */
const MAX_BATCH = 25
/** Stay under the 64KB keepalive budget. */
const MAX_BODY_BYTES = 60_000
/** A queue that can't be sent (offline, API down) stops growing here. */
const MAX_QUEUED = 200

type QueuedEvent = { name: string; props: Record<string, unknown> }
type Queue = { orgId: number; accessToken?: string; events: QueuedEvent[] }

// One queue per org and credential, so events recorded before a sign-in are
// never sent with a token that wasn't theirs.
const queues = new Map<string, Queue>()
let timer: ReturnType<typeof setTimeout> | null = null
let listening = false
let memorySessionId = ''

function randomId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch {
    // randomUUID needs a secure context; fall through
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

export function getSessionId(): string {
  if (typeof window === 'undefined') return ''
  try {
    let id = window.sessionStorage.getItem(SESSION_KEY)
    if (!id) {
      id = randomId()
      window.sessionStorage.setItem(SESSION_KEY, id)
    }
    return id
  } catch {
    // Storage blocked (privacy mode, sandboxed iframe): one id per page load.
    if (!memorySessionId) memorySessionId = randomId()
    return memorySessionId
  }
}

function isPrerendering(): boolean {
  return typeof document !== 'undefined' && Boolean((document as { prerendering?: boolean }).prerendering)
}

function byteLength(body: string): number {
  try {
    return new TextEncoder().encode(body).length
  } catch {
    return body.length * 3
  }
}

function send(url: string, body: string, accessToken?: string): void {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`
    fetch(url, { method: 'POST', headers, body, keepalive: true }).catch(() => {})
  } catch {
    // fetch unavailable or threw synchronously
  }
}

/** Send `events` in as few requests as fit the size limits. */
function sendBatch(queue: Queue, events: QueuedEvent[], sessionId: string): void {
  if (events.length === 0) return
  const body = JSON.stringify({ org_id: queue.orgId, session_id: sessionId, events })
  if (byteLength(body) <= MAX_BODY_BYTES) {
    send(`${getAPIUrl()}signals/batch`, body, queue.accessToken)
    return
  }
  // A single event that big is not worth sending.
  if (events.length === 1) return
  const half = Math.ceil(events.length / 2)
  sendBatch(queue, events.slice(0, half), sessionId)
  sendBatch(queue, events.slice(half), sessionId)
}

export function flushAnalytics(): void {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  // A prerendered page the visitor never opens isn't a visit. Keep the queue
  // and send it if the page is activated (see the prerenderingchange listener).
  if (isPrerendering()) return
  try {
    const sessionId = getSessionId()
    for (const [key, queue] of queues) {
      queues.delete(key)
      for (let i = 0; i < queue.events.length; i += MAX_BATCH) {
        sendBatch(queue, queue.events.slice(i, i + MAX_BATCH), sessionId)
      }
    }
  } catch {
    queues.clear()
  }
}

function scheduleFlush(): void {
  if (timer) return
  timer = setTimeout(flushAnalytics, FLUSH_INTERVAL_MS)
}

function listen(): void {
  if (listening || typeof window === 'undefined') return
  listening = true
  try {
    window.addEventListener('pagehide', flushAnalytics)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushAnalytics()
    })
    document.addEventListener('prerenderingchange', () => scheduleFlush())
  } catch {
    // no DOM events; the timer still flushes
  }
}

/**
 * Queue one event for the org analytics backend. `accessToken` is sent as
 * the Authorization header when present; without it the event counts as an
 * anonymous visitor (the API keeps only public events for those).
 */
export function trackEvent(
  eventName: string,
  orgId: number,
  properties: Record<string, unknown> = {},
  accessToken?: string,
): void {
  try {
    if (typeof window === 'undefined' || !orgId || !eventName) return
    // OSS has no signals endpoint.
    if (getDeploymentMode() === 'oss') return
    const key = `${orgId}|${accessToken ?? ''}`
    let queue = queues.get(key)
    if (!queue) {
      queue = { orgId, accessToken, events: [] }
      queues.set(key, queue)
    }
    if (queue.events.length >= MAX_QUEUED) return
    queue.events.push({ name: eventName, props: properties })
    listen()
    if (queue.events.length >= FLUSH_AT) flushAnalytics()
    else scheduleFlush()
  } catch {
    // never break the caller
  }
}
