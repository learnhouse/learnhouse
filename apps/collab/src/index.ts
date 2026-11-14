import 'dotenv/config'
import Redis from 'ioredis'
import { createActivityKind } from './activityKind.js'
import { createLiveNotesRoom } from './liveNotesRoom.js'
import { MAX_YDOC_BYTES, createCollabServer } from './server.js'
import { type CollabPluginDeps, loadEePlugin } from './plugins.js'

// Multi-instance note: rooms live in this process's memory. Running more than
// one replica requires sticky routing by document name (every socket of a
// room must reach the same replica), e.g. a consistent-hash on the room in
// the ingress. Without it two replicas would each persist their own copy.

const PORT = parseInt(process.env.COLLAB_PORT || '4000', 10)
const API_URL = process.env.LEARNHOUSE_API_URL || 'http://localhost:8000'
const SECRET_KEY = process.env.LEARNHOUSE_AUTH_JWT_SECRET_KEY || ''
const INTERNAL_KEY = process.env.COLLAB_INTERNAL_KEY || ''
const REDIS_URL = process.env.LEARNHOUSE_REDIS_URL || 'redis://localhost:6379'
// Only honor x-forwarded-for when a trusted proxy is known to set it.
// Without this flag, a direct client can spoof the header per request and
// bypass the rate limiter by presenting a fresh IP each time.
const TRUST_PROXY = process.env.COLLAB_TRUST_PROXY === 'true'

// Timeout for all outbound HTTP requests (ms)
const FETCH_TIMEOUT_MS = 10_000
// Redis TTL for cached ydoc state (seconds): 1 hour
const REDIS_YDOC_TTL = 3600
// How often open connections re-check their access to their room (ms)
const ACCESS_RECHECK_MS = 60_000
// Hocuspocus store debounce: activity content is saved after 2 s without an
// edit, and at least every 10 s while edits keep coming (plugin room kinds may
// add their own database debounce on top).
const STORE_DEBOUNCE_MS = 2000
const STORE_MAX_DEBOUNCE_MS = 10_000

// ── Startup validation ──────────────────────────────────────────────────────

// Placeholders shipped in .env.example (old and current) must never be used.
const PLACEHOLDER_SECRETS = new Set([
  'your-jwt-secret-key',
  'your-internal-key',
  'CHANGE_ME_generate_with_openssl_rand_hex_32',
])
const MIN_SECRET_LENGTH = 32

function requireStrongSecret(name: string, value: string) {
  if (!value) {
    console.error(`[collab] FATAL: ${name} is not set`)
    process.exit(1)
  }
  if (PLACEHOLDER_SECRETS.has(value)) {
    console.error(
      `[collab] FATAL: ${name} is still the example placeholder (generate one with: openssl rand -hex 32)`,
    )
    process.exit(1)
  }
  // Warn rather than refuse so an existing deployment keeps booting.
  if (value.length < MIN_SECRET_LENGTH) {
    console.warn(
      `[collab] ${name} is shorter than ${MIN_SECRET_LENGTH} characters; rotate it (openssl rand -hex 32)`,
    )
  }
}

requireStrongSecret('LEARNHOUSE_AUTH_JWT_SECRET_KEY', SECRET_KEY)
requireStrongSecret('COLLAB_INTERNAL_KEY', INTERNAL_KEY)

// ── Fetch with timeout helper ─────────────────────────────────────────────

function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  return fetch(url, { ...options, signal: controller.signal }).finally(() =>
    clearTimeout(timer),
  )
}

// ── Redis connection ────────────────────────────────────────────────────────

let redis: Redis | null = null

function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    })
    redis.on('error', (err) => {
      console.error('[collab] Redis error:', err.message)
    })
    redis.connect().catch((err) => {
      console.error('[collab] Redis connection failed:', err)
    })
  }
  return redis
}

// ── Server ──────────────────────────────────────────────────────────────────

const deps: CollabPluginDeps = {
  apiUrl: API_URL,
  internalKey: INTERNAL_KEY,
  fetchWithTimeout,
  getRedis,
  maxYdocBytes: MAX_YDOC_BYTES,
  redisTtlSeconds: REDIS_YDOC_TTL,
}
const activities = createActivityKind(deps)

// Live session notes (Enterprise): the API answers 404 without it, so the
// room simply refuses to open.
const liveNotes = createLiveNotesRoom({
  apiUrl: API_URL,
  internalKey: INTERNAL_KEY,
  fetchWithTimeout,
  maxYdocBytes: MAX_YDOC_BYTES,
})

// Enterprise plugin (boards and more), when ee/ is present
const plugin = await loadEePlugin(deps)

const collab = createCollabServer({
  port: PORT,
  secretKey: SECRET_KEY,
  internalKey: INTERNAL_KEY,
  trustProxy: TRUST_PROXY,
  kinds: [activities.kind, liveNotes, ...(plugin?.kinds ?? [])],
  internalRoutes: plugin?.internalRoutes,
  activityRooms: activities.rooms,
  debounceMs: STORE_DEBOUNCE_MS,
  maxDebounceMs: STORE_MAX_DEBOUNCE_MS,
  accessRecheckMs: ACCESS_RECHECK_MS,
})

// ── Graceful shutdown ─────────────────────────────────────────────────────

let shuttingDown = false
async function gracefulShutdown() {
  if (shuttingDown) return
  shuttingDown = true
  console.log('[collab] Shutting down, flushing pending writes...')

  // Closes every connection and saves every room (activities included)
  await collab.destroy()
  // Plugins' own pending writes (e.g. a debounced database flush)
  try {
    await plugin?.shutdown?.()
  } catch (err) {
    console.error('[collab] Plugin shutdown failed:', err)
  }

  if (redis) {
    await redis.quit()
  }

  process.exit(0)
}

process.on('SIGINT', gracefulShutdown)
process.on('SIGTERM', gracefulShutdown)

collab.server.listen().then(() => {
  console.log(`Hocuspocus collab server running on port ${PORT}`)
})
