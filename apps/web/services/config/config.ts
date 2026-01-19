// Runtime configuration cache
let runtimeConfig: Record<string, string> | null = null;

// Type declarations for Node.js globals (only available server-side)
declare const process: {
  env: Record<string, string | undefined>;
  cwd(): string;
} | undefined;

declare const __dirname: string | undefined;

declare function require(module: string): any;

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
      // Only use Node.js APIs if we're in a Node.js environment
      if (typeof process !== 'undefined' && typeof require !== 'undefined') {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const fs = require('fs') as {
          existsSync: (path: string) => boolean;
          readFileSync: (path: string, encoding: string) => string;
        };
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const path = require('path') as {
          join: (...paths: string[]) => string;
        };
        
        // In standalone mode, runtime-config.json is in the same directory as server.js
        // Try common possible locations relative to the current working directory and module
        const currentDir = typeof __dirname !== 'undefined' ? __dirname : process.cwd();
        const possiblePaths = [
          path.join(process.cwd(), 'runtime-config.json'),
          path.join(currentDir, 'runtime-config.json'),
          path.join(currentDir, '..', 'runtime-config.json'),
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
  if (typeof process !== 'undefined' && process.env) {
    return process.env[key] || defaultValue;
  }
  return defaultValue;
};

// Helper function to normalize API URL - ensures it ends with /api/v1/
const normalizeApiUrl = (url: string): string => {
  if (!url) return url;
  // Remove trailing slash
  url = url.replace(/\/+$/, '');
  // Add /api/v1/ if not already present
  if (!url.endsWith('/api/v1')) {
    url = url.endsWith('/api') ? url + '/v1' : url + '/api/v1';
  }
  return url + '/';
};

// Dynamic config getters - these are functions to ensure runtime values are used
const getLEARNHOUSE_HTTP_PROTOCOL = () =>
  (getConfig('NEXT_PUBLIC_LEARNHOUSE_HTTPS') === 'true') ? 'https://' : 'http://'
const getLEARNHOUSE_API_URL = () => {
  // Check for NEXT_PUBLIC_LEARNHOUSE_API_URL first, then fallback to NEXT_PUBLIC_API_URL for backward compatibility
  const learnhouseApiUrl = getConfig('NEXT_PUBLIC_LEARNHOUSE_API_URL');
  const apiUrl = learnhouseApiUrl || getConfig('NEXT_PUBLIC_API_URL');
  if (apiUrl && apiUrl.trim()) {
    return normalizeApiUrl(apiUrl);
  }
  return 'http://localhost/api/v1/';
}
const getLEARNHOUSE_BACKEND_URL = () => {
  // Check for NEXT_PUBLIC_LEARNHOUSE_BACKEND_URL first, then fallback to NEXT_PUBLIC_API_URL (without /api/v1/)
  const learnhouseBackendUrl = getConfig('NEXT_PUBLIC_LEARNHOUSE_BACKEND_URL');
  const backendUrl = learnhouseBackendUrl || getConfig('NEXT_PUBLIC_API_URL');
  if (backendUrl && backendUrl.trim()) {
    // Remove /api/v1/ if present to get base URL
    return backendUrl.replace(/\/api\/v1\/?$/, '').replace(/\/+$/, '') + '/';
  }
  return 'http://localhost/';
}
const getLEARNHOUSE_DOMAIN = () => getConfig('NEXT_PUBLIC_LEARNHOUSE_DOMAIN', 'localhost')
const getLEARNHOUSE_TOP_DOMAIN = () => getConfig('NEXT_PUBLIC_LEARNHOUSE_TOP_DOMAIN', 'localhost')

// Export getter functions for dynamic runtime configuration
export const getLEARNHOUSE_HTTP_PROTOCOL_VAL = getLEARNHOUSE_HTTP_PROTOCOL
export const getLEARNHOUSE_BACKEND_URL_VAL = getLEARNHOUSE_BACKEND_URL
export const getLEARNHOUSE_DOMAIN_VAL = getLEARNHOUSE_DOMAIN
export const getLEARNHOUSE_TOP_DOMAIN_VAL = getLEARNHOUSE_TOP_DOMAIN

// Export constants for backward compatibility
// These are computed once at module load, but getConfig uses runtime values
// For middleware/proxy (where runtime is critical), use the getter functions instead
export const LEARNHOUSE_HTTP_PROTOCOL = getLEARNHOUSE_HTTP_PROTOCOL()
export const LEARNHOUSE_BACKEND_URL = getLEARNHOUSE_BACKEND_URL()
export const LEARNHOUSE_DOMAIN = getLEARNHOUSE_DOMAIN()
export const LEARNHOUSE_TOP_DOMAIN = getLEARNHOUSE_TOP_DOMAIN()

// For direct usage, these call the getters
export const getAPIUrl = () => getLEARNHOUSE_API_URL()
export const getBackendUrl = () => getLEARNHOUSE_BACKEND_URL()

// Multi Organization Mode
export const isMultiOrgModeEnabled = () =>
  getConfig('NEXT_PUBLIC_LEARNHOUSE_MULTI_ORG') === 'true' ? true : false

export const getUriWithOrg = (orgslug: string, path: string) => {
  const multi_org = isMultiOrgModeEnabled()
  const protocol = getLEARNHOUSE_HTTP_PROTOCOL()
  const domain = getLEARNHOUSE_DOMAIN()
  if (multi_org) {
    return `${protocol}${orgslug}.${domain}${path}`
  }
  return `${protocol}${domain}${path}`
}

export const getUriWithoutOrg = (path: string) => {
  const multi_org = isMultiOrgModeEnabled()
  const protocol = getLEARNHOUSE_HTTP_PROTOCOL()
  const domain = getLEARNHOUSE_DOMAIN()
  if (multi_org) {
    return `${protocol}${domain}${path}`
  }
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



