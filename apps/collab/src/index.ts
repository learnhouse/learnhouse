import 'dotenv/config'
import { Server } from '@hocuspocus/server'
import type { onRequestPayload, onAuthenticatePayload, onConnectPayload } from '@hocuspocus/server'
import { Database } from '@hocuspocus/extension-database'
import jwt from 'jsonwebtoken'
import Redis from 'ioredis'

const PORT = parseInt(process.env.COLLAB_PORT || '4000', 10)
const API_URL = process.env.LEARNHOUSE_API_URL || 'http://localhost:8000'
const SECRET_KEY = process.env.LEARNHOUSE_AUTH_JWT_SECRET_KEY || ''
const INTERNAL_KEY = process.env.COLLAB_INTERNAL_KEY || ''
const REDIS_URL = process.env.LEARNHOUSE_REDIS_URL || 'redis://localhost:6379'

// Timeout for all outbound HTTP requests (ms)
const FETCH_TIMEOUT_MS = 10_000

// Debounce interval before flushing ydoc state to the database (ms)
const DB_FLUSH_DELAY = 5000
// Redis TTL for cached ydoc state (seconds) — 1 hour
const REDIS_YDOC_TTL = 3600

// ── Startup validation ──────────────────────────────────────────────────────

if (!SECRET_KEY) {
  console.error('[collab] FATAL: LEARNHOUSE_AUTH_JWT_SECRET_KEY is not set')
  process.exit(1)
}

if (!INTERNAL_KEY) {
  console.error('[collab] FATAL: COLLAB_INTERNAL_KEY is not set')
  process.exit(1)
}

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

// ── Rate limiting ───────────────────────────────────────────────────────────
// Tracks connection attempts per IP to prevent brute-force/DoS
const RATE_LIMIT_WINDOW_MS = 60_000 // 1 minute
const RATE_LIMIT_MAX = 30 // max connections per IP per window
const connectionAttempts = new Map<string, { count: number; resetAt: number }>()

function isRateLimited(ip: string): boolean {
  const now = Date.now()
  const entry = connectionAttempts.get(ip)
  if (!entry || now >= entry.resetAt) {
    connectionAttempts.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    return false
  }
  entry.count++
  return entry.count > RATE_LIMIT_MAX
}

// Clean up stale entries every 5 minutes
const rateLimitCleanupInterval = setInterval(() => {
  const now = Date.now()
  for (const [ip, entry] of connectionAttempts) {
    if (now >= entry.resetAt) connectionAttempts.delete(ip)
  }
}, 5 * 60_000)

