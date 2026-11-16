// Why a socket was refused at authentication. Hocuspocus sends a thrown
// error's `reason` to the client (and "permission-denied" when there is
// none), so every refusal carries one of these: the editor tells "you may not
// edit this" (stop, edit without the room) apart from "we could not check"
// (try again shortly).

export const AUTH_REFUSAL = {
  /** The API refused this user (or the room does not exist for them). */
  refused: 'access-refused',
  /** The API could not be asked (down, timing out, 5xx, rate limited). */
  unavailable: 'auth-unavailable',
  /** Missing, malformed or expired token: a fresh one may pass. */
  invalidToken: 'invalid-token',
  /** No seat left in the room right now. */
  roomFull: 'room-full',
} as const

export type AuthRefusalReason = (typeof AUTH_REFUSAL)[keyof typeof AUTH_REFUSAL]

const REASONS = new Set<string>(Object.values(AUTH_REFUSAL))

/** An authentication refusal: `message` for the logs, `reason` for the client. */
export class AuthRefusal extends Error {
  readonly reason: AuthRefusalReason

  constructor(reason: AuthRefusalReason, message: string) {
    super(message)
    this.name = 'AuthRefusal'
    this.reason = reason
  }
}

/**
 * The refusal for anything a room kind's `authorize` threw. Kinds that don't
 * set a reason (plugins) are read as a refusal, except the shared
 * "Authentication service unavailable" message.
 */
export function asAuthRefusal(err: unknown): AuthRefusal {
  if (err instanceof AuthRefusal) return err
  const reason = (err as { reason?: unknown } | null)?.reason
  const message = err instanceof Error ? err.message : String(err ?? 'Not authorized')
  if (typeof reason === 'string' && REASONS.has(reason)) return new AuthRefusal(reason as AuthRefusalReason, message)
  if (message === 'Authentication service unavailable') return new AuthRefusal(AUTH_REFUSAL.unavailable, message)
  return new AuthRefusal(AUTH_REFUSAL.refused, message)
}

/** Whether an access endpoint's HTTP status means "could not check" rather than "no". */
export function isUnavailableStatus(status: number): boolean {
  return status >= 500 || status === 429 || status === 408
}
