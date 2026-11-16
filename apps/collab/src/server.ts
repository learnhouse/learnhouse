// The collab server: Hocuspocus plus the guards, room kinds, internal HTTP
// endpoints and access re-check. index.ts builds it from the environment;
// tests build it with fakes.

import { Server } from '@hocuspocus/server'
import type {
  onRequestPayload,
  onUpgradePayload,
  onAuthenticatePayload,
  beforeHandleMessagePayload,
  beforeHandleAwarenessPayload,
  onChangePayload,
  onStatelessPayload,
  afterLoadDocumentPayload,
  afterUnloadDocumentPayload,
} from '@hocuspocus/server'
import { Database } from '@hocuspocus/extension-database'
import jwt from 'jsonwebtoken'
import * as Y from 'yjs'
import {
  CONNECTION_ID_HEADER,
  clientIp,
  createConnectionGuard,
  createRateLimiter,
} from './connectionGuard.js'
import { createDocSizeGuard } from './docLimits.js'
import { seatRefusal } from './seats.js'
import {
  type ConnectionAuth,
  type TokenState,
  createAccessChecker,
  LIVE_EDITING_DISABLED,
  dropConnection,
  recheckConnections,
} from './accessRecheck.js'
import { type RoomKind, createRoomRegistry } from './rooms.js'
import { type ActivityRooms, parseActivityResource } from './activityRoom.js'
import {
  type InternalRoute,
  type InternalRouteContext,
  handleInternalRequest,
  isInternalPath,
} from './internalHttp.js'

// Largest Yjs state we persist (bytes): 5 MB
export const MAX_YDOC_BYTES = 5 * 1024 * 1024
// Largest single incoming WebSocket message (bytes): 2 MB
export const MAX_MESSAGE_BYTES = 2 * 1024 * 1024
// Longest a connection stays open without a successful re-check (ms)
const MAX_UNVERIFIED_MS = 10 * 60_000
// Fewest milliseconds between two named versions from one connection
const CHECKPOINT_INTERVAL_MS = 5000
// Tokens this close to expiry are treated as expired by the re-check, so a
// clock skew with the API can't turn "about to lapse" into a revoke.
const TOKEN_EXPIRY_MARGIN_MS = 30_000
// Plain HTTP requests (health checks, probes) per IP
const RATE_LIMIT_WINDOW_MS = 60_000 // 1 minute
const RATE_LIMIT_MAX = 30 // max requests per IP per window

export interface CollabServerOptions {
  port: number
  secretKey: string
  internalKey: string
  trustProxy: boolean
  /** Room kinds: the built-in ones and any a plugin adds (activities also need `activityRooms`). */
  kinds: RoomKind[]
  /** Extra /internal/* routes (from plugins). */
  internalRoutes?: InternalRoute[]
  activityRooms: ActivityRooms
  /** Hocuspocus store debounce: idle delay and the most it waits (ms). */
  debounceMs: number
  maxDebounceMs: number
  /** How often open connections re-check their access (ms); 0 disables the timer. */
  accessRecheckMs: number
  quiet?: boolean
}