function extractBoardUuid(documentName: string): string | null {
  // Room naming: board:{board_uuid}
  const match = documentName.match(/^board:(.+)$/)
  return match ? match[1] : null
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

function redisYdocKey(boardUuid: string): string {
  return `collab:ydoc:${boardUuid}`
}

// ── Debounced DB persistence ────────────────────────────────────────────────

// Store both the timer and latest state so shutdown can flush without Redis
const pendingFlushes = new Map<
  string,
  { timer: NodeJS.Timeout; state: Uint8Array }
>()

function scheduleDbFlush(boardUuid: string, state: Uint8Array) {
  // Cancel any existing pending flush for this board
  const existing = pendingFlushes.get(boardUuid)
  if (existing) clearTimeout(existing.timer)

  // Copy the state so it survives even if the original buffer is reused
  const stateCopy = new Uint8Array(state)

  const timer = setTimeout(async () => {
    pendingFlushes.delete(boardUuid)
    try {
      const url = `${API_URL}/api/v1/boards/${boardUuid}/ydoc`
      const response = await fetchWithTimeout(url, {
        method: 'PUT',
        headers: {
          'X-Internal-Key': INTERNAL_KEY,
          'Content-Type': 'application/octet-stream',
        },
        body: stateCopy.buffer.slice(
          stateCopy.byteOffset,
          stateCopy.byteOffset + stateCopy.byteLength,
        ) as ArrayBuffer,
      })
      if (!response.ok) {
        console.error(
          `[collab] DB flush failed for ${boardUuid}: ${response.status}`,
        )
      }
    } catch (err) {
      console.error(`[collab] DB flush error for ${boardUuid}:`, err)
    }
  }, DB_FLUSH_DELAY)

  pendingFlushes.set(boardUuid, { timer, state: stateCopy })
}

// ── Server ──────────────────────────────────────────────────────────────────

// Max concurrent users per board
const MAX_BOARD_USERS = 10

const server = new Server({
  port: PORT,

  async onRequest({ request, response }: onRequestPayload) {
    // Health check endpoint — handles both "/" (k8s probe) and "/health"
    if (request.url === '/' || request.url === '/health') {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ status: 'ok' }))
      // Throw falsy value to stop the hook chain without crashing.
      // Hocuspocus re-throws truthy errors from onRequest which would
      // crash the process; falsy values are silently swallowed.
      // eslint-disable-next-line no-throw-literal
      throw null
    }

    // Rate limiting by IP
    const ip =
      (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      request.socket.remoteAddress ||
      'unknown'
    if (isRateLimited(ip)) {
      response.writeHead(429, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ error: 'Too many connection attempts' }))
      // eslint-disable-next-line no-throw-literal
      throw null
    }
  },

  async onAuthenticate({ token, documentName }: onAuthenticatePayload) {
    if (!token) {
      throw new Error('Authentication required')
    }

    // Verify JWT using same secret + algorithm as backend
    let payload: any
    try {
      payload = jwt.verify(token, SECRET_KEY, { algorithms: ['HS256'] })
    } catch {
      throw new Error('Invalid token')
    }

    const boardUuid = extractBoardUuid(documentName)
    if (!boardUuid) {
      throw new Error('Invalid document name')
    }

    // Verify board membership via backend API (with timeout)
    let response: Response
    try {
      response = await fetchWithTimeout(
        `${API_URL}/api/v1/boards/${boardUuid}/membership`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      )
    } catch (err) {
      console.error(
        `[collab] Membership check failed for ${boardUuid}:`,
        err,
      )
      throw new Error('Authentication service unavailable')
    }

    if (!response.ok) {
      throw new Error('Not authorized for this board')
    }

    const membership = await response.json()

    return {
      user: {
        id: payload.sub,
        name: membership.username || 'Unknown',
        role: membership.role,
      },
    }
  },

  async onConnect({ documentName, instance }: onConnectPayload) {
    const boardUuid = extractBoardUuid(documentName)
    if (!boardUuid) return

    // Count existing connections for this document
    const doc = instance.documents.get(documentName)
    if (doc && doc.getConnectionsCount() >= MAX_BOARD_USERS) {
      throw new Error(`Board is full (max ${MAX_BOARD_USERS} concurrent users)`)
    }
  },

  extensions: [
    new Database({
      async fetch({ documentName }) {
        const boardUuid = extractBoardUuid(documentName)
        if (!boardUuid) return null

        // 1. Try Redis first
        try {
          const r = getRedis()
          const cached = await r.getBuffer(redisYdocKey(boardUuid))
          if (cached && cached.byteLength > 0) {
            console.log(
              `[collab] Redis hit for ${boardUuid}: ${cached.byteLength} bytes`,
            )
            return new Uint8Array(cached)
          }
        } catch (err) {
          console.error(
            `[collab] Redis fetch error for ${boardUuid}:`,
            err,
          )
        }

        // 2. Fall back to database (with timeout)
        try {
          const url = `${API_URL}/api/v1/boards/${boardUuid}/ydoc`
          console.log(`[collab] Fetching ydoc from DB for ${boardUuid}`)
          const response = await fetchWithTimeout(url, {
            headers: {
              'X-Internal-Key': INTERNAL_KEY,
            },
          })

          if (!response.ok) {
            console.error(
              `[collab] Failed to fetch ydoc for ${boardUuid}: ${response.status} ${response.statusText}`,
            )
            return null
          }

          const buffer = await response.arrayBuffer()
          if (buffer.byteLength === 0) return null

          const state = new Uint8Array(buffer)
          console.log(
            `[collab] Fetched ydoc from DB for ${boardUuid}: ${buffer.byteLength} bytes`,
          )

          // Warm the Redis cache
          try {
            const r = getRedis()
            await r.setex(
              redisYdocKey(boardUuid),
              REDIS_YDOC_TTL,
              Buffer.from(state),
            )
          } catch (err) {
            console.error(
              `[collab] Redis warm error for ${boardUuid}:`,
              err,
            )
          }

          return state
        } catch (err) {
          console.error(
            `[collab] Error fetching ydoc for ${boardUuid}:`,
            err,
          )
          return null
        }
      },

      async store({ documentName, state }) {
        const boardUuid = extractBoardUuid(documentName)
        if (!boardUuid) return

        // 1. Write to Redis immediately (fast)
        try {
          const r = getRedis()
          await r.setex(
            redisYdocKey(boardUuid),
            REDIS_YDOC_TTL,
            Buffer.from(state),
          )
        } catch (err) {
          console.error(
            `[collab] Redis store error for ${boardUuid}:`,
            err,
          )
        }

        // 2. Debounced write to database (slow, batched)
        scheduleDbFlush(boardUuid, state)
      },
    }),
  ],
})

// ── Graceful shutdown ─────────────────────────────────────────────────────

async function gracefulShutdown() {
  console.log('[collab] Shutting down, flushing pending writes...')

  // Stop accepting new connections
  clearInterval(rateLimitCleanupInterval)
  await server.destroy()

  // Flush all pending writes directly from the captured state (no Redis dependency)
  const flushPromises: Promise<void>[] = []

  for (const [boardUuid, { timer, state }] of pendingFlushes) {
    clearTimeout(timer)

    const flush = async () => {
      try {
        const url = `${API_URL}/api/v1/boards/${boardUuid}/ydoc`
        await fetchWithTimeout(
          url,
          {
            method: 'PUT',
            headers: {
              'X-Internal-Key': INTERNAL_KEY,
              'Content-Type': 'application/octet-stream',
            },
            body: state.buffer.slice(
              state.byteOffset,
              state.byteOffset + state.byteLength,
            ) as ArrayBuffer,
          },
          15_000, // longer timeout for shutdown flushes
        )
        console.log(`[collab] Flushed ${boardUuid} to DB on shutdown`)
      } catch (err) {
        console.error(
          `[collab] Shutdown flush error for ${boardUuid}:`,
          err,
        )
      }
    }

    flushPromises.push(flush())
  }

  await Promise.allSettled(flushPromises)
  pendingFlushes.clear()

  if (redis) {
    await redis.quit()
  }

  process.exit(0)
}

process.on('SIGINT', gracefulShutdown)
process.on('SIGTERM', gracefulShutdown)

server.listen().then(() => {
  console.log(`Hocuspocus collab server running on port ${PORT}`)
})
