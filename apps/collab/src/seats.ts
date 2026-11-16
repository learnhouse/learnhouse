// Seats per room. Viewers and editors have separate seats, so anyone allowed
// to view a room can't fill it and lock its editors out, and one socket can
// only hold a couple of sessions on the same document. Each room kind sets
// its own limits (`RoomKind.seats`).

export const MAX_SESSIONS_PER_SOCKET = 2

export interface SeatHolder {
  readOnly: boolean
  socketId: string
}

export interface SeatLimits {
  editors: number
  viewers: number
  /** What the room is called in refusal messages. */
  noun: string
}

/** Why a new connection can't join the room, or null when it can. */
export function seatRefusal(
  existing: Iterable<SeatHolder>,
  joining: { readOnly: boolean; socketId: string },
  limits: SeatLimits,
): string | null {
  let sameSocket = 0
  let viewers = 0
  let editors = 0
  for (const c of existing) {
    if (c.socketId === joining.socketId) sameSocket++
    if (c.readOnly) viewers++
    else editors++
  }
  if (sameSocket >= MAX_SESSIONS_PER_SOCKET) {
    return `Too many sessions for this ${limits.noun.toLowerCase()} on one connection`
  }
  if (joining.readOnly) {
    return viewers >= limits.viewers ? `${limits.noun} is full (max ${limits.viewers} viewers)` : null
  }
  return editors >= limits.editors
    ? `${limits.noun} is full (max ${limits.editors} concurrent users)`
    : null
}
