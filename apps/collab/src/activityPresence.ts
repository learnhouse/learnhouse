// Presence rules for an activity editor room.
//
// Awareness states are client-supplied and relayed as-is by default. In an
// activity room a state may only carry who the user is (stamped from the
// authenticated connection, never from the client), where their caret is and
// a couple of small UI flags. Anything else is dropped, so presence can't be
// used to spoof another member or to relay arbitrary data to every editor.

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
 * identity forced from the connection.
 */
export function sanitizeActivityAwareness<C extends ActivityPresenceConnection>(
  connection: C,
  states: Map<number, Record<string, any>>,
  removedClients: Set<number>,
  claims: Map<number, C>,
  live: readonly C[],
): void {
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
