// Seats and presence rules for a board.
//
// Read-only viewers used to share the editors' seats, so anyone allowed to
// view a public board could fill them and lock its editors out. Viewers and
// editors now have separate seats, and one socket can only hold a couple of
// sessions on the same board.
//
// Presence (awareness) states are client-supplied and relayed as-is by
// default, so a connection could publish another member's name or remove
// other people's cursors. The sanitizer pins each awareness client id to the
// connection that first used it and stamps the name from the authenticated
// user.

export const MAX_BOARD_EDITORS = 10
export const MAX_BOARD_VIEWERS = 10
export const MAX_SESSIONS_PER_SOCKET = 2

export interface SeatHolder {
  readOnly: boolean
  socketId: string
}

/** Why a new connection can't join the board, or null when it can. */
export function seatRefusal(
  existing: Iterable<SeatHolder>,
  joining: { readOnly: boolean; socketId: string },
): string | null {
  let sameSocket = 0
  let viewers = 0
  let editors = 0
  for (const c of existing) {
    if (c.socketId === joining.socketId) sameSocket++
    if (c.readOnly) viewers++
    else editors++
  }
  if (sameSocket >= MAX_SESSIONS_PER_SOCKET) return 'Too many sessions for this board on one connection'
  if (joining.readOnly) {
    return viewers >= MAX_BOARD_VIEWERS ? `Board is full (max ${MAX_BOARD_VIEWERS} viewers)` : null
  }
  return editors >= MAX_BOARD_EDITORS ? `Board is full (max ${MAX_BOARD_EDITORS} concurrent users)` : null
}

export interface PresenceConnection {
  readOnly: boolean
  context?: { user?: { name?: string } } | undefined
}

/**
 * Rewrites an inbound awareness update in place.
 *
 * `claims` maps awareness client ids to the connection that owns them, per
 * document. `live` lists the document's open connections, so an id left by a
 * closed connection (a client reconnecting keeps its id) can be claimed again.
 */
export function sanitizeAwareness<C extends PresenceConnection>(
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

  for (const [clientId, state] of states) {
    if (ownedByOther(clientId)) {
      states.delete(clientId)
      continue
    }
    claims.set(clientId, connection)
    if (state.user && typeof state.user === 'object') {
      state.user = { ...state.user, name: connection.context?.user?.name || 'Unknown' }
    }
    // Viewers can't post to the board chat, so they can't float bubbles either
    if (connection.readOnly && 'chatBubble' in state) {
      state.chatBubble = null
    }
  }

  for (const clientId of [...removedClients]) {
    if (ownedByOther(clientId)) {
      removedClients.delete(clientId)
    } else {
      claims.delete(clientId)
    }
  }
}
