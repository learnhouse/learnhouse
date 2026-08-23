import 'server-only'
import { getServerAPIUrl } from '@services/config/config'

export type InstanceMode = 'saas' | 'oss' | 'ee'

/**
 * The whole gate policy, in one pure function so it can be tested directly.
 *
 * Blocks only on a definitive 'oss'. A null mode means the lookup failed, and
 * that renders the dashboard: failing closed would lock real SaaS superadmins
 * out of /admin during any brief API blip — which is exactly when they need
 * it. The API-side check is what actually enforces this; the web gate exists
 * to show a clean message instead of dead chrome.
 */
export function isSuperadminSurfaceBlocked(mode: InstanceMode | null): boolean {
  return mode === 'oss'
}

/**
 * Resolve the deployment mode without trusting anything client-supplied.
 *
 * Deliberately not lib/saas.ts::getInstanceMode(), which prefers a value the
 * client can influence. The URL here comes from server env, never from the
 * request, so nothing on this path is caller-controlled.
 */
export async function fetchInstanceMode(): Promise<InstanceMode | null> {
  try {
    const res = await fetch(`${getServerAPIUrl()}instance/info`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(4000),
    })
    if (!res.ok) return null
    const info = await res.json()
    const mode = info?.mode
    return mode === 'saas' || mode === 'oss' || mode === 'ee' ? mode : null
  } catch {
    return null
  }
}
