import { stripPort, isSubdomainOf, isSameHost, isLocalhost as isLocalhostCheck } from '@services/utils/ts/hostUtils'

// Runtime configuration cache
let runtimeConfig: Record<string, string> | null = null;
let serverConfigLoaded = false;

// Lazy load runtime configuration
function loadRuntimeConfig(): Record<string, string> {
  if (typeof window !== 'undefined') {
    // Client-side: always read from window.__RUNTIME_CONFIG__ (may be injected after first call)
    if ((window as any).__RUNTIME_CONFIG__) {
      runtimeConfig = (window as any).__RUNTIME_CONFIG__;
    }
    return runtimeConfig || {};
  }

  // Server-side: cache after first successful load
  if (serverConfigLoaded && runtimeConfig) {
    return runtimeConfig;
  }

  runtimeConfig = {};

  if (typeof window === 'undefined') {
    // Server-side: try to read from runtime-config.json
    // Try multiple possible paths for standalone mode
    try {
      const fs = require('fs');
      const path = require('path');
      
      // In standalone mode, runtime-config.json is in the same directory as server.js
      // Try common possible locations relative to the current working directory and module
      const possiblePaths = [
        path.join(process.cwd(), 'runtime-config.json'),
        path.join(__dirname || process.cwd(), 'runtime-config.json'),
        path.join(__dirname || process.cwd(), '..', 'runtime-config.json'),
      ];
      
      for (const configPath of possiblePaths) {
        try {
          if (fs.existsSync(configPath)) {
            runtimeConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            break;
          }
        } catch {
          // Continue to next path
        }
      }
    } catch {
      // fs/path not available (client-side bundle), skip
    }
    serverConfigLoaded = true;
  }

  return runtimeConfig || {};
}

// Helper function to get config value with fallback
export const getConfig = (key: string, defaultValue: string = ''): string => {
  const config = loadRuntimeConfig();
  
  // 1. Check runtime config (from runtime-config.json or the generated runtime-config.js)
  if (config && config[key]) {
    return config[key];
  }

  // 2. Fallback to process.env (Server-side only)
  return process.env[key] || defaultValue;
};

// Helper to read a cookie value by name (client-side only)
const getCookieValue = (name: string): string | null => {
  if (typeof window === 'undefined') return null
  try {
    const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'))
    return match ? decodeURIComponent(match[1]) : null
  } catch {
    return null
  }
}

// Dynamic config getters - these are functions to ensure runtime values are used
const getLEARNHOUSE_HTTP_PROTOCOL = () =>
  (getConfig('NEXT_PUBLIC_LEARNHOUSE_HTTPS') === 'true') ? 'https://' : 'http://'
const getLEARNHOUSE_BACKEND_URL = () => getConfig('NEXT_PUBLIC_LEARNHOUSE_BACKEND_URL', 'http://localhost/')
const getLEARNHOUSE_DOMAIN = () => {
  // 1. Env var (backward compat for existing deploys)
  const envVal = getConfig('NEXT_PUBLIC_LEARNHOUSE_DOMAIN')
  if (envVal) return envVal
  // 2. Cookie set by middleware from backend instance info
  const cookieVal = getCookieValue('LH_frontend_domain')
  if (cookieVal) return cookieVal
  // 3. Default
  return 'localhost'
}
const getLEARNHOUSE_TOP_DOMAIN = () => {
  // 1. Env var (backward compat for existing deploys)
  const envVal = getConfig('NEXT_PUBLIC_LEARNHOUSE_TOP_DOMAIN')
  if (envVal) return envVal
  // 2. Cookie set by middleware from backend instance info
  const cookieVal = getCookieValue('LH_top_domain')
  if (cookieVal) return cookieVal
  // 3. Derive from DOMAIN by stripping port
  const domain = getLEARNHOUSE_DOMAIN()
  return domain.split(':')[0]
}
// PostHog product analytics — opt-in. Telemetry is OFF unless this key is set
// in the deployment env. No separate enable flag: presence of the key IS the switch.
const getPOSTHOG_KEY = () => getConfig('NEXT_PUBLIC_POSTHOG_KEY', '');
const getLEARNHOUSE_PLATFORM_URL = (): string | null => {
  // NEXT_PUBLIC_ variant (available client-side via runtime config)
  const pubVal = getConfig('NEXT_PUBLIC_LEARNHOUSE_PLATFORM_URL')
  if (pubVal) return pubVal.replace(/\/+$/, '')
  // Non-prefixed variant (server-side only, backward compat)
  const val = getConfig('LEARNHOUSE_PLATFORM_URL')
  if (val) return val.replace(/\/+$/, '')
  return null
}

