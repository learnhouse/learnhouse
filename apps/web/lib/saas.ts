import 'server-only'
import { headers } from 'next/headers'
import { getServerAPIUrl } from '@services/config/config'
import { fetchInstanceMode, type InstanceMode } from '@lib/eeGate'

// Server-side deployment-mode check. The consolidated "bells and whistles"
// (Turnstile, Loops, disposable-email, Resend) must only ever run on the SaaS
// deployment, never on OSS / self-hosted, even if a stray env var is set.
// Callers pair this with the per-integration env check, so an integration is
// active only when: mode === 'saas'  AND  its key/secret is configured.
//
// Source of truth is the backend instance mode, fetched server-side and cached
// briefly. The `LH_mode` cookie is deliberately NOT consulted: it is
// client-settable, and sending `LH_mode=oss` would switch off Turnstile and the
// disposable-email check on the SaaS signup path.

let _modeCache: { mode: DeploymentMode; at: number } | null = null
const MODE_TTL_MS = 60 * 1000

export type DeploymentMode = InstanceMode

/** Resolve the deployment mode server-side. Defaults to 'oss' when unknown. */
export async function getInstanceMode(): Promise<DeploymentMode> {
  if (_modeCache && Date.now() - _modeCache.at < MODE_TTL_MS) return _modeCache.mode
  const mode = await fetchInstanceMode()
  if (!mode) return 'oss'
  _modeCache = { mode, at: Date.now() }
  return mode
}

/** True only on the SaaS deployment. */
export async function isSaaSMode(): Promise<boolean> {
  return (await getInstanceMode()) === 'saas'
}

/**
 * True when the current request is served on an org CUSTOM DOMAIN. Cloudflare
 * Turnstile site keys are hostname-locked to the platform domain, so the anti-bot
 * add-ons skip Turnstile on custom domains (the client widget is hidden to match).
 *
 * SECURITY: this gates a bot-protection control, so it is derived from the
 * non-forgeable request Host (routed by the ingress), NOT the client-settable
 * LH_custom_domain cookie. A host that is the platform apex/subdomain is never a
 * custom domain (Turnstile stays on); any other host is only trusted after the
 * backend confirms it's a REGISTERED custom domain, so a spoofed Host can't
 * disable bot protection on the platform.
 */
export async function isCustomDomainRequest(): Promise<boolean> {
  return (await getCustomDomainOrgId()) !== null
}

/**
 * The id of the org that owns the custom domain this request is served on, or
 * null when it isn't a registered custom domain. Same Host-based rules as
 * isCustomDomainRequest; callers that relax a control on custom domains use this
 * to keep the relaxation scoped to that one org.
 */
export async function getCustomDomainOrgId(): Promise<number | null> {
  try {
    const host = (await headers()).get('host')?.split(':')[0]?.toLowerCase()
    if (!host || host === 'localhost' || /^[\d.]+$/.test(host)) return null

    const platform = (process.env.NEXT_PUBLIC_LEARNHOUSE_DOMAIN || '').toLowerCase()
    // Platform apex or subdomain → not a custom domain (keep Turnstile on).
    if (platform && (host === platform || host.endsWith(`.${platform}`))) return null

    // Otherwise only trust it if the backend resolves it to a registered custom
    // domain (200). Prevents a forged Host from turning off Turnstile.
    const res = await fetch(
      `${getServerAPIUrl()}orgs/resolve/domain/${encodeURIComponent(host)}`,
      { signal: AbortSignal.timeout(3000) },
    )
    if (!res.ok) return null
    const data = (await res.json().catch(() => null)) as { org_id?: unknown } | null
    return typeof data?.org_id === 'number' ? data.org_id : null
  } catch {
    return null
  }
}
