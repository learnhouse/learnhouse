// Internal HTTP endpoints the API calls (shared X-Internal-Key):
//
//   POST /internal/activity/{activity_uuid}/reset[?locale={locale}]
//     body {content, current_version, by?: {id, name}}
//     The activity's content (or, with `locale`, that translation's content)
//     was written outside its collab room. A loaded room takes the new
//     content in one transaction; otherwise its cached state is dropped.
//     Only the room of that language is touched.
//
//   POST /internal/activities/kick  body {activity_uuids}
//     Saves and closes every open room of those activities (the default room
//     and each translation room).
//
// Plugins (see plugins.ts) add their own routes as `InternalRoute`s: a method,
// a path pattern and a handler, behind the same key check.

import { timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { type ActivityRooms, type Editor, activityResourceId, isValidLocale } from './activityRoom.js'

const KICK_PATH = '/internal/activities/kick'
const ACTIVITY_UUID = /^activity_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const MAX_KICK_UUIDS = 1000

const RESET_PATH =
  /^\/internal\/activity\/(activity_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/reset$/

export function isInternalPath(url: string | undefined): boolean {
  return typeof url === 'string' && url.startsWith('/internal/')
}

export function keyMatches(given: unknown, expected: string): boolean {
  if (typeof given !== 'string' || !expected) return false
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

function send(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify(body))
}

function readBody(request: IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    let tooLarge = false
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => {
      size += chunk.byteLength
      // Keep reading (and discarding) so the request ends and gets an answer
      if (size > maxBytes) tooLarge = true
      else chunks.push(chunk)
    })
    request.on('end', () =>
      tooLarge ? reject(new Error('Body too large')) : resolve(Buffer.concat(chunks).toString('utf8')),
    )
    request.on('error', reject)
  })
}

/** Loaded documents, for routes that act on a live room. */
export interface InternalRouteContext {
  /** Applies a Yjs update to a loaded document; false when it isn't loaded. */
  applyUpdate(documentName: string, update: Uint8Array, origin: unknown): boolean
  /** A loaded document's full state as an update; null when it isn't loaded. */
  encodeState(documentName: string): Uint8Array | null
  /**
   * Sends a stateless message to every connection of a loaded document;
   * false when it isn't loaded. Clients can't send these to each other (the
   * server never relays theirs), so only the API speaks through it.
   */
  broadcastStateless(documentName: string, payload: string): boolean
  /**
   * Re-runs the access check of every connection of a loaded document now
   * (instead of at the next periodic re-check); resolves to how many were
   * closed, or null when the document isn't loaded.
   */
  recheck(documentName: string): Promise<number | null>
}

export interface InternalRouteRequest {
  /** The path's regex match (capture groups included). */
  match: RegExpMatchArray
  query: URLSearchParams
  /** Reads the body as text; rejects past the server's body limit. */
  readBody(): Promise<string>
}

export interface InternalRoute {
  method: string
  /** Matched against the path without its query string. */
  path: RegExp
  handle(
    request: InternalRouteRequest,
    context: InternalRouteContext,
  ): Promise<{ status: number; body: unknown }> | { status: number; body: unknown }
}

function parseEditor(value: unknown): Editor | null {
  if (!value || typeof value !== 'object') return null
  const { id, name } = value as Record<string, unknown>
  if (typeof id !== 'number' || typeof name !== 'string') return null
  return { id, name: name.slice(0, 80) }
}

/**
 * Handles an /internal/* request. Returns false when the key is wrong, so
 * the caller can count the attempt against its rate limit.
 */
export async function handleInternalRequest(
  request: IncomingMessage,
  response: ServerResponse,
  deps: {
    internalKey: string
    rooms: ActivityRooms
    maxBodyBytes: number
    /** Saves and closes the given activity rooms; resolves to how many were open. */
    kick?: (uuids: string[]) => Promise<number>
    /** Routes added by plugins, tried before the activity reset route. */
    routes?: readonly InternalRoute[]
    context?: InternalRouteContext
  },
): Promise<boolean> {
  if (!keyMatches(request.headers['x-internal-key'], deps.internalKey)) {
    send(response, 403, { error: 'Invalid internal key' })
    return false
  }
  const url = request.url ?? ''
  const queryAt = url.indexOf('?')
  const path = queryAt === -1 ? url : url.slice(0, queryAt)
  const query = queryAt === -1 ? '' : url.slice(queryAt + 1)
  if (path === KICK_PATH && request.method === 'POST' && deps.kick) {
    let payload: any
    try {
      payload = JSON.parse(await readBody(request, deps.maxBodyBytes))
    } catch {
      send(response, 400, { error: 'Invalid body' })
      return true
    }
    const uuids = Array.isArray(payload?.activity_uuids)
      ? payload.activity_uuids.filter((u: unknown): u is string => typeof u === 'string' && ACTIVITY_UUID.test(u))
      : null
    if (!uuids || uuids.length > MAX_KICK_UUIDS) {
      send(response, 400, { error: `activity_uuids must be a list of at most ${MAX_KICK_UUIDS} activity uuids` })
      return true
    }
    try {
      send(response, 200, { closed_rooms: await deps.kick(uuids) })
    } catch (err) {
      console.error('[collab] kick failed:', err)
      send(response, 500, { error: 'Kick failed' })
    }
    return true
  }
  for (const route of deps.routes ?? []) {
    const routeMatch = path.match(route.path)
    if (!routeMatch || request.method !== route.method || !deps.context) continue
    try {
      const result = await route.handle(
        { match: routeMatch, query: new URLSearchParams(query), readBody: () => readBody(request, deps.maxBodyBytes) },
        deps.context,
      )
      send(response, result.status, result.body)
    } catch (err) {
      console.error(`[collab] internal route ${request.method} ${path} failed:`, err)
      send(response, 500, { error: 'Internal error' })
    }
    return true
  }
  const match = path.match(RESET_PATH)
  if (!match || request.method !== 'POST') {
    send(response, 404, { error: 'Not found' })
    return true
  }

  // `?locale=` targets that translation's room; absent = the default room
  const locale = new URLSearchParams(query).get('locale')
  if (locale !== null && !isValidLocale(locale)) {
    send(response, 400, { error: 'Invalid locale' })
    return true
  }
  const resourceId = activityResourceId(match[1], locale)

  let payload: any
  try {
    payload = JSON.parse(await readBody(request, deps.maxBodyBytes))
  } catch {
    send(response, 400, { error: 'Invalid body' })
    return true
  }
  if (!payload || typeof payload !== 'object' || !Number.isInteger(payload.current_version)) {
    send(response, 400, { error: 'current_version is required' })
    return true
  }

  try {
    const result = await deps.rooms.reset(resourceId, {
      content: payload.content,
      current_version: payload.current_version,
      by: parseEditor(payload.by),
    })
    send(response, 200, { result })
  } catch (err) {
    console.error(`[collab] reset failed for ${resourceId}:`, err)
    send(response, 500, { error: 'Reset failed' })
  }
  return true
}
