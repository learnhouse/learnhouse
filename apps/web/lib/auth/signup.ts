// Small pure helpers for the signup forms (unit-tested in tests/signup-simple.test.mjs).

/** "Ada Lovelace" → first "Ada", last "Lovelace". One optional name field
 *  replaces the first/last pair; everything after the first word is the last name. */
export function splitFullName(full: string): { first_name: string; last_name: string } {
  const parts = (full || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return { first_name: '', last_name: '' }
  return { first_name: parts[0], last_name: parts.slice(1).join(' ') }
}

/** Usernames are never asked: one is made from the email (the server keeps
 *  them unique; the profile can change it later). */
export function usernameFromEmail(email: string, rand: () => number = Math.random): string {
  const base = (email.split('@')[0] || 'user').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20)
  const padded = base.length >= 4 ? base : `${base}user`.slice(0, 8)
  return `${padded}${Math.floor(1000 + rand() * 9000)}`
}

/** The invitation token from the email link (`/signup?invite=…`), or null.
 *  A link pasted from chat often picks up a closing bracket, quote or full
 *  stop: those never belong to a token, so they are dropped. */
export function inviteTokenFrom(value: string | null | undefined): string | null {
  const v = (value || '').trim().replace(/^[<("'[{«]+/, '').replace(/[.,;:!?)\]}>"'»]+$/, '')
  return /^[A-Za-z0-9_-]{32,128}$/.test(v) ? v : null
}

/** `?invite=` is there (even blank) but is no token, even trimmed: the page
 *  says the link is broken instead of asking for an invite code. */
export function isMalformedInviteParam(value: string | null | undefined): boolean {
  return value !== null && value !== undefined && inviteTokenFrom(value) === null
}

/** The org has no seat left (any MEMBER_LIMIT_* code, including the
 *  invitee-facing variant): the invitee can't upgrade, only ask the admin. */
export function isMemberLimitError(detail: unknown): boolean {
  const code = detail && typeof detail === 'object' ? (detail as any).code : null
  return typeof code === 'string' && code.startsWith('MEMBER_LIMIT')
}

/** What the invitation page does with a peek answer: 404 (or another refusal
 *  a retry can't fix) means the link is gone; no answer, 429 or 5xx is worth
 *  another try. */
export type InvitePeekOutcome = 'pending' | 'accepted' | 'invalid' | 'retry'

export function invitePeekOutcome(res: { ok: boolean; status?: number; data?: { status?: string } | null }): InvitePeekOutcome {
  if (res.ok) return res.data?.status === 'accepted' ? 'accepted' : 'pending'
  const status = res.status ?? 0
  if (status >= 400 && status < 500 && status !== 408 && status !== 429) return 'invalid'
  return 'retry'
}

/** Whether the session's roles include the org. */
export function isOrgMember(roles: unknown, orgId: number | null | undefined): boolean {
  if (!orgId || !Array.isArray(roles)) return false
  return roles.some((r: any) => r?.org?.id === orgId)
}

/**
 * What an already accepted invitation link shows: a member goes on to the org,
 * someone signed in who isn't a member (removed since, or another account)
 * sees that the link was used, and a visitor is asked to sign in.
 */
export function acceptedInvitePhase(
  signedIn: boolean,
  roles: unknown,
  orgId: number | null | undefined,
): 'to_org' | 'invalid' | 'accepted' {
  if (!signedIn) return 'accepted'
  return isOrgMember(roles, orgId) ? 'to_org' : 'invalid'
}

/** Where to send someone who already has an account: the org's own sign-in,
 *  coming back to the invitation once signed in. */
export function inviteSignInHref(token: string): string {
  return `/login?next=${encodeURIComponent(`/signup?invite=${token}`)}`
}

// The invite page hands the invited address to the sign-in form through
// sessionStorage, never the URL.
const LOGIN_HINT_KEY = 'lh:login_hint'

export function setLoginHint(email: string): void {
  try {
    sessionStorage.setItem(LOGIN_HINT_KEY, email)
  } catch {
    /* private mode: the field just starts empty */
  }
}

export function takeLoginHint(): string {
  try {
    const v = sessionStorage.getItem(LOGIN_HINT_KEY) || ''
    sessionStorage.removeItem(LOGIN_HINT_KEY)
    return v
  } catch {
    return ''
  }
}

// Fallback for the page to land on after verifying, kept on this host for a
// day in case the destination stored with the verification token is missing
// (an older email, a resend from another device).
const POST_AUTH_NEXT_KEY = 'lh:post_auth_next'
const POST_AUTH_NEXT_TTL = 24 * 60 * 60 * 1000

export function isSafeNextPath(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 512 && /^\/(?![/\\])[^\s\\]*$/.test(value)
}

export function rememberPostAuthNext(next: string | null | undefined, now = Date.now()): void {
  if (!isSafeNextPath(next)) return
  try {
    localStorage.setItem(POST_AUTH_NEXT_KEY, JSON.stringify({ next, at: now }))
  } catch {
    /* storage off: the server-side copy still works */
  }
}

/** The remembered destination, left in place (sign-in reads it per attempt). */
export function peekPostAuthNext(now = Date.now()): string | null {
  try {
    const raw = localStorage.getItem(POST_AUTH_NEXT_KEY)
    const v = raw ? JSON.parse(raw) : null
    return v && now - v.at < POST_AUTH_NEXT_TTL && isSafeNextPath(v.next) ? v.next : null
  } catch {
    return null
  }
}

/** The remembered destination, used up (after verifying or signing in). */
export function takePostAuthNext(now = Date.now()): string | null {
  const next = peekPostAuthNext(now)
  try {
    localStorage.removeItem(POST_AUTH_NEXT_KEY)
  } catch {
    /* nothing stored */
  }
  return next
}
