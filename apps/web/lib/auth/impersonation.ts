// Impersonation, client side.
//
// While impersonating, org pages run on its token (the auth proxy
// hands it out from the httpOnly LH_imp cookie) and the console keeps the
// backoffice staff member's own session (it asks with ?scope=platform). These helpers keep
// that split in one place, and turn "the impersonation ended" into a trip
// back to the console instead of a sign-out of the backoffice staff member.
import { readDocumentCookie } from '@/lib/cookies'

export type ImpersonationMode = 'read_only' | 'full'

export interface ImpersonationSession {
  session_uuid: string
  status: string
  impersonator?: { user_id: number | null; label: string }
  target: { kind: 'user' | 'role'; user_id: number | null; label: string; role_id: number | null; role_label: string | null }
  org: { id: number | null; name: string | null; slug: string | null }
  mode: ImpersonationMode
  /** "platform": staff support access. "org": an org admin viewing as one of their learners (read-only, no switching). */
  scope?: 'platform' | 'org'
  allow_messaging: boolean
  org_visible: boolean
  notify_admins: boolean
  reason: string
  ticket: string | null
  created_at: string | null
  expires_at: string | null
  ended_at: string | null
  end_reason: string | null
  return_url: string | null
  server_time?: string | null
  /** The staff member may switch to full access. */
  can_full?: boolean
}

export const IMPERSONATION_ENDED_EVENT = 'learnhouse:impersonation-ended'
export const IMPERSONATION_REFUSED_EVENT = 'learnhouse:impersonation-refused'
export const IMPERSONATION_CHANNEL = 'learnhouse_impersonation'
export const IMPERSONATION_CODES = [
  'IMPERSONATION_READ_ONLY',
  'IMPERSONATION_DENIED',
  'IMPERSONATION_MESSAGING_BLOCKED',
  'IMPERSONATION_PRIVATE',
  'IMPERSONATION_WRONG_ORG',
] as const

// Why a session ended, as the API reports it (the record's end reason). The
// badge names it on the way out instead of leaving requests to fail.
export const IMPERSONATION_END_REASONS = [
  'ended',
  'expired',
  'revoked',
  'logout',
  'replaced',
  'impersonator_changed',
  'target_changed',
] as const
export type ImpersonationEndReason = (typeof IMPERSONATION_END_REASONS)[number]
/** Core's own reason: the token ran out (it carries the session's cap). */
export const TOKEN_EXPIRED_REASON = 'token_expired'

/** A reason from the API, a URL or an event, as one the badge knows. */
export function normalizeEndReason(raw: unknown, fallback: ImpersonationEndReason = 'ended'): ImpersonationEndReason {
  if (raw === TOKEN_EXPIRED_REASON) return 'expired'
  return typeof raw === 'string' && (IMPERSONATION_END_REASONS as readonly string[]).includes(raw)
    ? (raw as ImpersonationEndReason)
    : fallback
}

/** The end reason in an API refusal (``detail.reason``) or a proxy reply (``reason``). */
export function endReasonOf(body: unknown): string | null {
  const b = body as any
  const detail = b && typeof b === 'object' ? b.detail : null
  const reason = detail && typeof detail === 'object' ? detail.reason : b?.reason
  return typeof reason === 'string' && reason ? reason : null
}

/** The i18n key of the note shown once the session is over. */
export function endedNoticeKey(reason: ImpersonationEndReason, platform: boolean): string {
  // Leaving on purpose from the console keeps its "back in the console" note.
  if (platform && reason === 'ended') return 'impersonation.returned_ended'
  return `impersonation.ended_notice_${reason}`
}

/** The console (its own session), as opposed to org pages (the impersonation's). */
export function isPlatformContext(): boolean {
  if (typeof window === 'undefined') return false
  const { pathname, hostname } = window.location
  return pathname === '/backoffice' || pathname.startsWith('/backoffice/') || hostname.startsWith('admin.')
}

/** Where to trade the cookies for an access token in this tab. */
export function authRefreshUrl(): string {
  return isPlatformContext() ? '/api/auth/refresh?scope=platform' : '/api/auth/refresh'
}

let active: ImpersonationSession | null = null
// Whether this tab ever ran on an impersonation the server confirmed (from
// /users/session). Only such a tab may be sent back to the console.
let confirmedHere = false

/** Recorded from /users/session; drives the banner, analytics and refusals. */
export function setActiveImpersonation(session: ImpersonationSession | null | undefined) {
  active = session && !isPlatformContext() ? session : null
  if (active) confirmedHere = true
}

/** This tab ran on an impersonation the server confirmed. An "ended" signal
 *  anywhere else (a spent cookie, a stale reply) must not move the page. */
export function impersonationConfirmedHere(): boolean {
  return confirmedHere
}

/** Test seam: forget this tab's impersonation state. */
export function resetImpersonationTabState() {
  active = null
  confirmedHere = false
  endedBeforeMount = null
}

/**
 * Trade the cookies for an access token in this tab.
 *
 * Never from the HTTP cache: browsers keep a 410 with no cache headers as
 * fresh forever, and one such reply used to bounce every later visit to that
 * org. A 410 means a spent impersonation cookie, which the proxy has just
 * dropped; a tab that never ran on that impersonation asks once more and
 * carries on as the person signed in.
 */
export async function fetchAuthRefresh(
  doFetch: (_input: string, _init: RequestInit) => Promise<Response>,
  headers?: Record<string, string>,
): Promise<Response> {
  const init: RequestInit = { method: 'GET', credentials: 'include', cache: 'no-store', ...(headers ? { headers } : {}) }
  const res = await doFetch(authRefreshUrl(), init)
  if (res.status !== 410 || confirmedHere) return res
  return doFetch(authRefreshUrl(), init)
}