export function createCollabServer(opts: CollabServerOptions) {
  const requestLimiter = createRateLimiter(RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX)

  // WebSocket upgrades never reach onRequest, so they are limited separately
  const connectionGuard = createConnectionGuard({
    trustProxy: opts.trustProxy,
    rateLimitWindowMs: RATE_LIMIT_WINDOW_MS,
    // Sized for a whole classroom behind one NAT reconnecting at once
    rateLimitMax: 300, // new sockets per IP per window (reconnects included)
    maxConnectionsPerIp: 200, // open sockets per IP (shared NAT, many tabs)
    // Last-resort memory bound; per-socket limits below keep each one cheap,
    // so this only bites under a flood
    maxPendingConnections: 2000, // unauthenticated sockets across all IPs
    authDeadlineMs: 10_000,
    preAuthMaxBytes: 256 * 1024, // auth plus the first sync step is a few KB
    // Room for a few full-size messages in flight; anything else is queued for
    // a document the socket never authenticated
    maxUnhandledBytes: 4 * MAX_MESSAGE_BYTES,
    maxHandledBytesPerWindow: 16 * 1024 * 1024,
  })

  // Stops accepting updates for a document once it outgrows what we persist
  const docSizes = createDocSizeGuard({
    maxDocBytes: MAX_YDOC_BYTES,
    remeasureEveryBytes: 256 * 1024,
  })

  // Clean up stale entries every 5 minutes
  const rateLimitCleanupInterval = setInterval(() => {
    requestLimiter.sweep()
    connectionGuard.sweep()
  }, 5 * 60_000)
  rateLimitCleanupInterval.unref()

  function tokenState(token: string): TokenState {
    try {
      const payload = jwt.verify(token, opts.secretKey, { algorithms: ['HS256'] })
      const exp = typeof payload === 'object' ? payload.exp : undefined
      if (typeof exp === 'number' && exp * 1000 - Date.now() < TOKEN_EXPIRY_MARGIN_MS) {
        return 'expired'
      }
      return 'valid'
    } catch (err) {
      return err instanceof Error && err.name === 'TokenExpiredError' ? 'expired' : 'invalid'
    }
  }

  const registry = createRoomRegistry(opts.kinds)
  const activities = opts.activityRooms

  /** Current access of a connection to its room, for re-checking open connections. */
  const checkAccess = createAccessChecker({
    tokenState,
    fetchAccess: async (auth: ConnectionAuth) => {
      const kind = registry.kind(auth.room)
      if (!kind) return { ok: false, status: 404, json: async () => null }
      return kind.fetchAccess(auth.resourceId, auth.token)
    },
  })

  // Awareness client id -> owning connection, per loaded document
  const awarenessClaims = new WeakMap<object, Map<number, any>>()
  // Last named version per connection, to rate limit checkpoints
  const lastCheckpoint = new WeakMap<object, number>()

  const server = new Server({
    port: opts.port,
    quiet: opts.quiet,
    // index.ts handles SIGINT/SIGTERM itself: Hocuspocus's own handler would
    // exit as soon as the documents unloaded, before plugins' shutdown flushes ran.
    stopOnSignals: false,
    debounce: opts.debounceMs,
    maxDebounce: opts.maxDebounceMs,
    // ws drops oversized frames before they are buffered into a document
    websocketOptions: { maxPayload: MAX_MESSAGE_BYTES },

    async beforeHandleMessage({
      update,
      documentName,
      connection,
      requestHeaders,
    }: beforeHandleMessagePayload) {
      // Backstop for the ws cap: throwing closes the connection
      if (update.byteLength > MAX_MESSAGE_BYTES) {
        console.warn(`[collab] Rejecting ${update.byteLength}-byte message for ${documentName}`)
        throw new Error('Message too large')
      }
      if (!connectionGuard.markHandled(requestHeaders.get(CONNECTION_ID_HEADER), update.byteLength)) {
        throw new Error('Too much traffic')
      }
      if (docSizes.isOversized(documentName)) {
        const reason = registry.resolve(documentName)?.kind.tooLargeReason ?? 'Document is too large'
        dropConnection(connection, { code: 4413, reason })
        throw new Error(reason)
      }
    },

    async beforeHandleAwareness({
      connection,
      document,
      states,
      removedClients,
    }: beforeHandleAwarenessPayload) {
      // Server-internal writes have no connection and are trusted
      if (!connection) return
      let claims = awarenessClaims.get(document)
      if (!claims) {
        claims = new Map()
        awarenessClaims.set(document, claims)
      }
      const room = registry.resolve(document.name)
      if (!room) {
        // Unknown room kinds never authenticate; drop whatever reaches here
        states.clear()
        removedClients.clear()
        return
      }
      room.kind.presence.sanitize(connection, states, removedClients, claims, document.getConnections())
    },

    async afterLoadDocument({ documentName, document }: afterLoadDocumentPayload) {
      docSizes.measure(documentName, document)
      const room = registry.resolve(documentName)
      if (room?.kind.name === 'activity') activities.afterLoad(room.resourceId, document)
    },

    async onChange({ documentName, document, update, transactionOrigin, context }: onChangePayload) {
      const room = registry.resolve(documentName)
      if (room?.kind.name === 'activity') {
        activities.recordChange(room.resourceId, transactionOrigin, context?.user?.id ?? null)
      }
      if (docSizes.isOversized(documentName)) return
      if (docSizes.recordUpdate(documentName, document, update.byteLength)) {
        // Everyone leaves so the document unloads; store() refuses the oversized
        // state, so it reloads from the last state that fit.
        console.warn(`[collab] ${documentName} passed the size cap; closing its connections`)
        const reason = room?.kind.tooLargeReason ?? 'Document is too large'
        for (const connection of document.getConnections()) {
          dropConnection(connection, { code: 4413, reason })
        }
      }
    },

    async onStateless({ connection, documentName, payload }: onStatelessPayload) {
      // Named versions ("Save version"), editors of activity rooms only
      const room = registry.resolve(documentName)
      if (room?.kind.name !== 'activity' || connection.readOnly) return
      let message: any
      try {
        message = JSON.parse(payload)
      } catch {
        return
      }
      if (message?.type !== 'checkpoint') return
      const requestId = typeof message.requestId === 'string' ? message.requestId.slice(0, 64) : undefined
      // Translations have no version history: named versions are refused
      if (parseActivityResource(room.resourceId)?.locale) {
        connection.sendStateless(JSON.stringify({ type: 'checkpoint', ok: false, version: null, requestId }))
        return
      }
      const now = Date.now()
      if (now - (lastCheckpoint.get(connection) ?? 0) < CHECKPOINT_INTERVAL_MS) {
        connection.sendStateless(JSON.stringify({ type: 'checkpoint', ok: false, version: null, requestId }))
        return
      }
      lastCheckpoint.set(connection, now)
      const label = typeof message.label === 'string' ? message.label : ''
      const userId = Number(connection.context?.user?.id)
      const result = await activities.checkpoint(room.resourceId, label, userId)
      connection.sendStateless(
        JSON.stringify({
          type: 'checkpoint',
          ok: result?.status === 200,
          version: result?.version_number ?? null,
          requestId,
        }),
      )
    },

    async afterUnloadDocument({ documentName }: afterUnloadDocumentPayload) {
      docSizes.forget(documentName)
      const room = registry.resolve(documentName)
      if (room?.kind.name === 'activity') await activities.unload(room.resourceId)
    },

    async onRequest({ request, response }: onRequestPayload) {
      // Health check endpoint. Handles both "/" (k8s probe) and "/health"
      if (request.url === '/' || request.url === '/health') {
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ status: 'ok' }))
        // Throw falsy value to stop the hook chain without crashing.
        // Hocuspocus re-throws truthy errors from onRequest which would
        // crash the process; falsy values are silently swallowed.
        // eslint-disable-next-line no-throw-literal
        throw null
      }

      // The API's notifications. Authorized by the internal key and not
      // rate limited (bulk writes notify in bursts) unless the key is wrong.
      if (isInternalPath(request.url)) {
        const authorized = await handleInternalRequest(request, response, {
          internalKey: opts.internalKey,
          rooms: activities,
          maxBodyBytes: 2 * MAX_YDOC_BYTES,
          kick: kickActivityRooms,
          routes: opts.internalRoutes,
          context: internalRouteContext,
        })
        if (!authorized) requestLimiter.isLimited(clientIp(request, opts.trustProxy))
        // eslint-disable-next-line no-throw-literal
        throw null
      }

      if (requestLimiter.isLimited(clientIp(request, opts.trustProxy))) {
        response.writeHead(429, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ error: 'Too many connection attempts' }))
        // eslint-disable-next-line no-throw-literal
        throw null
      }
    },

    async onUpgrade({ request, socket }: onUpgradePayload) {
      if (!connectionGuard.admit(request, socket)) {
        // Falsy throw stops the upgrade without crashing (see onRequest)
        // eslint-disable-next-line no-throw-literal
        throw null
      }
    },

    async onAuthenticate({
      token,
      documentName,
      connectionConfig,
      requestHeaders,
      instance,
      socketId,
    }: onAuthenticatePayload) {
      if (!token) {
        throw new Error('Authentication required')
      }

      // Verify JWT using same secret + algorithm as backend
      let payload: any
      try {
        payload = jwt.verify(token, opts.secretKey, { algorithms: ['HS256'] })
      } catch {
        throw new Error('Invalid token')
      }

      const room = registry.resolve(documentName)
      if (!room) {
        throw new Error('Invalid document name')
      }

      // Verify access via the backend API (with timeout)
      const access = await room.kind.authorize(room.resourceId, token, payload.sub)

      // Viewers' sockets must not write.
      connectionConfig.readOnly = access.readOnly

      // Seats are checked here, once the role is known: viewers and editors
      // have separate seats so viewers can't crowd editors out.
      const existing = instance.documents.get(documentName)?.getConnections() ?? []
      const refusal = seatRefusal(existing, { readOnly: connectionConfig.readOnly, socketId }, room.kind.seats)
      if (refusal) {
        throw new Error(refusal)
      }

      connectionGuard.markAuthenticated(requestHeaders.get(CONNECTION_ID_HEADER))

      return {
        user: access.user,
        // Kept for the periodic access re-check
        auth: {
          token,
          room: room.kind.name,
          resourceId: room.resourceId,
          verifiedAt: Date.now(),
        } satisfies ConnectionAuth,
      }
    },

    extensions: [
      new Database({
        async fetch({ documentName }) {
          const room = registry.resolve(documentName)
          if (!room) return null
          return room.kind.fetch(room.resourceId)
        },

        async store({ documentName, state }) {
          const room = registry.resolve(documentName)
          if (!room) return
          await room.kind.store(room.resourceId, state)
        },
      }),
    ],
  })

  /** Loaded documents, for plugins' internal routes. */
  const internalRouteContext: InternalRouteContext = {
    applyUpdate(documentName, update, origin) {
      const document = server.hocuspocus.documents.get(documentName)
      if (!document) return false
      Y.applyUpdate(document, update, origin)
      return true
    },
    encodeState(documentName) {
      const document = server.hocuspocus.documents.get(documentName)
      return document ? Y.encodeStateAsUpdate(document) : null
    },
    broadcastStateless(documentName, payload) {
      const document = server.hocuspocus.documents.get(documentName)
      if (!document) return false
      document.broadcastStateless(payload)
      return true
    },
    async recheck(documentName) {
      const document = server.hocuspocus.documents.get(documentName)
      if (!document) return null
      return recheckConnections(document.getConnections(), checkAccess, { maxUnverifiedMs: MAX_UNVERIFIED_MS })
    },
  }

  /**
   * Live editing was turned off for these activities: save each open room
   * (so nothing typed is lost), then close its connections with a code the
   * editor understands (it switches to saving manually). Covers the default
   * room and every translation room (`activity:{uuid}:{locale}`).
   */
  async function kickActivityRooms(uuids: string[]): Promise<number> {
    const wanted = new Set(uuids)
    let closed = 0
    for (const document of [...server.hocuspocus.documents.values()]) {
      const room = registry.resolve(document.name)
      if (room?.kind.name !== 'activity') continue
      const parsed = parseActivityResource(room.resourceId)
      if (!parsed || !wanted.has(parsed.uuid)) continue
      await activities.flush(room.resourceId)
      for (const connection of document.getConnections()) dropConnection(connection, LIVE_EDITING_DISABLED)
      closed++
    }
    return closed
  }

  // ── Access re-check ────────────────────────────────────────────────────

  let recheckRunning = false
  async function recheckAccess() {
    if (recheckRunning) return
    recheckRunning = true
    try {
      // One document at a time keeps the burst of API calls to one room's users
      for (const document of [...server.hocuspocus.documents.values()]) {
        const closed = await recheckConnections(document.getConnections(), checkAccess, {
          maxUnverifiedMs: MAX_UNVERIFIED_MS,
        })
        if (closed > 0) {
          console.log(`[collab] Closed ${closed} connection(s) on ${document.name} after the access re-check`)
        }
      }
    } catch (err) {
      console.error('[collab] Access re-check failed:', err)
    } finally {
      recheckRunning = false
    }
  }
  const accessRecheckInterval =
    opts.accessRecheckMs > 0 ? setInterval(recheckAccess, opts.accessRecheckMs) : null

  /**
   * Stops accepting connections, closes the open ones and runs every pending
   * store right away; resolves once every document has unloaded (which waits
   * for the activity saves those stores started) and the room queues drained.
   */
  async function destroy() {
    clearInterval(rateLimitCleanupInterval)
    if (accessRecheckInterval) clearInterval(accessRecheckInterval)
    await server.destroy()
    // Keep-alive HTTP connections (probes, the API's notifications) would
    // otherwise hold the process open
    server.httpServer.closeAllConnections?.()
    await activities.drain()
  }

  return { server, registry, recheckAccess, destroy }
}
