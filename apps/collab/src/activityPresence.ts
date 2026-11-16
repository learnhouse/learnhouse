// Presence rules for an activity editor room.
//
// Awareness states are client-supplied and relayed as-is by default. In an
// activity room a state may only carry who the user is (stamped from the
// authenticated connection, never from the client), where their caret is,
// where their mouse pointer is and a couple of small UI flags. Anything else
// is dropped, so presence can't be used to spoof another member or to relay
// arbitrary data to every editor.
//
// Presence lives only in this process's memory (Hocuspocus keeps the latest
// state per client and relays each change once to the room): it is never
// stored, never reaches Redis and never touches the document, so it can't
// trigger a save. Each update is relayed to every other connection, so a
// connection's awareness rate is capped here: well above what the editor
// sends (about 15 a second while the mouse moves), low enough that one
// misbehaving client can't make the server flood the room.

import type { SeatLimits } from './seats.js'

export const ACTIVITY_SEATS: SeatLimits = { editors: 50, viewers: 50, noun: 'Activity' }

/** Identity the server stamps into every awareness state of a connection. */
export interface PresenceUser {
  id: number
  name: string
  color: string
  avatar: string | null
  uuid: string | null
}

export interface ActivityPresenceConnection {
  readOnly: boolean
  context?: { user?: Partial<PresenceUser> } | undefined
}

// y-prosemirror's caret: {anchor, head} as encoded Y relative positions.
const MAX_CURSOR_BYTES = 2048
// Small UI flags the editor shares (idle, typing): booleans only.
const ALLOWED_FLAGS = ['idle', 'typing'] as const

/**
 * Mouse pointer anchored to the document: `b` is the index of the top-level
 * block under it, `x` a fraction of the content width and `y` a fraction of
 * that block's height (so it lines up across window widths). Over text it
 * also carries `p`, the document position of the character under it, with a
 * small pixel offset (`dx`, `dy`). The bounds are loose (a pointer can sit in
 * the margins) but keep the numbers small.
 */
export const POINTER_LIMITS = { maxBlock: 100_000, minX: -1, maxX: 2, minY: -10, maxY: 10, maxPos: 10_000_000, maxOffset: 64 }

/** Awareness updates one connection may send: a burst, then a steady rate. */
export const AWARENESS_BURST = 40
export const AWARENESS_PER_SECOND = 25

type Pointer = { b: number; x: number; y: number; p?: number; dx?: number; dy?: number }

function sanitizePointer(pointer: unknown): Pointer | null {
  if (!pointer || typeof pointer !== 'object' || Array.isArray(pointer)) return null
  const { b, x, y } = pointer as Record<string, unknown>
  const inRange = (v: unknown, min: number, max: number): v is number =>
    typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max
  if (!Number.isInteger(b) || !inRange(b, 0, POINTER_LIMITS.maxBlock)) return null
  if (!inRange(x, POINTER_LIMITS.minX, POINTER_LIMITS.maxX) || !inRange(y, POINTER_LIMITS.minY, POINTER_LIMITS.maxY)) {
    return null
  }
  const out: Pointer = { b, x, y }
  const { p, dx, dy } = pointer as Record<string, unknown>
  const offset = (v: unknown) => (inRange(v, -POINTER_LIMITS.maxOffset, POINTER_LIMITS.maxOffset) ? v : 0)
  if (Number.isInteger(p) && inRange(p, 0, POINTER_LIMITS.maxPos)) {
    out.p = p
    out.dx = offset(dx)
    out.dy = offset(dy)
  }
  return out
}

/**
 * Token bucket per connection: `allow` spends one token per awareness update
 * and refills `perSecond` tokens a second up to `burst`. Keyed weakly, so a
 * closed connection's bucket goes with it.
 */
export function createAwarenessLimiter(
  burst = AWARENESS_BURST,
  perSecond = AWARENESS_PER_SECOND,
  now: () => number = () => Date.now(),
) {
  const buckets = new WeakMap<object, { tokens: number; at: number }>()
  return {
    allow(connection: object): boolean {
      const t = now()
      const bucket = buckets.get(connection) ?? { tokens: burst, at: t }
      bucket.tokens = Math.min(burst, bucket.tokens + ((t - bucket.at) / 1000) * perSecond)
      bucket.at = t
      buckets.set(connection, bucket)
      if (bucket.tokens < 1) return false
      bucket.tokens -= 1
      return true
    },
  }
}

export type AwarenessLimiter = ReturnType<typeof createAwarenessLimiter>

const sharedLimiter = createAwarenessLimiter()

function sanitizeCursor(cursor: unknown): Record<string, unknown> | null {
  if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor)) return null
  const { anchor, head } = cursor as Record<string, unknown>
  if (!anchor || typeof anchor !== 'object' || !head || typeof head !== 'object') return null
  const out = { anchor, head }
  try {
    if (JSON.stringify(out).length > MAX_CURSOR_BYTES) return null
  } catch {
    return null
  }
  return out
}

/** The user an activity connection is allowed to present as. */
export function presenceUserOf(connection: ActivityPresenceConnection): PresenceUser {
  const user = connection.context?.user ?? {}
  return {
    id: typeof user.id === 'number' ? user.id : 0,
    name: typeof user.name === 'string' && user.name ? user.name : 'Unknown',
    color: typeof user.color === 'string' ? user.color : '#64748b',
    avatar: typeof user.avatar === 'string' ? user.avatar : null,
    uuid: typeof user.uuid === 'string' ? user.uuid : null,
  }
}

/**
 * Rewrites an inbound awareness update in place:
 * client ids are pinned to the connection that first used them (a live owner
 * keeps them), and each state is reduced to the allowed shape with the
 * identity forced from the connection. Read-only connections (viewers, and
 * read-only impersonation) don't share a mouse pointer. Past the connection's
 * rate the new states are dropped (removals still go through); the client's
 * next update carries its whole state, so the room catches up.
 */
export function sanitizeActivityAwareness<C extends ActivityPresenceConnection>(
  connection: C,
  states: Map<number, Record<string, any>>,
  removedClients: Set<number>,
  claims: Map<number, C>,
  live: readonly C[],
  limiter: AwarenessLimiter = sharedLimiter,
): void {
  if (states.size > 0 && !limiter.allow(connection)) states.clear()
  const ownedByOther = (clientId: number) => {
    const owner = claims.get(clientId)
    return owner !== undefined && owner !== connection && live.includes(owner)
  }
  const user = presenceUserOf(connection)

  for (const [clientId, state] of states) {
    if (ownedByOther(clientId)) {
      states.delete(clientId)
      continue
    }
    claims.set(clientId, connection)
    const clean: Record<string, any> = { user: { ...user } }
    const cursor = sanitizeCursor(state?.cursor)
    if (cursor) clean.cursor = cursor
    const pointer = connection.readOnly ? null : sanitizePointer(state?.pointer)
    if (pointer) clean.pointer = pointer
    for (const flag of ALLOWED_FLAGS) {
      if (typeof state?.[flag] === 'boolean') clean[flag] = state[flag]
    }
    states.set(clientId, clean)
  }

  for (const clientId of [...removedClients]) {
    if (ownedByOther(clientId)) {
      removedClients.delete(clientId)
    } else {
      claims.delete(clientId)
    }
  }
}
