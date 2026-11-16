'use client'

/**
 * Live unread counts for both bells, shared by every component on the page
 * and every tab of the browser.
 *
 * - One SSE stream per browser per org: tabs elect a leader with the Web
 *   Locks API; the leader holds `GET /notifications/stream` and relays events
 *   (and fresh counts) to the other tabs over a BroadcastChannel. Without
 *   Web Locks every tab streams on its own.
 * - When the stream can't be opened (no Redis, a proxy that buffers), counts
 *   are polled every minute while the tab is visible, and on focus.
 * - Components subscribe with `useNotificationCounts` (counts) and
 *   `useNotificationEvents` (new rows / changes, to refresh lists or toast).
 *
 * Nothing here needs a provider: the first mounted bell starts it, the last
 * one to unmount stops it.
 */

import { useEffect, useSyncExternalStore } from 'react'
import {
  type BothCounts,
  type NotificationItem,
  type StreamEvent,
  getCounts,
  openNotificationStream,
} from '@services/notifications/notifications'

export type LiveEvent =
  | { type: 'notification.new'; item: NotificationItem }
  | { type: 'notification.changed' }

type Snapshot = { counts: BothCounts | null; live: boolean }

const POLL_MS = 60_000
const MAX_BACKOFF_MS = 60_000

let snapshot: Snapshot = { counts: null, live: false }
const listeners = new Set<() => void>()
const eventListeners = new Set<(_e: LiveEvent) => void>()

let key: string | null = null
let refs = 0
let token: string | null = null
let orgId: number | undefined
let abort: AbortController | null = null
let channel: BroadcastChannel | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null
let countsTimer: ReturnType<typeof setTimeout> | null = null
// Bumped by every local change (mark read, archive…). A counts response that
// was requested before the latest change is stale and dropped, so a slow
// fetch or a late `hello` can never bring a cleared badge back.
let mutation = 0
let lastMutationAt = 0

function set(next: Partial<Snapshot>) {
  snapshot = { ...snapshot, ...next }
  listeners.forEach((l) => l())
}

function emit(event: LiveEvent) {
  eventListeners.forEach((l) => {
    try {
      l(event)
    } catch {
      // A broken listener shouldn't stop the others.
    }
  })
}

export async function refreshCounts(): Promise<void> {
  if (!token) return
  const started = mutation
  try {
    const counts = await getCounts(orgId, token)
    if (started !== mutation) return
    set({ counts })
    channel?.postMessage({ kind: 'counts', counts })
  } catch {
    // Keep the last counts on a network blip.
  }
}

function refreshCountsSoon() {
  if (countsTimer) clearTimeout(countsTimer)
  countsTimer = setTimeout(() => {
    countsTimer = null
    void refreshCounts()
  }, 250)
}

/** Apply a stream event in this tab (leader or follower). */
function handle(event: StreamEvent | LiveEvent | { type: 'hello'; counts: BothCounts }) {
  if (event.type === 'hello') {
    // Counts taken when the stream opened; a local change since wins.
    if (Date.now() - lastMutationAt < 5_000 && snapshot.counts) set({ live: true })
    else set({ counts: (event as any).counts, live: true })
    return
  }
  if (event.type === 'notification.new') {
    emit({ type: 'notification.new', item: (event as any).item })
    return
  }
  if (event.type === 'notification.changed') {
    emit({ type: 'notification.changed' })
  }
}

function onLeaderEvent(event: StreamEvent) {
  if (event.type === 'error') throw new Error(event.message)
  handle(event)
  channel?.postMessage({ kind: 'event', event })
  if (event.type === 'notification.new' || event.type === 'notification.changed') refreshCountsSoon()
}

async function streamLoop(signal: AbortSignal) {
  let backoff = 3_000
  while (!signal.aborted && token) {
    const started = Date.now()
    try {
      await openNotificationStream(orgId, token, onLeaderEvent, signal)
    } catch {
      // Fall through to polling until the next attempt.
    }
    if (signal.aborted) return
    set({ live: false })
    channel?.postMessage({ kind: 'live', live: false })
    if (Date.now() - started > 60_000) backoff = 3_000
    await new Promise((r) => setTimeout(r, backoff))
    backoff = Math.min(backoff * 2, MAX_BACKOFF_MS)
  }
}

function startPolling() {
  if (pollTimer) return
  pollTimer = setInterval(() => {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
    // Followers rely on the leader while it is live.
    if (snapshot.live) return
    void refreshCounts()
  }, POLL_MS)
}

