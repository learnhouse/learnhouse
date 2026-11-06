// Stands in for apps/web/services/config/config.ts when apps/web's media.ts is
// compiled into the SDK (see the `@services/config/config` alias in
// tsup.config.ts, vitest.config.ts and tsconfig.json). It implements only the
// three getters media.ts imports, reading from the config of whichever SDK
// call is running instead of Next.js runtime config.

export interface MediaConfig {
  /** API origin, e.g. `https://api.example.com`. Stream URLs are built on it. */
  baseUrl: string
  /** Where `content/...` files are served from. Defaults to `baseUrl`. */
  mediaUrl?: string
}

let active: MediaConfig | null = null

/**
 * Runs `fn` with `config` as the active media config. The media helpers are
 * synchronous, so the swap can never leak into another caller.
 */
export function withMediaConfig<T>(config: MediaConfig, fn: () => T): T {
  const previous = active
  active = config
  try {
    return fn()
  } finally {
    active = previous
  }
}

function current(): MediaConfig {
  if (!active) {
    throw new Error('@learnhouse/sdk media helpers must be called through client.media or bindMedia(config)')
  }
  return active
}

export const getConfig = (key: string, defaultValue = ''): string => {
  if (key === 'NEXT_PUBLIC_LEARNHOUSE_MEDIA_URL') return current().mediaUrl || defaultValue
  return defaultValue
}

export const getBackendUrl = (): string => current().baseUrl

// The web app streams through its own same-origin /api/v1 proxy when served on
// a custom domain. SDK callers talk to the API directly, so never.
export const isOnCustomDomain = (): boolean => false
