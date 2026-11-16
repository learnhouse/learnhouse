// Room kinds the server hosts. Each kind owns its naming rule, how a socket
// is authorized, how its document is loaded and stored, how presence is
// sanitized and how many seats it has, so adding a kind never changes how
// another behaves.

import type { MembershipResponse } from './accessRecheck.js'
import type { SeatLimits } from './seats.js'

export interface RoomAuthorization {
  readOnly: boolean
  /** Stored as `context.user`; presence identity comes from here. */
  user: Record<string, unknown> & { id: number | string; name: string }
}

export interface PresenceRules {
  sanitize(
    connection: any,
    states: Map<number, Record<string, any>>,
    removedClients: Set<number>,
    claims: Map<number, any>,
    live: readonly any[],
  ): void
}

export interface RoomKind {
  /** Prefix of the document name, e.g. "activity" for `activity:{uuid}`. */
  name: string
  /** The resource uuid for a document name of this kind, or null. */
  parse(documentName: string): string | null
  /** Authorizes a verified token; throws an Error with the refusal reason. */
  authorize(resourceId: string, token: string, tokenUserId: number | string): Promise<RoomAuthorization>
  /** Raw access answer for the periodic re-check (role "viewer" = read). */
  fetchAccess(resourceId: string, token: string): Promise<MembershipResponse>
  seats: SeatLimits
  presence: PresenceRules
  /** Initial Y state, or null for an empty document. */
  fetch(resourceId: string): Promise<Uint8Array | null>
  store(resourceId: string, state: Uint8Array): Promise<unknown>
  /** Message for the close event when the document outgrows the size cap. */
  tooLargeReason: string
}

export function createRoomRegistry(kinds: RoomKind[]) {
  const byName = new Map(kinds.map((kind) => [kind.name, kind]))

  /** The kind and resource uuid of a document name, or null if none matches. */
  function resolve(documentName: string): { kind: RoomKind; resourceId: string } | null {
    const prefix = documentName.split(':', 1)[0]
    const kind = byName.get(prefix)
    if (!kind) return null
    const resourceId = kind.parse(documentName)
    return resourceId ? { kind, resourceId } : null
  }

  function kind(name: string): RoomKind | undefined {
    return byName.get(name)
  }

  return { resolve, kind }
}

export type RoomRegistry = ReturnType<typeof createRoomRegistry>
