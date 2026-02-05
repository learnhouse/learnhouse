// Runtime configuration cache
let runtimeConfig: Record<string, string> | null = null;

// Lazy load runtime configuration
function loadRuntimeConfig(): Record<string, string> {
  if (runtimeConfig !== null) {
    return runtimeConfig;
  }

  runtimeConfig = {};

  if (typeof window !== 'undefined') {
    // Client-side: read from window.__RUNTIME_CONFIG__ if available
    if ((window as any).__RUNTIME_CONFIG__) {
      runtimeConfig = (window as any).__RUNTIME_CONFIG__;
    }
  } else {
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

// Dynamic config getters - these are functions to ensure runtime values are used
const getLEARNHOUSE_HTTP_PROTOCOL = () =>
  (getConfig('NEXT_PUBLIC_LEARNHOUSE_HTTPS') === 'true') ? 'https://' : 'http://'
const getLEARNHOUSE_API_URL = () => getConfig('NEXT_PUBLIC_LEARNHOUSE_API_URL', 'http://localhost/api/v1/')
const getLEARNHOUSE_BACKEND_URL = () => getConfig('NEXT_PUBLIC_LEARNHOUSE_BACKEND_URL', 'http://localhost/')
const getLEARNHOUSE_DOMAIN = () => getConfig('NEXT_PUBLIC_LEARNHOUSE_DOMAIN', 'localhost')
const getLEARNHOUSE_TOP_DOMAIN = () => getConfig('NEXT_PUBLIC_LEARNHOUSE_TOP_DOMAIN', 'localhost')
const getLEARNHOUSE_TELEMETRY_DISABLED = () => getConfig('NEXT_TELEMETRY_DISABLED', 'true').toLowerCase();

// Export getter functions for dynamic runtime configuration
export const getLEARNHOUSE_HTTP_PROTOCOL_VAL = getLEARNHOUSE_HTTP_PROTOCOL
export const getLEARNHOUSE_BACKEND_URL_VAL = getLEARNHOUSE_BACKEND_URL
export const getLEARNHOUSE_DOMAIN_VAL = getLEARNHOUSE_DOMAIN
export const getLEARNHOUSE_TOP_DOMAIN_VAL = getLEARNHOUSE_TOP_DOMAIN
export const getLEARNHOUSE_TELEMETRY_DISABLED_VAL = getLEARNHOUSE_TELEMETRY_DISABLED

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

  // Check if current hostname is a custom domain (not a subdomain of LEARNHOUSE_DOMAIN)
  const isSubdomain = hostname.endsWith(`.${domain}`) || hostname === domain
  const isLocalhost = hostname.includes('localhost') || hostname.includes('127.0.0.1')

  return !isSubdomain && !isLocalhost
}

// For direct usage, these call the getters
export const getAPIUrl = () => {
  // On custom domains (client-side), use relative path to go through Next.js proxy
  // This ensures cookies work correctly (same-origin)
  if (isOnCustomDomain()) {
    // Use relative path - Next.js will proxy to the actual backend
    return '/api/v1/'
  }
  return getLEARNHOUSE_API_URL()
}

// Server-side only - always returns full URL (never relative path)
// Use this in Server Components, API routes, and server-side data fetching
export const getServerAPIUrl = () => {
  // Server-side fetch doesn't go through Next.js rewrites, so always use full URL
  return getLEARNHOUSE_API_URL()
}

export const getBackendUrl = () => getLEARNHOUSE_BACKEND_URL()

// Multi Organization Mode
export const isMultiOrgModeEnabled = () =>
  getConfig('NEXT_PUBLIC_LEARNHOUSE_MULTI_ORG') === 'true' ? true : false

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
    const isSubdomain = hostname.endsWith(`.${domain}`) || hostname === domain
    const isLocalhost = hostname.includes('localhost') || hostname.includes('127.0.0.1')

    if (!isSubdomain && !isLocalhost) {
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
    const baseDomain = domainConfig.split(':')[0]

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
  const protocol = getLEARNHOUSE_HTTP_PROTOCOL()
  const multi_org = isMultiOrgModeEnabled()
  const domain = getLEARNHOUSE_DOMAIN()
  if (multi_org) {
    return `${protocol}${orgslug}.${domain}${path}`
  }
  return `${protocol}${domain}${path}`
}

export const getUriWithoutOrg = (path: string) => {
  // Client-side: always use current origin
  if (typeof window !== 'undefined') {
    return `${window.location.origin}${path}`
  }

  // Server-side fallback
  const protocol = getLEARNHOUSE_HTTP_PROTOCOL()
  const domain = getLEARNHOUSE_DOMAIN()
  return `${protocol}${domain}${path}`
}

export const getOrgFromUri = () => {
  const multi_org = isMultiOrgModeEnabled()
  if (multi_org) {
    getDefaultOrg()
  } else {
    if (typeof window !== 'undefined') {
      const hostname = window.location.hostname
      const domain = getLEARNHOUSE_DOMAIN()

      return hostname.replace(`.${domain}`, '')
    }
  }
}

export const getDefaultOrg = () => {
  return getConfig('NEXT_PUBLIC_LEARNHOUSE_DEFAULT_ORG', 'default')
}




