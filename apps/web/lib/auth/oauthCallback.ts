// Where the Google OAuth callback page sends people: its error buttons, the
// 2FA handoff and the landing after an invitation was accepted. The callback
// often runs on the platform domain, so relative links would lose the org and
// the invitation. Pure, unit-tested in tests/invite-join-flow.test.mjs.
import { platformOrgSlug } from './oauthBounce'
import { isSafeNextPath } from './signup'
import { isInviteSignupPath, withNextParam } from './nextParam'

export type CallbackTargets = { origin: string; next: string | null }

/**
 * Origin and `next` of the sign-in's callbackUrl (`{origin}/redirect_from_auth?next=…`).
 * Only an origin we can stand behind is used: this page's own, the signed
 * return origin, or an org subdomain of the platform. Anything else falls back
 * to this page with no destination.
 */
export function callbackTargets(
  callbackUrl: string | null | undefined,
  currentOrigin: string,
  platformDomain: string,
  trustedOrigin?: string | null,
): CallbackTargets {
  const fallback = { origin: currentOrigin, next: null }
  if (!callbackUrl) return fallback
  let url: URL
  try {
    url = new URL(callbackUrl, currentOrigin)
  } catch {
    return fallback
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return fallback
  const host = url.host.toLowerCase()
  const allowed =
    url.origin === currentOrigin ||
    (!!trustedOrigin && url.origin === trustedOrigin) ||
    (!!platformDomain && (host === platformDomain.toLowerCase() || platformOrgSlug(host, platformDomain) !== null))
  if (!allowed) return fallback
  const next = url.searchParams.get('next')
  return { origin: url.origin, next: isSafeNextPath(next) ? next : null }
}

/** "Try again" goes back to the invitation page when there was one, else to sign-in. */
export function callbackRetryHref(targets: CallbackTargets): string {
  const path = isInviteSignupPath(targets.next) ? targets.next : withNextParam('/login', targets.next)
  return `${targets.origin}${path}`
}

export function callbackHomeHref(targets: CallbackTargets): string {
  return `${targets.origin}/`
}

/** A Google account with 2FA: the org's sign-in page finishes it from the token. */
export function mfaLoginHref(targets: CallbackTargets, mfaToken: string): string {
  const params = new URLSearchParams({ mfa_token: mfaToken })
  if (targets.next) params.set('next', targets.next)
  return `${targets.origin}/login?${params.toString()}`
}

/**
 * The callbackUrl with its destination swapped for the org's home: once the
 * sign-in itself accepted the invitation, the invitation page has nothing left
 * to do (and would only say the link is used).
 */
export function callbackUrlToOrgRoot(callbackUrl: string, currentOrigin: string): string {
  try {
    const url = new URL(callbackUrl, currentOrigin)
    if (url.pathname === '/redirect_from_auth') {
      url.searchParams.set('next', '/')
      return url.toString()
    }
    return `${url.origin}/redirect_from_auth?next=${encodeURIComponent('/')}`
  } catch {
    return callbackUrl
  }
}

/** The 403 for a Google account other than the invited one. */
export function isInviteEmailMismatch(detail: unknown): boolean {
  return !!detail && typeof detail === 'object' && (detail as any).code === 'INVITE_EMAIL_MISMATCH'
}