// Export getter functions for dynamic runtime configuration
export const getLEARNHOUSE_HTTP_PROTOCOL_VAL = getLEARNHOUSE_HTTP_PROTOCOL
export const getLEARNHOUSE_BACKEND_URL_VAL = getLEARNHOUSE_BACKEND_URL
export const getLEARNHOUSE_DOMAIN_VAL = getLEARNHOUSE_DOMAIN
export const getLEARNHOUSE_TOP_DOMAIN_VAL = getLEARNHOUSE_TOP_DOMAIN
export const getPOSTHOG_KEY_VAL = getPOSTHOG_KEY
export const getLEARNHOUSE_PLATFORM_URL_VAL = getLEARNHOUSE_PLATFORM_URL

// Export constants for backward compatibility
// These are computed once at module load, but getConfig uses runtime values
// For middleware/proxy (where runtime is critical), use the getter functions instead
export const LEARNHOUSE_HTTP_PROTOCOL = getLEARNHOUSE_HTTP_PROTOCOL()
export const LEARNHOUSE_BACKEND_URL = getLEARNHOUSE_BACKEND_URL()
export const LEARNHOUSE_DOMAIN = getLEARNHOUSE_DOMAIN()
export const LEARNHOUSE_TOP_DOMAIN = getLEARNHOUSE_TOP_DOMAIN()

// Helper to check if we're on a custom domain (for API URL selection)
const isOnCustomDomain = (): boolean => {
  if (typeof window === 'undefined') return false
  const hostname = window.location.hostname
  const domain = getLEARNHOUSE_DOMAIN()
  return !isSubdomainOf(hostname, domain) && !isSameHost(hostname, domain) && !isLocalhostCheck(hostname)
}

// Derive API URL from backend URL (with backward compat for NEXT_PUBLIC_LEARNHOUSE_API_URL)
const deriveAPIUrl = (): string => {
  // Backward compat: if explicit API URL is set, use it
  const explicitApiUrl = getConfig('NEXT_PUBLIC_LEARNHOUSE_API_URL')
  if (explicitApiUrl) return explicitApiUrl
  // Derive from backend URL
  const backendUrl = getLEARNHOUSE_BACKEND_URL().replace(/\/+$/, '')
  return `${backendUrl}/api/v1/`
}

// For direct usage, these call the getters
export const getAPIUrl = () => {
  // On custom domains (client-side), use relative path to go through Next.js proxy
  // This ensures cookies work correctly (same-origin)
  if (isOnCustomDomain()) {
    return '/api/v1/'
  }
  return deriveAPIUrl()
}

// Server-side only - always returns full URL (never relative path)
// Use this in Server Components, API routes, and server-side data fetching
export const getServerAPIUrl = () => {
  return deriveAPIUrl()
}

export const getBackendUrl = () => getLEARNHOUSE_BACKEND_URL()

/**
 * Get the upgrade/plan URL for a given org.
 * Uses LEARNHOUSE_PLATFORM_URL (the main platform, e.g. learnhouse.app).
 * Returns null in OSS/self-hosted mode or when platform URL is not configured.
 */
export const getUpgradeUrl = (orgSlug: string): string | null => {
  const mode = getDeploymentMode()
  if (mode === 'oss' || mode === 'ee') return null
  const platformUrl = getLEARNHOUSE_PLATFORM_URL()
  if (!platformUrl) return null
  return `${platformUrl}/dashboard/${orgSlug}/plan`
}

/**
 * Build a URL on the platform domain (e.g. learnhouse.app).
 * Use this for links that should point to the main platform site,
 * not the org subdomain (e.g. upgrade, billing, account management).
 * Returns null when platform URL is not configured.
 */
