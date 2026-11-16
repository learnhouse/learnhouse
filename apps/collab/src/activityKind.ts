// Wires activity rooms to the API over HTTP and exposes them as a room kind.

import type Redis from 'ioredis'
import type { RoomKind } from './rooms.js'
import { ACTIVITY_SEATS, sanitizeActivityAwareness } from './activityPresence.js'
import {
  type ActivityApi,
  type ActivityCache,
  type ActivityRooms,
  type ActivityState,
  createActivityRooms,
  extractActivityUuid,
  parseActivityResource,
} from './activityRoom.js'

export interface ActivityKindDeps {
  apiUrl: string
  internalKey: string
  fetchWithTimeout(url: string, options?: RequestInit, timeoutMs?: number): Promise<Response>
  getRedis(): Redis
  maxYdocBytes: number
  redisTtlSeconds: number
}

/** The access endpoint's answer for a user (GET /activities/{uuid}/collab/access). */
interface AccessAnswer {
  role?: unknown
  user?: {
    id?: unknown
    username?: unknown
    display_name?: unknown
    color?: unknown
    avatar_image?: unknown
    user_uuid?: unknown
  }
}

const COLOR = /^#[0-9a-fA-F]{6}$/

/**
 * URL of an activity collab endpoint for a room's resource id: a translation
 * room (`{uuid}:{locale}`) adds `?locale=`. Throws on a malformed id (rooms
 * only ever pass ids their name parsed into).
 */
export function activityEndpoint(apiUrl: string, resourceId: string, endpoint: 'state' | 'access'): string {
  const parsed = parseActivityResource(resourceId)
  if (!parsed) throw new Error(`Invalid activity resource id: ${resourceId}`)
  const url = `${apiUrl}/api/v1/activities/${encodeURIComponent(parsed.uuid)}/collab/${endpoint}`
  return parsed.locale ? `${url}?${new URLSearchParams({ locale: parsed.locale })}` : url
}

/** Redis key of a room's recovery cache: `collab:activity:{uuid}` or `collab:activity:{uuid}:{locale}`. */
export function activityCacheKey(resourceId: string): string {
  return `collab:activity:${resourceId}`
}

export function createHttpActivityApi(deps: ActivityKindDeps): ActivityApi {
  const base = (resourceId: string) => activityEndpoint(deps.apiUrl, resourceId, 'state')
  return {
    async getState(uuid) {
      const response = await deps.fetchWithTimeout(base(uuid), {
        headers: { 'X-Internal-Key': deps.internalKey },
      })
      if (response.status === 404) return null
      if (!response.ok) throw new Error(`State fetch failed: ${response.status}`)
      return (await response.json()) as ActivityState
    },
    async putState(uuid, body) {
      const response = await deps.fetchWithTimeout(
        base(uuid),
        {
          method: 'PUT',
          headers: { 'X-Internal-Key': deps.internalKey, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
        15_000,
      )
      let json: any = {}
      try {
        json = await response.json()
      } catch {
        // empty or non-JSON error body
      }
      return {
        status: response.status,
        current_version: json?.current_version,
        version_number: json?.version_number ?? null,
      }
    },
  }
}

export function createRedisActivityCache(deps: ActivityKindDeps): ActivityCache {
  const key = activityCacheKey
  return {
    async get(uuid) {
      const [state, version] = await Promise.all([
        deps.getRedis().getBuffer(key(uuid)),
        deps.getRedis().get(`${key(uuid)}:v`),
      ])
      if (!state || state.byteLength === 0 || version === null) return null
      const parsed = Number.parseInt(version, 10)
      return Number.isFinite(parsed) ? { state: new Uint8Array(state), version: parsed } : null
    },
    async set(uuid, state, version) {
      await deps
        .getRedis()
        .multi()
        .setex(key(uuid), deps.redisTtlSeconds, Buffer.from(state))
        .setex(`${key(uuid)}:v`, deps.redisTtlSeconds, String(version))
        .exec()
    },
    async delete(uuid) {
      await deps.getRedis().del(key(uuid), `${key(uuid)}:v`)
    },
  }
}

/**
 * The presence identity for a user from the access answer. The API answers
 * for the token's user (the JWT's subject is their email, so the numeric id
 * comes from the API, never from the client).
 */
export function presenceIdentity(answer: AccessAnswer) {
  const user = answer.user ?? {}
  const id = typeof user.id === 'number' && user.id > 0 ? user.id : 0
  const name =
    (typeof user.display_name === 'string' && user.display_name.trim()) ||
    (typeof user.username === 'string' && user.username) ||
    'Unknown'
  return {
    id,
    name: name.slice(0, 80),
    color: typeof user.color === 'string' && COLOR.test(user.color) ? user.color : '#64748b',
    avatar: typeof user.avatar_image === 'string' && user.avatar_image ? user.avatar_image.slice(0, 500) : null,
    uuid: typeof user.user_uuid === 'string' ? user.user_uuid : null,
    role: answer.role === 'editor' ? 'editor' : 'viewer',
  }
}

export function createActivityKind(
  deps: ActivityKindDeps,
  rooms: ActivityRooms = createActivityRooms({
    api: createHttpActivityApi(deps),
    cache: createRedisActivityCache(deps),
    maxYdocBytes: deps.maxYdocBytes,
  }),
) {
  function fetchAccess(resourceId: string, token: string): Promise<Response> {
    return deps.fetchWithTimeout(activityEndpoint(deps.apiUrl, resourceId, 'access'), {
      headers: { Authorization: `Bearer ${token}` },
    })
  }

  const kind: RoomKind = {
    name: 'activity',
    parse: extractActivityUuid,
    seats: ACTIVITY_SEATS,
    presence: { sanitize: sanitizeActivityAwareness },
    tooLargeReason: 'Activity is too large',
    fetchAccess,

    async authorize(uuid, token) {
      let response: Response
      try {
        response = await fetchAccess(uuid, token)
      } catch (err) {
        console.error(`[collab] Access check failed for ${uuid}:`, err)
        throw new Error('Authentication service unavailable')
      }
      if (!response.ok) throw new Error('Not authorized for this activity')
      const user = presenceIdentity((await response.json()) as AccessAnswer)
      if (!user.id) throw new Error('Not authorized for this activity')
      return { readOnly: user.role !== 'editor', user }
    },

    async fetch(uuid) {
      return rooms.load(uuid)
    },

    async store(uuid) {
      await rooms.store(uuid)
    },
  }

  return { kind, rooms }
}