/** A 410 from the token refresh: only a tab that ran on the impersonation
 *  goes back to the console and says why. */
export function impersonationRefreshGone(body: unknown) {
  if (confirmedHere) dispatchImpersonationEnded(normalizeEndReason(endReasonOf(body)))
}

export function activeImpersonation(): ImpersonationSession | null {
  return active
}

let endedBeforeMount: string | null = null

export function dispatchImpersonationEnded(reason: string = 'ended') {
  if (typeof window === 'undefined') return
  // Kept for a listener that mounts later (the tab loaded on a spent token).
  endedBeforeMount = reason
  window.dispatchEvent(new CustomEvent(IMPERSONATION_ENDED_EVENT, { detail: { reason } }))
}

/** An end that was announced before anyone listened, once. */
export function takeEarlyImpersonationEnd(): string | null {
  const reason = endedBeforeMount
  endedBeforeMount = null
  return reason
}

export function dispatchImpersonationRefused(code: string, message?: string) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(IMPERSONATION_REFUSED_EVENT, { detail: { code, message } }))
}

/** Another tab (or the console) ended a session: every tab of it hears it. */
export function broadcastImpersonationEnded(sessionUuid?: string | null, reason: ImpersonationEndReason = 'revoked') {
  try {
    const bc = new BroadcastChannel(IMPERSONATION_CHANNEL)
    bc.postMessage({ type: 'ended', session_uuid: sessionUuid ?? null, reason })
    bc.close()
  } catch {
    /* BroadcastChannel unavailable: the banner's status poll catches it */
  }
}

/** A refused request's body code, when the API refused it as a impersonation action. */
export function impersonationCode(body: unknown): string | null {
  const detail = (body as any)?.detail
  const code = detail && typeof detail === 'object' ? detail.code : null
  return typeof code === 'string' && code.startsWith('IMPERSONATION_') ? code : null
}

// A page of another org: the impersonation is held to the org it was opened
// for, so the API refuses it (as the impersonation, or through that org's
// session policy). Shown as a notice; the session goes on.
const OTHER_ORG_CODES = ['IMPERSONATION_WRONG_ORG', 'SESSION_NOT_BOUND_TO_ORG', 'AUTH_METHOD_NOT_ALLOWED']

export type ImpersonationRefusal =
  | { kind: 'end'; reason: ImpersonationEndReason }
  | { kind: 'notice'; code: string }
  | null

/**
 * What a refused API call means while impersonating. Only the API saying the
 * session is over (IMPERSONATION_ENDED) ends it; a refused page or action
 * shows a notice under the badge and the session goes on.
 */
export function impersonationRefusal(status: number, body: unknown, method: string = 'GET'): ImpersonationRefusal {
  if (status !== 401 && status !== 403) return null
  const detail = (body as any)?.detail
  const code = detail && typeof detail === 'object' && typeof detail.code === 'string' ? detail.code : null
  if (code === 'IMPERSONATION_ENDED') return { kind: 'end', reason: normalizeEndReason(endReasonOf(body)) }
  if (status !== 403 || !code) return null
  if (OTHER_ORG_CODES.includes(code)) return { kind: 'notice', code: 'IMPERSONATION_WRONG_ORG' }
  // Only what the person did (a write) gets the notice; a page's own
  // background reads that the session may not make stay quiet.
  const verb = (method || 'GET').toUpperCase()
  if (code.startsWith('IMPERSONATION_') && verb !== 'GET' && verb !== 'HEAD') return { kind: 'notice', code }
  return null
}

/** The console URL a session returns to: the stored path on the console origin. */
export function consoleUrl(returnUrl: string | null | undefined, frontendDomain?: string | null): string {
  const path = returnUrl && returnUrl.startsWith('/backoffice') ? returnUrl : '/backoffice'
  if (typeof window === 'undefined') return path
  const { protocol, hostname, port } = window.location
  const tenancy = readDocumentCookie().split('; ').find((c) => c.startsWith('LH_tenancy='))?.split('=')[1]
  if (tenancy !== 'multi' || !frontendDomain || hostname.startsWith('admin.')) return path
  // Multi-tenant: the console lives on admin.{domain}.
  const host = frontendDomain.includes(':') || !port ? frontendDomain : `${frontendDomain}:${port}`
  return `${protocol}//admin.${host}${path}`
}

export interface ImpersonationTargets {
  org: { id: number; name: string; slug: string }
  suggested?: { user_id: number; name: string; username: string; role_id: number; role_label: string | null } | null
  members: { user_id: number; username: string; name: string; email: string; avatar_image: string | null; user_uuid: string; role_id: number; role_label: string }[]
  roles: { id: number; name: string; custom: boolean }[]
}

/** Members and roles of the impersonated org (the badge's switcher). */
export async function fetchImpersonationTargets(q: string): Promise<ImpersonationTargets | null> {
  try {
    const res = await fetch(`/api/auth/impersonation/targets?q=${encodeURIComponent(q)}`, { credentials: 'include', cache: 'no-store' })
    return res.ok ? await res.json() : null
  } catch {
    return null
  }
}

export interface ImpersonationSwitch {
  user_id?: number
  role_id?: number
  mode?: ImpersonationMode
  allow_messaging?: boolean
}

/** Switch who (or how) we're impersonating; the cookie is replaced server-side. */
export async function switchImpersonation(body: ImpersonationSwitch): Promise<{ ok: boolean; message?: string }> {
  try {
    const res = await fetch('/api/auth/impersonation/switch', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.ok) return { ok: true }
    const data = await res.json().catch(() => ({}))
    const detail = data?.detail
    return { ok: false, message: typeof detail === 'string' ? detail : detail?.message }
  } catch {
    return { ok: false }
  }
}
