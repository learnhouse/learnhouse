// Access is checked when a socket authenticates, but a member removed from a
// board (or an org, or whose session ended) would otherwise keep editing for
// as long as the socket stays open. The server re-runs the access check for
// every open connection on an interval and acts on the answer.

/**
 * "expired" means the token the socket authenticated with can no longer be
 * used to re-check; the client must reconnect with a fresh one. "unknown"
 * means the check itself failed (API unreachable or erroring).
 */
export type AccessVerdict = 'write' | 'read' | 'denied' | 'expired' | 'unknown'

export interface RecheckableConnection {
  readOnly: boolean
  context: unknown
  close(event?: { code: number; reason: string }): void
  webSocket: { close(code?: number, reason?: string): void }
}

export interface ConnectionAuth {
  token: string
  boardUuid: string
  /** When access was last confirmed (ms epoch); updated by each re-check. */
  verifiedAt: number
}

/** Terminal: the client must not reconnect. */
export const ACCESS_REVOKED = { code: 4403, reason: 'Access revoked' }
/** Reconnectable: the client reconnects and authenticates with a fresh token. */
export const REAUTH_REQUIRED = { code: 4401, reason: 'Token expired' }

/**
 * "expired" covers tokens that lapsed (or are about to) since the socket
 * authenticated; "invalid" is anything that never verified.
 */
export type TokenState = 'valid' | 'expired' | 'invalid'

export interface MembershipResponse {
  ok: boolean
  status: number
  json(): Promise<unknown>
}

/**
 * Builds the per-connection access check. The only credential we hold is the
 * user's token from connect time; once it expires the API can no longer answer
 * for that user, so the verdict is "expired" and the socket is closed with a
 * reconnectable code (the client comes back with a fresh token, which is
 * checked like any new connection). Explicit 401/403/404 answers for a token
 * that is still valid are a terminal denial.
 */
export function createAccessChecker(deps: {
  tokenState: (token: string) => TokenState
  fetchMembership: (boardUuid: string, token: string) => Promise<MembershipResponse>
}): (auth: ConnectionAuth) => Promise<AccessVerdict> {
  return async ({ token, boardUuid }) => {
    const before = deps.tokenState(token)
    if (before === 'invalid') return 'denied'
    if (before === 'expired') return 'expired'

    let response: MembershipResponse
    try {
      response = await deps.fetchMembership(boardUuid, token)
    } catch {
      return 'unknown'
    }
    if (response.status === 401) {
      // The token may have lapsed while the request was in flight
      return deps.tokenState(token) === 'valid' ? 'denied' : 'expired'
    }
    if (response.status === 403 || response.status === 404) return 'denied'
    if (!response.ok) return 'unknown'

    let membership: { role?: unknown } | null
    try {
      membership = (await response.json()) as { role?: unknown } | null
    } catch {
      return 'unknown'
    }
    return membership?.role === 'viewer' ? 'read' : 'write'
  }
}

/** Detaches the connection from its document, then closes its socket. */
export function dropConnection(
  connection: RecheckableConnection,
  event: { code: number; reason: string },
) {
  connection.close(event)
  connection.webSocket.close(event.code, event.reason)
}

function authOf(connection: RecheckableConnection): ConnectionAuth | null {
  const auth = (connection.context as { auth?: ConnectionAuth } | null)?.auth
  return auth &&
    typeof auth.token === 'string' &&
    typeof auth.boardUuid === 'string' &&
    typeof auth.verifiedAt === 'number'
    ? auth
    : null
}

export interface RecheckOptions {
  /**
   * Longest a connection may stay open without a successful check. Past it, a
   * failed check closes the socket with the reconnectable code, so an API
   * outage can't keep a revoked user connected indefinitely.
   */
  maxUnverifiedMs: number
  now?: () => number
}

/**
 * Re-checks each connection: closes those that lost access (terminal), closes
 * those whose access can't be confirmed any more (reconnectable), and moves
 * the rest between read-only and read-write to match their current role.
 * Returns the number of connections closed.
 */
export async function recheckConnections(
  connections: RecheckableConnection[],
  check: (auth: ConnectionAuth) => Promise<AccessVerdict>,
  { maxUnverifiedMs, now = Date.now }: RecheckOptions,
): Promise<number> {
  let closed = 0
  await Promise.all(
    connections.map(async (connection) => {
      const auth = authOf(connection)
      const verdict = auth ? await check(auth) : 'denied'
      if (verdict === 'denied') {
        dropConnection(connection, ACCESS_REVOKED)
        closed++
        return
      }
      if (verdict === 'expired') {
        dropConnection(connection, REAUTH_REQUIRED)
        closed++
        return
      }
      if (verdict === 'unknown') {
        if (auth && now() - auth.verifiedAt > maxUnverifiedMs) {
          dropConnection(connection, REAUTH_REQUIRED)
          closed++
        }
        return
      }
      if (auth) auth.verifiedAt = now()
      connection.readOnly = verdict === 'read'
    }),
  )
  return closed
}
