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
  const cookieVal = getCookieValue('learnhouse_frontend_domain')
  if (cookieVal) return cookieVal
  // 3. Default
  return 'localhost'
}
const getLEARNHOUSE_TOP_DOMAIN = () => {
  // 1. Env var (backward compat for existing deploys)
  const envVal = getConfig('NEXT_PUBLIC_LEARNHOUSE_TOP_DOMAIN')
  if (envVal) return envVal
  // 2. Cookie set by middleware from backend instance info
  const cookieVal = getCookieValue('learnhouse_top_domain')
  if (cookieVal) return cookieVal
  // 3. Derive from DOMAIN by stripping port
  const domain = getLEARNHOUSE_DOMAIN()
  return domain.split(':')[0]
}
const getLEARNHOUSE_TELEMETRY_DISABLED = () => getConfig('NEXT_TELEMETRY_DISABLED', 'true').toLowerCase();
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
export const getLEARNHOUSE_TELEMETRY_DISABLED_VAL = getLEARNHOUSE_TELEMETRY_DISABLED
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

// Multi Organization Mode
export const isMultiOrgModeEnabled = () => {
  // 1. Env var (backward compat for existing deploys)
  const envVal = getConfig('NEXT_PUBLIC_LEARNHOUSE_MULTI_ORG')
  if (envVal) return envVal === 'true'
  // 2. Client-side: read cookie set by middleware
  const cookieVal = getCookieValue('learnhouse_multi_org')
  if (cookieVal !== null) return cookieVal === 'true'
  // 3. Default
  return false
}

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
        if (name === 'learnhouse_custom_domain' && value) {
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

export const getUriWithOrg = (orgslug: string, path: string) => {
  // Client-side: prefer using current origin when appropriate
  if (typeof window !== 'undefined') {
    const multi_org = isMultiOrgModeEnabled()

    // In single-org mode or on custom domain, always use current origin
    if (!multi_org || getCustomDomainFromContext()) {
      return `${window.location.origin}${path}`
    }

    // Multi-org mode: check if we need to change subdomains
    const currentHostname = window.location.hostname
    const domainConfig = getLEARNHOUSE_DOMAIN()
    // Remove port from domain config for hostname comparison
    const baseDomain = stripPort(domainConfig)

    // Check if current hostname matches the target
    const expectedHostname = `${orgslug}.${baseDomain}`

    if (currentHostname === expectedHostname || currentHostname === baseDomain) {
      // Already on the right host (subdomain or base domain)
      return `${window.location.origin}${path}`
    }

    // Different subdomain needed - construct URL with current port
    const protocol = window.location.protocol + '//'
    const port = window.location.port
    const portSuffix = port && port !== '80' && port !== '443' ? `:${port}` : ''
    return `${protocol}${orgslug}.${baseDomain}${portSuffix}${path}`
  }

  // Server-side fallback to config-based URL construction
  const multi_org = isMultiOrgModeEnabled()
  const explicitDomain = getConfig('NEXT_PUBLIC_LEARNHOUSE_DOMAIN')
  if (multi_org) {
    const protocol = getLEARNHOUSE_HTTP_PROTOCOL()
    const domain = getLEARNHOUSE_DOMAIN()
    return `${protocol}${orgslug}.${domain}${path}`
  }
  if (explicitDomain) {
    // Explicit domain configured: construct absolute URL (needed for RSS, SEO, server-side fetches)
    const protocol = getLEARNHOUSE_HTTP_PROTOCOL()
    return `${protocol}${explicitDomain}${path}`
  }
  // No explicit domain configured: return relative path to avoid hardcoded 'localhost'
  // URLs in SSR output that break on non-localhost deployments
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
 * Get the current deployment mode from the learnhouse_mode cookie set by middleware.
 * Single source of truth for mode detection on the frontend.
 * Defaults to 'oss' when cookie is absent (safe fallback — blocks EE features).
 */
export const getDeploymentMode = (): DeploymentMode => {
  return (getCookieValue('learnhouse_mode') as DeploymentMode) || 'oss'
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
  const cookieVal = getCookieValue('learnhouse_default_org')
  if (cookieVal) return cookieVal
  // 3. Default
  return 'default'
}