export const getPlatformUrl = (path: string): string | null => {
  const platformUrl = getLEARNHOUSE_PLATFORM_URL()
  if (!platformUrl) return null
  return `${platformUrl}${path}`
}

// Tenancy mode — the authoritative client-side getter.
//
// Reads the `LH_tenancy` cookie set by the middleware on every request. The
// cookie is sourced from the backend's instance/info endpoint, so it always
// reflects the current deployment configuration. Defaults to 'single' when
// the cookie isn't present (e.g. very first request before middleware runs).
//
// We deliberately do NOT consult `NEXT_PUBLIC_LEARNHOUSE_MULTI_ORG` here —
// stale env vars from older deploys used to override the runtime cookie and
// produce broken URLs like `default.localhost:3000`. The env var still has
// effect at backend boot time; that's the only place it should influence
// behavior.
export type TenancyMode = 'multi' | 'single'

export const getTenancy = (): TenancyMode => {
  const cookieVal = getCookieValue('LH_tenancy')
  if (cookieVal === 'multi' || cookieVal === 'single') return cookieVal
  return 'single'
}

// Backward-compat shim — prefer getTenancy() in new code.
export const isMultiOrgModeEnabled = () => getTenancy() === 'multi'

/**
 * Get custom domain from context (client-side only)
 * Returns the custom domain with port if we're on one, null otherwise
 */
export const getCustomDomainFromContext = (): string | null => {
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname
    const host = window.location.host // includes port if non-standard
    const domain = getLEARNHOUSE_DOMAIN()

    // Check if current hostname is a custom domain (not a subdomain of LEARNHOUSE_DOMAIN)
    const isSub = isSubdomainOf(hostname, domain) || isSameHost(hostname, domain)
    const isLocal = isLocalhostCheck(hostname)

    if (!isSub && !isLocal) {
      // Return host (includes port) for custom domains
      return host
    }

    // Also check cookie as fallback (for cases where hostname check might not work)
    try {
      const cookies = document.cookie.split(';')
      for (const cookie of cookies) {
        const [name, value] = cookie.trim().split('=')
        if (name === 'LH_custom_domain' && value) {
          // Cookie only stores hostname, so add current port if present
          const cookieDomain = decodeURIComponent(value)
          const port = window.location.port
          if (port && port !== '80' && port !== '443') {
            return `${cookieDomain}:${port}`
          }
          return cookieDomain
        }
      }
    } catch {
      // Ignore cookie parsing errors
    }
  }
  return null
}

/**
 * Build a URL for a given org's path.
 *
 * Returns a RELATIVE path whenever navigation stays on the current origin —
 * which is always the case in single tenancy and almost always in multi
 * tenancy (the user is already on the right subdomain or custom domain).
 * Only when crossing subdomains in multi tenancy do we build an absolute
 * URL.
 *
 * This is intentional: relative paths are robust against tenancy
 * misconfiguration. A stale env var or legacy cookie can no longer cause
 * the menu to forge a non-existent subdomain like `default.localhost:3000`.
 */
