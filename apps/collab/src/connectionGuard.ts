import { randomUUID } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import type { Socket } from 'node:net'

// Hocuspocus queues every message a socket sends before it authenticates, and
// websocket upgrades never pass through onRequest. This guards the upgrade
// itself: per-IP rate and concurrency limits, a global cap on sockets that
// have not authenticated yet, an authentication deadline and a byte budget
// for everything sent before authentication.
//
// Authenticating one document does not stop the queueing: messages addressed
// to any other document on the same socket are queued until that document
// authenticates, which may be never. So after authentication the guard keeps
// counting what the socket sends against what reached a document
// (markHandled), and caps both the difference and the handled throughput.

/** Set on the upgrade request so onAuthenticate can find its connection. */
export const CONNECTION_ID_HEADER = 'x-learnhouse-collab-connection'

export function createRateLimiter(windowMs: number, max: number) {
  const hits = new Map<string, { count: number; resetAt: number }>()

  function isLimited(key: string): boolean {
    const now = Date.now()
    const entry = hits.get(key)
    if (!entry || now >= entry.resetAt) {
      hits.set(key, { count: 1, resetAt: now + windowMs })
      return false
    }
    entry.count++
    return entry.count > max
  }

  function sweep() {
    const now = Date.now()
    for (const [key, entry] of hits) {
      if (now >= entry.resetAt) hits.delete(key)
    }
  }

  return { isLimited, sweep }
}

export function clientIp(request: IncomingMessage, trustProxy: boolean): string {
  // Only read x-forwarded-for behind a trusted proxy; otherwise a client can
  // spoof the header to rotate through unlimited buckets.
  const forwarded = trustProxy
    ? (request.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim()
    : undefined
  return forwarded || request.socket.remoteAddress || 'unknown'
}

const PRIVATE_ADDRESS =
  /^(?:::ffff:)?(?:127\.|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)|^::1$|^f[cd][0-9a-f]{2}:|^fe80:/i

/** Loopback and private peers are almost always a reverse proxy. */
export function isPrivateAddress(ip: string): boolean {
  return PRIVATE_ADDRESS.test(ip)
}

export interface ConnectionGuardOptions {
  trustProxy: boolean
  rateLimitWindowMs: number
  rateLimitMax: number
  maxConnectionsPerIp: number
  maxPendingConnections: number
  authDeadlineMs: number
  preAuthMaxBytes: number
  /** Bytes an authenticated socket may send that never reach a document. */
  maxUnhandledBytes: number
  /** Bytes of document messages a socket may send per rate limit window. */
  maxHandledBytesPerWindow: number
}

// Worst-case framing of a masked client frame: 2-10 header bytes + 4 mask
// bytes. Credited per handled message so framing never counts as unhandled.
const WS_FRAME_OVERHEAD = 14

interface TrackedConnection {
  socket: Socket
  timer: NodeJS.Timeout | null
  received: number
  handled: number
  windowBytes: number
  windowResetAt: number
  countBytes: (chunk: Buffer) => void
  watchForReader: (event: string | symbol) => void
}

export function createConnectionGuard(opts: ConnectionGuardOptions) {
  const limiter = createRateLimiter(opts.rateLimitWindowMs, opts.rateLimitMax)
  const openPerIp = new Map<string, number>()
  const tracked = new Map<string, TrackedConnection>()
  const pending = new Set<string>()
  let warnedUntrustedProxy = false

  function reject(socket: Socket, status: string) {
    socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`, () =>
      socket.destroy(),
    )
  }

  /** Returns false (after answering the socket) when the upgrade is refused. */
  function admit(request: IncomingMessage, socket: Socket): boolean {
    const ip = clientIp(request, opts.trustProxy)

    if (pending.size >= opts.maxPendingConnections) {
      reject(socket, '503 Service Unavailable')
      return false
    }

    // Without a trusted proxy, a private peer is the proxy itself and every
    // user shares its address; bucketing them would throttle everyone.
    const perIp = opts.trustProxy || !isPrivateAddress(ip)
    if (!perIp && !warnedUntrustedProxy) {
      warnedUntrustedProxy = true
      console.warn(
        '[collab] Connections arrive from a private address; set COLLAB_TRUST_PROXY=true behind a reverse proxy to enable per-IP limits',
      )
    }
    if (perIp && (limiter.isLimited(ip) || (openPerIp.get(ip) ?? 0) >= opts.maxConnectionsPerIp)) {
      reject(socket, '429 Too Many Requests')
      return false
    }

    const id = randomUUID()
    request.headers[CONNECTION_ID_HEADER] = id
    if (perIp) openPerIp.set(ip, (openPerIp.get(ip) ?? 0) + 1)

    const countBytes = (chunk: Buffer) => {
      conn.received += chunk.length
      const unhandled = conn.received - conn.handled
      const budget = conn.timer ? opts.preAuthMaxBytes : opts.maxUnhandledBytes
      if (unhandled > budget) socket.destroy()
    }
    // Attaching a 'data' listener now would start the socket flowing before
    // ws takes it over and drop those bytes. Join right as ws attaches its
    // own reader instead, so every frame is seen by both.
    const watchForReader = (event: string | symbol) => {
      if (event !== 'data') return
      socket.off('newListener', watchForReader)
      socket.on('data', countBytes)
    }
    socket.on('newListener', watchForReader)

    const conn: TrackedConnection = {
      socket,
      timer: setTimeout(() => socket.destroy(), opts.authDeadlineMs),
      received: 0,
      handled: 0,
      windowBytes: 0,
      windowResetAt: 0,
      countBytes,
      watchForReader,
    }
    tracked.set(id, conn)
    pending.add(id)

    socket.once('close', () => {
      release(id)
      if (!perIp) return
      const open = (openPerIp.get(ip) ?? 1) - 1
      if (open > 0) openPerIp.set(ip, open)
      else openPerIp.delete(ip)
    })
    return true
  }

  function release(id: string) {
    const conn = tracked.get(id)
    if (!conn) return
    if (conn.timer) clearTimeout(conn.timer)
    conn.socket.off('newListener', conn.watchForReader)
    conn.socket.off('data', conn.countBytes)
    tracked.delete(id)
    pending.delete(id)
  }

  /** Lifts the deadline and the pre-auth budget once a document on the socket authenticates. */
  function markAuthenticated(id: string | null) {
    const conn = id ? tracked.get(id) : undefined
    if (!conn || !conn.timer) return
    clearTimeout(conn.timer)
    conn.timer = null
    pending.delete(id!)
  }

  /**
   * Credits a message that reached a document. Returns false, after closing
   * the socket, once the socket sends more than its handled-bytes allowance
   * for the current window.
   */
  function markHandled(id: string | null, bytes: number): boolean {
    const conn = id ? tracked.get(id) : undefined
    if (!conn) return true
    conn.handled += bytes + WS_FRAME_OVERHEAD
    const now = Date.now()
    if (now >= conn.windowResetAt) {
      conn.windowBytes = 0
      conn.windowResetAt = now + opts.rateLimitWindowMs
    }
    conn.windowBytes += bytes
    if (conn.windowBytes > opts.maxHandledBytesPerWindow) {
      conn.socket.destroy()
      return false
    }
    return true
  }

  return {
    admit,
    markAuthenticated,
    markHandled,
    sweep: limiter.sweep,
    get pendingCount() {
      return pending.size
    },
  }
}
