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

/**
 * One or two letters for an avatar: the first letters of the first and last
 * words of the name. Labels in brackets ("Ada (Support)") and punctuation are
 * skipped, so a name never shows as "A(".
 */
export function initials(name: string): string {
  const words = String(name ?? '')
    .replace(/[([{][^)\]}]*[)\]}]?/g, ' ')
    .split(/\s+/)
    .map((w) => Array.from(w).filter((c) => /[\p{L}\p{N}]/u.test(c)).join(''))
    .filter(Boolean)
  if (words.length === 0) return '?'
  const first = Array.from(words[0])[0]
  const last = words.length > 1 ? Array.from(words[words.length - 1])[0] : ''
  return (first + last).toUpperCase()
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

// ── Joining the room: what went wrong and what to do next ──────────────────

/**
 * Why joining the live room failed:
 * - refused:        the collab server refused this user although the API let
 *                   them load the editor (REST editing still works)
 * - forbidden:      the API says they may not edit this activity
 * - unavailable:    could not be checked or reached right now (retry)
 * - disabled:       live editing is turned off for the org or activity
 * - not_configured: collaboration is not set up on this server
 * - other:          anything else (plan without collaboration, no session…)
 */
export type CollabFailureKind = 'refused' | 'forbidden' | 'unavailable' | 'disabled' | 'not_configured' | 'other'

export class CollabStartError extends Error {
  readonly kind: CollabFailureKind

  constructor(kind: CollabFailureKind, message: string) {
    super(message)
    this.name = 'CollabStartError'
    this.kind = kind
  }
}

/** Refusal reasons the collab server sends (apps/collab/src/authRefusal.ts). */
const RETRYABLE_AUTH_REASONS = new Set(['auth-unavailable', 'invalid-token', 'room-full'])

/**
 * The collab server's authentication refusal: "could not check" reasons (and a
 * stale token, which the next attempt replaces) are worth retrying; anything
 * else, older servers' "permission-denied" included, is a refusal.
 */
export function authFailureKind(reason: string | undefined | null): 'refused' | 'unavailable' {
  return reason && RETRYABLE_AUTH_REASONS.has(reason) ? 'unavailable' : 'refused'
}

/** The failure for the editor's own access check (GET …/collab/access), null when it passed. */
export function accessResponseKind(status: number, detail?: unknown): CollabFailureKind | null {
  if (status >= 200 && status < 300) return null
  if (status === 503) return 'not_configured'
  if (status === 403 && detail === 'collab_disabled') return 'disabled'
  if (status === 403 && detail === 'Not allowed to edit this activity') return 'forbidden'
  if (status >= 500 || status === 429 || status === 408) return 'unavailable'
  return 'other'
}

/** The failure kind of anything joining threw (network errors are "unavailable"). */
export function failureKindOf(err: unknown): CollabFailureKind {
  if (err instanceof CollabStartError) return err.kind
  if (err instanceof TypeError) return 'unavailable' // fetch could not reach the API
  return 'other'
}

/** Waits between attempts while the room can't be reached; then live editing gives up. */
export const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 15000] as const

export type CollabNextStep =
  | { retryIn: number }
  /** Edit without the room, saving manually. */
  | { fallback: 'refused' | 'unreachable' }
  /** Show the content read-only. */
  | { forbidden: true }
  | { disabled: true }
  /** No live editing here (autosave mode, as before). */
  | { unavailable: string }

/** What to do after attempt number `attempt` (0-based) failed with `kind`. */
export function nextCollabStep(kind: CollabFailureKind, attempt: number, message: string = kind): CollabNextStep {
  switch (kind) {
    case 'unavailable':
      return attempt < RETRY_DELAYS_MS.length ? { retryIn: RETRY_DELAYS_MS[attempt] } : { fallback: 'unreachable' }
    case 'refused':
      return { fallback: 'refused' }
    case 'forbidden':
      return { forbidden: true }
    case 'disabled':
      return { disabled: true }
    case 'not_configured':
      return { unavailable: 'not configured' }
    default:
      return { unavailable: message }
  }
}

/** The join loop's outcome when it stops (live, or given up). */
export type CollabJoinOutcome<S> =
  | { phase: 'live'; session: S }
  | { phase: 'fallback'; reason: 'refused' | 'unreachable' }
  | { phase: 'forbidden' }
  | { phase: 'disabled' }
  | { phase: 'unavailable'; reason: string }

/**
 * Runs `join` until it succeeds or nextCollabStep gives up, reporting each
 * retry through `onRetry` (1-based attempt about to run). Resolves with the
 * outcome, or null once `isCancelled()` turns true.
 */
export async function joinWithRetry<S>(opts: {
  join: () => Promise<S>
  onRetry: (_attempt: number) => void
  sleep: (_ms: number) => Promise<void>
  isCancelled: () => boolean
}): Promise<CollabJoinOutcome<S> | null> {
  for (let attempt = 0; !opts.isCancelled(); attempt++) {
    try {
      const session = await opts.join()
      return opts.isCancelled() ? null : { phase: 'live', session }
    } catch (err) {
      if (opts.isCancelled()) return null
      const message = err instanceof Error ? err.message : 'failed'
      const step = nextCollabStep(failureKindOf(err), attempt, message)
      if ('retryIn' in step) {
        opts.onRetry(attempt + 1)
        await opts.sleep(step.retryIn)
        continue
      }
      if ('fallback' in step) return { phase: 'fallback', reason: step.fallback }
      if ('forbidden' in step) return { phase: 'forbidden' }
      if ('disabled' in step) return { phase: 'disabled' }
      return { phase: 'unavailable', reason: step.unavailable }
    }
  }
  return null
}

/** Which notice the editor shows for the join state (null: none). */
export function collabNoticeKind(
  state: { phase: string },
  live: boolean,
): 'reconnecting' | 'manual' | 'forbidden' | null {
  if (live) return null
  if (state.phase === 'reconnecting') return 'reconnecting'
  if (state.phase === 'fallback') return 'manual'
  if (state.phase === 'forbidden') return 'forbidden'
  return null
}