function onFocus() {
  if (!snapshot.live) void refreshCounts()
}

function start(nextKey: string) {
  key = nextKey
  abort = new AbortController()
  const signal = abort.signal
  void refreshCounts()
  startPolling()
  if (typeof window !== 'undefined') window.addEventListener('focus', onFocus)
  try {
    channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(`lh-notifications:${nextKey}`) : null
  } catch {
    channel = null
  }
  if (channel) {
    channel.onmessage = (m: MessageEvent) => {
      const data = m.data || {}
      if (data.kind === 'counts') set({ counts: data.counts })
      else if (data.kind === 'live') set({ live: !!data.live })
      else if (data.kind === 'event') {
        handle(data.event)
        if (data.event?.type === 'hello') set({ live: true })
      }
    }
  }
  const locks = typeof navigator !== 'undefined' ? (navigator as any).locks : undefined
  if (locks?.request) {
    locks
      .request(`lh-notifications-stream:${nextKey}`, { signal }, () => streamLoop(signal))
      .catch(() => {})
  } else {
    void streamLoop(signal)
  }
}

function stop() {
  abort?.abort()
  abort = null
  channel?.close()
  channel = null
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = null
  if (typeof window !== 'undefined') window.removeEventListener('focus', onFocus)
  key = null
  snapshot = { counts: null, live: false }
  listeners.forEach((l) => l())
}

function acquire(nextToken: string, nextOrgId: number | undefined, userId: number) {
  token = nextToken
  orgId = nextOrgId
  const nextKey = `${userId}:${nextOrgId ?? 'all'}`
  refs += 1
  if (key !== nextKey) {
    if (key) stop()
    start(nextKey)
  }
  return () => {
    refs -= 1
    if (refs <= 0) {
      refs = 0
      // Let a remounting bell (route change) take over before tearing down.
      setTimeout(() => {
        if (refs === 0) stop()
      }, 1_000)
    }
  }
}

/** Keep the live connection open while mounted (no-op when signed out). */
export function useNotificationsLive(opts: { token?: string | null; orgId?: number; userId?: number | null }) {
  const { token: tk, orgId: org, userId } = opts
  useEffect(() => {
    if (!tk || !userId) return
    return acquire(tk, org, userId)
  }, [tk, org, userId])
}

export function useNotificationCounts(): Snapshot {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => snapshot,
    () => snapshot
  )
}

export function useNotificationEvents(listener: (_e: LiveEvent) => void) {
  useEffect(() => {
    eventListeners.add(listener)
    return () => {
      eventListeners.delete(listener)
    }
  }, [listener])
}

const EMPTY_COUNTS: BothCounts['personal'] = { unread_count: 0, unread_by_category: {}, unread_important: 0 }

function publishCounts(next: BothCounts) {
  set({ counts: next })
  channel?.postMessage({ kind: 'counts', counts: next })
}

/** Server counts for one audience after a local action (bulk / read responses). */
export function setAudienceCounts(audience: 'personal' | 'admin', counts: BothCounts['personal']) {
  mutation += 1
  lastMutationAt = Date.now()
  const base = snapshot.counts || { personal: EMPTY_COUNTS, admin: EMPTY_COUNTS }
  publishCounts({ ...base, [audience]: counts })
}

/**
 * Optimistic change before the request goes out: `all` clears the audience
 * (or one category of it); otherwise the given unread rows are taken off.
 */
export function applyLocalRead(
  audience: 'personal' | 'admin',
  change: { all?: boolean; category?: string | null; rows?: { category: string; important?: boolean }[]; delta?: 1 | -1 }
) {
  mutation += 1
  lastMutationAt = Date.now()
  const base = snapshot.counts || { personal: EMPTY_COUNTS, admin: EMPTY_COUNTS }
  const cur = base[audience] || EMPTY_COUNTS
  const by = { ...cur.unread_by_category } as Record<string, number>
  let total = cur.unread_count
  let important = cur.unread_important
  if (change.all) {
    if (change.category) {
      total -= by[change.category] || 0
      by[change.category] = 0
    } else {
      for (const k of Object.keys(by)) by[k] = 0
      total = 0
      important = 0
    }
  } else {
    const sign = change.delta ?? -1
    for (const r of change.rows || []) {
      by[r.category] = Math.max(0, (by[r.category] || 0) + sign)
      total += sign
      if (r.important) important += sign
    }
  }
  publishCounts({
    ...base,
    [audience]: { unread_count: Math.max(0, total), unread_by_category: by, unread_important: Math.max(0, important) },
  })
}
