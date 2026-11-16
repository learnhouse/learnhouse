// Pure helpers for collaborative editing: connection status, presence list,
// caret throttling. No Yjs or provider imports, so they are cheap to import
// anywhere and easy to test.

export type CollabConnection = 'connecting' | 'connected' | 'disconnected'

/** What the status pill shows. */
export type CollabStatus = 'live' | 'saving' | 'saved' | 'reconnecting' | 'readonly' | 'error'

export interface CollabUser {
  id: number
  name: string
  color: string
  /** Avatar file name or absolute URL, as the API gave it. */
  avatar: string | null
  uuid: string | null
}

export interface CollabPeer extends CollabUser {
  /** Awareness client ids of this user (several tabs). */
  clientIds: number[]
  idle: boolean
}

export interface CollabSnapshot {
  connection: CollabConnection
  synced: boolean
  readOnly: boolean
  /** Local edits not yet acknowledged by the server. */
  unsynced: number
  /** Local edits the server has not confirmed as saved to the database. */
  unsaved: boolean
  saveFailed: boolean
  /** Activity version of the last save the client heard of. */
  version: number | null
  lastSavedAt: number | null
  peers: CollabPeer[]
  /** Set when the server closed the room for good (access revoked, too large, live editing turned off). */
  terminal: 'access_revoked' | 'too_large' | 'disabled' | null
}

export const INITIAL_SNAPSHOT: CollabSnapshot = {
  connection: 'connecting',
  synced: false,
  readOnly: false,
  unsynced: 0,
  unsaved: false,
  saveFailed: false,
  version: null,
  lastSavedAt: null,
  peers: [],
  terminal: null,
}

/** The pill's state, most important first. */
export function deriveStatus(s: CollabSnapshot): CollabStatus {
  if (s.terminal) return 'error'
  if (s.connection !== 'connected' || !s.synced) return 'reconnecting'
  if (s.readOnly) return 'readonly'
  if (s.saveFailed) return 'saving'
  if (s.unsynced > 0 || s.unsaved) return 'saving'
  return s.lastSavedAt ? 'saved' : 'live'
}

/**
 * True while leaving the page would lose edits: some are not on the server
 * yet (offline, or still in flight). Edits the server has but not saved yet
 * are safe: the server saves them when the last editor leaves.
 */
export function hasUnsyncedEdits(s: CollabSnapshot): boolean {
  return !s.readOnly && (s.unsynced > 0 || (s.unsaved && s.connection !== 'connected'))
}

/**
 * Other people in the room from awareness states: one entry per user (a user
 * with two tabs appears once), the current user left out, stable order.
 */
export function presenceList(
  states: Map<number, Record<string, any>>,
  selfClientId: number,
  selfUserId: number,
): CollabPeer[] {
  const byUser = new Map<number, CollabPeer>()
  for (const [clientId, state] of states) {
    if (clientId === selfClientId) continue
    const user = state?.user
    if (!user || typeof user.id !== 'number' || user.id === selfUserId || user.id <= 0) continue
    const existing = byUser.get(user.id)
    const idle = state.idle === true
    if (existing) {
      existing.clientIds.push(clientId)
      existing.idle = existing.idle && idle
      continue
    }
    byUser.set(user.id, {
      id: user.id,
      name: typeof user.name === 'string' ? user.name : '',
      color: typeof user.color === 'string' ? user.color : '#64748b',
      avatar: typeof user.avatar === 'string' ? user.avatar : null,
      uuid: typeof user.uuid === 'string' ? user.uuid : null,
      clientIds: [clientId],
      idle,
    })
  }
  return [...byUser.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id)
}

export function samePeers(a: CollabPeer[], b: CollabPeer[]): boolean {
  if (a.length !== b.length) return false
  return a.every((p, i) => {
    const q = b[i]
    return p.id === q.id && p.idle === q.idle && p.name === q.name && p.clientIds.join() === q.clientIds.join()
  })
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  return ((parts[0][0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

/**
 * Wraps a setter so it runs at most once per `intervalMs`, always delivering
 * the latest value (trailing call). Used for the caret position, which would
 * otherwise go out on every keystroke.
 */
export function createThrottle<T>(
  apply: (_value: T) => void,
  intervalMs: number,
  now: () => number = () => Date.now(),
  schedule: (_fn: () => void, _ms: number) => unknown = setTimeout,
  cancel: (_handle: any) => void = clearTimeout,
) {
  let last = -Infinity
  let pending: { value: T } | null = null
  let timer: unknown = null
  const flush = () => {
    timer = null
    if (!pending) return
    const { value } = pending
    pending = null
    last = now()
    apply(value)
  }
  const call = (value: T) => {
    const elapsed = now() - last
    if (elapsed >= intervalMs && timer === null) {
      last = now()
      apply(value)
      return
    }
    pending = { value }
    if (timer === null) timer = schedule(flush, Math.max(0, intervalMs - elapsed))
  }
  call.cancel = () => {
    if (timer !== null) cancel(timer)
    timer = null
    pending = null
  }
  return call
}

/** Close events after which reconnecting cannot help. */
export function terminalCloseOf(event: { code?: number; reason?: string } | undefined): CollabSnapshot['terminal'] {
  if (!event) return null
  if (event.code === 4403 || event.reason === 'Access revoked') return 'access_revoked'
  if (event.code === 4413 || event.reason === 'Activity is too large') return 'too_large'
  if (event.code === 4409 || event.reason === 'Live editing disabled') return 'disabled'
  return null
}

/** Whether the client's own edits are all in a save, from the server's state vector. */
export function editsSaved(savedClock: number | undefined, ownClock: number): boolean {
  return (savedClock ?? 0) >= ownClock
}