export const getUriWithOrg = (orgslug: string, path: string) => {
  const tenancy = getTenancy()

  // Client-side
  if (typeof window !== 'undefined') {
    // Single tenancy → always relative. The browser keeps us on the same host.
    // Custom domain → relative (we're already on the org's host).
    // Missing slug → relative (caller wants a generic intra-app URL).
    if (tenancy === 'single' || getCustomDomainFromContext() || !orgslug) {
      return path
    }

    // Multi tenancy: relative if we're already on the correct subdomain.
    const baseDomain = stripPort(getLEARNHOUSE_DOMAIN())
    const currentHostname = window.location.hostname
    const expectedHostname = `${orgslug}.${baseDomain}`
    if (currentHostname === expectedHostname) {
      return path
    }

    // Safety net: only synthesize an absolute subdomain URL when the user is
    // on the apex base domain itself (e.g. the org-selection screen) or on
    // some subdomain of it. On any other host — localhost, a host that
    // doesn't end in `.{baseDomain}` — building `${slug}.${baseDomain}` would
    // land them on a hostname that may not resolve (e.g. `default.localhost`),
    // so we return a relative path and keep navigation on the current origin.
    //
    // The apex case is essential: the org-selection screen lives on the apex
    // (`{baseDomain}`), and from there every org link must cross to its
    // `${slug}.${baseDomain}` subdomain. `isSubdomainOf` is false for the apex
    // (a host is not a subdomain of itself), so without the `isSameHost` check
    // org links would collapse to the apex path and loop back to the selector.
    if (!isSubdomainOf(currentHostname, baseDomain) && !isSameHost(currentHostname, baseDomain)) {
      return path
    }

    // Crossing subdomains — build an absolute URL with current scheme/port.
    const protocol = window.location.protocol + '//'
    const port = window.location.port
    const portSuffix = port && port !== '80' && port !== '443' ? `:${port}` : ''
    return `${protocol}${orgslug}.${baseDomain}${portSuffix}${path}`
  }

  // Server-side
  // Single tenancy → relative. The page will render on whatever host the
  // request came in on; relative URLs resolve correctly at the client.
  if (tenancy === 'single') {
    return path
  }

  // Multi tenancy server-side: build the subdomain URL because we can't
  // assume server components know the user's current host.
  if (orgslug) {
    const protocol = getLEARNHOUSE_HTTP_PROTOCOL()
    const domain = getLEARNHOUSE_DOMAIN()
    return `${protocol}${orgslug}.${domain}${path}`
  }
  const explicitDomain = getConfig('NEXT_PUBLIC_LEARNHOUSE_DOMAIN')
  if (explicitDomain) {
    const protocol = getLEARNHOUSE_HTTP_PROTOCOL()
    return `${protocol}${explicitDomain}${path}`
  }
  return path
}

export const getUriWithoutOrg = (path: string) => {
  // Client-side: always use current origin
  if (typeof window !== 'undefined') {
    return `${window.location.origin}${path}`
  }

  // Server-side fallback
  const explicitDomain = getConfig('NEXT_PUBLIC_LEARNHOUSE_DOMAIN')
  if (explicitDomain) {
    const protocol = getLEARNHOUSE_HTTP_PROTOCOL()
    return `${protocol}${explicitDomain}${path}`
  }
  // No explicit domain configured: return relative path to avoid hardcoded 'localhost' URLs
  return path
}

/**
 * Build a URI on the main domain (not the org subdomain).
 * Useful for OAuth redirect URIs where only one fixed URI can be registered
 * (e.g., Stripe Connect requires exact redirect_uri matching).
 */
export const getMainDomainUri = (path: string) => {
  const protocol = getLEARNHOUSE_HTTP_PROTOCOL()
  const domain = getLEARNHOUSE_DOMAIN()
  return `${protocol}${domain}${path}`
}

export type DeploymentMode = 'saas' | 'oss' | 'ee'

/**
 * Get the current deployment mode from the LH_mode cookie set by middleware.
 * Single source of truth for mode detection on the frontend.
 * Defaults to 'oss' when cookie is absent (safe fallback — blocks EE features).
 */
export const getDeploymentMode = (): DeploymentMode => {
  return (getCookieValue('LH_mode') as DeploymentMode) || 'oss'
}

/**
 * OSS mode — thin wrapper over getDeploymentMode() for backward compatibility.
 */
export const isOSSMode = (): boolean => {
  return getDeploymentMode() === 'oss'
}

/**
 * EE (Enterprise Edition) availability — thin wrapper over getDeploymentMode() for backward compatibility.
 */
export const isEEAvailable = (): boolean => {
  return getDeploymentMode() === 'ee'
}

// Collaboration server WebSocket URL
export const getCollabUrl = () => getConfig('NEXT_PUBLIC_COLLAB_URL', 'ws://localhost:4000')

export const getDefaultOrg = () => {
  // 1. Env var (backward compat)
  const envVal = getConfig('NEXT_PUBLIC_LEARNHOUSE_DEFAULT_ORG')
  if (envVal) return envVal
  // 2. Client-side: read cookie set by middleware
  const cookieVal = getCookieValue('LH_default_org')
  if (cookieVal) return cookieVal
  // 3. Default
  return 'default'
}




