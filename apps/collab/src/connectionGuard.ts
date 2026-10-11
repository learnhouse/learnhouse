import { randomUUID } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import type { Socket } from 'node:net'

// Hocuspocus queues every message a socket sends before it authenticates, and
// websocket upgrades never pass through onRequest. This guards the upgrade
// itself: per-IP rate and concurrency limits, a global cap on sockets that
// have not authenticated yet, an authentication deadline and a byte budget
// for everything sent before authentication.

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
}

interface PendingConnection {
  socket: Socket
  timer: NodeJS.Timeout
  countBytes: (chunk: Buffer) => void
  watchForReader: (event: string | symbol) => void
}

export function createConnectionGuard(opts: ConnectionGuardOptions) {
  const limiter = createRateLimiter(opts.rateLimitWindowMs, opts.rateLimitMax)
  const openPerIp = new Map<string, number>()
  const pending = new Map<string, PendingConnection>()
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

    let received = 0
    const countBytes = (chunk: Buffer) => {
      received += chunk.length
      if (received > opts.preAuthMaxBytes) socket.destroy()
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

    const timer = setTimeout(() => socket.destroy(), opts.authDeadlineMs)
    pending.set(id, { socket, timer, countBytes, watchForReader })

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
    const conn = pending.get(id)
    if (!conn) return
    clearTimeout(conn.timer)
    conn.socket.off('newListener', conn.watchForReader)
    conn.socket.off('data', conn.countBytes)
    pending.delete(id)
  }

  /** Lifts the deadline and byte budget once a document on the socket authenticates. */
  function markAuthenticated(id: string | null) {
    if (id) release(id)
  }

  return {
    admit,
    markAuthenticated,
    sweep: limiter.sweep,
    get pendingCount() {
      return pending.size
    },
  }
}
