// Optional server plugins. The Enterprise Edition ships one at `ee/index.ts`
// (or `ee/index.js`) next to `src/`, overlaid at image build time and
// symlinked in local development. Without it the server runs the room kinds
// built in here and refuses every other document name.
//
// A plugin gets what it needs from the server through `CollabPluginDeps`
// instead of importing it: a symlinked plugin is loaded from its real path,
// where neither `src/` nor `node_modules` exist, so it may only `import type`
// from this app (types are erased) and relative files of its own.

import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import type Redis from 'ioredis'
import type { RoomKind } from './rooms.js'
import type { InternalRoute } from './internalHttp.js'

export interface CollabPluginDeps {
  apiUrl: string
  internalKey: string
  fetchWithTimeout(url: string, options?: RequestInit, timeoutMs?: number): Promise<Response>
  getRedis(): Redis
  /** Largest Yjs state the server persists (bytes). */
  maxYdocBytes: number
  /** TTL of cached Yjs state in Redis (seconds). */
  redisTtlSeconds: number
}

export interface CollabPlugin {
  /** Shown in the startup log. */
  name: string
  /** Room kinds hosted next to the built-in ones. */
  kinds?: RoomKind[]
  /** Extra /internal/* routes, behind the internal key. */
  internalRoutes?: InternalRoute[]
  /** Runs on shutdown once every room has been stored. */
  shutdown?(): Promise<void>
}

/** What a plugin module exports, as `default` or `register`. */
export type CollabPluginFactory = (deps: CollabPluginDeps) => CollabPlugin | Promise<CollabPlugin>

export const EE_PLUGIN_DIR = fileURLToPath(new URL('../ee/', import.meta.url))

/** The plugin entry file to load, or null when there is none (or EE is disabled). */
export function findEePlugin(
  env: NodeJS.ProcessEnv = process.env,
  dir: string = EE_PLUGIN_DIR,
): string | null {
  if (env.LEARNHOUSE_DISABLE_EE === '1') return null
  if (env.COLLAB_EE_PLUGIN) {
    const file = path.resolve(env.COLLAB_EE_PLUGIN)
    return existsSync(file) ? file : null
  }
  // Compiled first (images), then source (tsx, or Node's type stripping)
  for (const name of ['index.js', 'index.ts']) {
    const file = path.join(dir, name)
    if (existsSync(file)) return file
  }
  return null
}

/**
 * Loads and starts the plugin, or resolves to null when there is none. A
 * plugin that fails to load is logged and skipped, so the built-in rooms keep
 * working.
 */
export async function loadEePlugin(
  deps: CollabPluginDeps,
  opts: { env?: NodeJS.ProcessEnv; dir?: string } = {},
): Promise<CollabPlugin | null> {
  const file = findEePlugin(opts.env ?? process.env, opts.dir ?? EE_PLUGIN_DIR)
  if (!file) return null
  try {
    const mod = await import(pathToFileURL(file).href)
    const factory: unknown = mod.default ?? mod.register
    if (typeof factory !== 'function') {
      console.error(`[collab] EE plugin ${file} exports no default or register function; skipped`)
      return null
    }
    const plugin = await (factory as CollabPluginFactory)(deps)
    console.log(
      `[collab] EE plugin loaded: ${plugin.name} (${(plugin.kinds ?? []).map((k) => k.name).join(', ') || 'no room kinds'})`,
    )
    return plugin
  } catch (err) {
    console.error(`[collab] Failed to load EE plugin ${file}:`, err)
    return null
  }
}
