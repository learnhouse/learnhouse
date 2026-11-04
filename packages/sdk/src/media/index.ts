// Media URL helpers. The implementation is apps/web/services/media/media.ts,
// compiled in from source (aliased as @learnhouse-web/media) with its config
// import swapped for ./config-shim. Nothing here re-implements a URL layout.
import * as webMedia from '@learnhouse-web/media'
import { withMediaConfig, type MediaConfig } from './config-shim'

export type { MediaConfig }

/**
 * getScormContentUrl is left out: it returns a path to a route handler inside
 * the Next.js web app (/api/scorm/...), not to the API.
 */
type WebMedia = Omit<typeof webMedia, 'getScormContentUrl'>
type MediaFn = (...args: never[]) => unknown

/** The web app's media helpers, bound to one client's `baseUrl` / `mediaUrl`. */
export type MediaHelpers = { [K in keyof WebMedia]: WebMedia[K] }

/** The same helpers as standalone functions that take the config first. */
export type StandaloneMediaHelpers = {
  [K in keyof WebMedia]: WebMedia[K] extends (...args: infer A) => infer R
    ? (config: MediaConfig, ...args: A) => R
    : never
}

const EXCLUDED = new Set(['getScormContentUrl'])

function helperEntries(): Array<[string, MediaFn]> {
  const all = webMedia as unknown as Record<string, unknown>
  return Object.keys(all)
    .filter((k) => typeof all[k] === 'function' && !EXCLUDED.has(k))
    .map((k) => [k, all[k] as MediaFn])
}

function normalize(config: MediaConfig): MediaConfig {
  if (!config || typeof config.baseUrl !== 'string' || !config.baseUrl) {
    throw new TypeError('media helpers need a `baseUrl`')
  }
  return { baseUrl: config.baseUrl, mediaUrl: config.mediaUrl || undefined }
}

export function bindMedia(config: MediaConfig): MediaHelpers {
  const cfg = normalize(config)
  const out: Record<string, MediaFn> = {}
  for (const [name, fn] of helperEntries()) {
    out[name] = (...args: never[]) => withMediaConfig(cfg, () => fn(...args))
  }
  return out as unknown as MediaHelpers
}

/**
 * Standalone media helpers: `media.getCourseThumbnailMediaDirectory(config, orgUuid, courseUuid, fileId)`.
 */
export const media: StandaloneMediaHelpers = /* @__PURE__ */ (() => {
  const out: Record<string, (config: MediaConfig, ...args: never[]) => unknown> = {}
  for (const [name, fn] of helperEntries()) {
    out[name] = (config: MediaConfig, ...args: never[]) => withMediaConfig(normalize(config), () => fn(...args))
  }
  return out as unknown as StandaloneMediaHelpers
})()
