// Impersonation, client side.
//
// While impersonating, org pages run on its token (the auth proxy
// hands it out from the httpOnly LH_imp cookie) and the console keeps the
// superadmin's own session (it asks with ?scope=platform). These helpers keep
// that split in one place, and turn "the impersonation ended" into a trip
// back to the console instead of a sign-out of the superadmin.

export type ImpersonationMode = 'read_only' | 'full'

export interface ImpersonationSession {
  session_uuid: string
  status: string
  impersonator?: { user_id: number | null; label: string }
  target: { kind: 'user' | 'role'; user_id: number | null; label: string; role_id: number | null; role_label: string | null }
  org: { id: number | null; name: string | null; slug: string | null }
  mode: ImpersonationMode
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
  'IMPERSONATION_WRONG_ORG',
] as const

/** The console (its own session), as opposed to org pages (the impersonation's). */
export function isPlatformContext(): boolean {
  if (typeof window === 'undefined') return false
  const { pathname, hostname } = window.location
  return pathname === '/admin' || pathname.startsWith('/admin/') || hostname.startsWith('admin.')
}

/** Where to trade the cookies for an access token in this tab. */
export function authRefreshUrl(): string {
  return isPlatformContext() ? '/api/auth/refresh?scope=platform' : '/api/auth/refresh'
}

let active: ImpersonationSession | null = null

/** Recorded from /users/session; drives the banner, analytics and refusals. */
export function setActiveImpersonation(session: ImpersonationSession | null | undefined) {
  active = session && !isPlatformContext() ? session : null
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
export function broadcastImpersonationEnded(sessionUuid?: string | null) {
  try {
    const bc = new BroadcastChannel(IMPERSONATION_CHANNEL)
    bc.postMessage({ type: 'ended', session_uuid: sessionUuid ?? null })
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

/** The console URL a session returns to: the stored path on the console origin. */
export function consoleUrl(returnUrl: string | null | undefined, frontendDomain?: string | null): string {
  const path = returnUrl && returnUrl.startsWith('/admin') ? returnUrl : '/admin'
  if (typeof window === 'undefined') return path
  const { protocol, hostname, port } = window.location
  const tenancy = document.cookie.split('; ').find((c) => c.startsWith('LH_tenancy='))?.split('=')[1]
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
