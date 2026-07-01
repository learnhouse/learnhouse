import 'server-only'
import { cookies } from 'next/headers'
import { getServerAPIUrl } from '@services/config/config'

// Server-side deployment-mode check. The consolidated "bells and whistles"
// (Turnstile, Loops, disposable-email, Resend) must only ever run on the SaaS
// deployment — never on OSS / self-hosted — even if a stray env var is set.
// Callers pair this with the per-integration env check, so an integration is
// active only when: mode === 'saas'  AND  its key/secret is configured.
//
// Source of truth is the same as the proxy/billing guard: the backend instance
// mode, surfaced to the frontend as the `LH_mode` cookie (zero-latency, set on
// every request). We fall back to a short-cached instance/info fetch for the
// rare non-request server contexts (crons) where no cookie is available.

let _modeCache: { mode: DeploymentMode; at: number } | null = null
const MODE_TTL_MS = 60 * 1000

export type DeploymentMode = 'saas' | 'oss' | 'ee'

function coerce(mode: unknown): DeploymentMode | null {
  return mode === 'saas' || mode === 'oss' || mode === 'ee' ? mode : null
}

/** Resolve the deployment mode server-side. Defaults to 'oss' when unknown. */
export async function getInstanceMode(): Promise<DeploymentMode> {
  // 1. LH_mode cookie (request-scoped, set by the proxy from instance/info).
  try {
    const store = await cookies()
    const fromCookie = coerce(store.get('LH_mode')?.value)
    if (fromCookie) return fromCookie
  } catch {
    // cookies() throws outside a request scope — fall through to the fetch.
  }

  // 2. Cached backend instance/info (for non-request contexts).
  if (_modeCache && Date.now() - _modeCache.at < MODE_TTL_MS) return _modeCache.mode
  try {
    const res = await fetch(`${getServerAPIUrl()}instance/info`, { signal: AbortSignal.timeout(3000) })
    const data = await res.json().catch(() => ({}))
    const mode = coerce(data?.mode) ?? 'oss'
    _modeCache = { mode, at: Date.now() }
    return mode
  } catch {
    return 'oss'
  }
}

/** True only on the SaaS deployment. */
export async function isSaaSMode(): Promise<boolean> {
  return (await getInstanceMode()) === 'saas'
}
