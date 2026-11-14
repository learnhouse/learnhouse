import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { ACTIVITY_SEATS, presenceUserOf, sanitizeActivityAwareness } from '../src/activityPresence.ts'
import { seatRefusal } from '../src/seats.ts'
import { createRoomRegistry, type RoomKind } from '../src/rooms.ts'
import { extractLiveNotesUuid } from '../src/liveNotesRoom.ts'
import { createActivityKind, presenceIdentity } from '../src/activityKind.ts'
import { handleInternalRequest, isInternalPath, keyMatches } from '../src/internalHttp.ts'
import type { ActivityRooms } from '../src/activityRoom.ts'

const UUID = 'activity_12345678-1234-1234-1234-123456789abc'
const SESSION = 'livesession_12345678-1234-1234-1234-123456789abc'

function conn(user: Record<string, unknown>, readOnly = false) {
  return { readOnly, context: { user } }
}

describe('activity presence', () => {
  const ada = conn({ id: 1, name: 'Ada', color: '#ff0000', avatar: 'ada.png', uuid: 'user_1' })
  const bob = conn({ id: 2, name: 'Bob', color: '#00ff00', avatar: null, uuid: 'user_2' })

  it('forces the identity from the connection and keeps only allowed fields', () => {
    const claims = new Map()
    const states = new Map<number, Record<string, any>>([
      [
        10,
        {
          user: { id: 2, name: 'Bob (spoofed)', color: '#000000' },
          cursor: { anchor: { type: 'x' }, head: { type: 'y' } },
          idle: true,
          typing: 'yes',
          chatBubble: 'hello everyone',
          huge: 'x'.repeat(10_000),
        },
      ],
    ])
    sanitizeActivityAwareness(ada, states, new Set(), claims, [ada, bob])
    assert.deepEqual(states.get(10), {
      user: { id: 1, name: 'Ada', color: '#ff0000', avatar: 'ada.png', uuid: 'user_1' },
      cursor: { anchor: { type: 'x' }, head: { type: 'y' } },
      idle: true,
    })
  })

  it('drops malformed or oversized cursors', () => {
    for (const cursor of [null, 'x', [], { anchor: 1, head: {} }, { anchor: {}, head: { big: 'x'.repeat(3000) } }]) {
      const states = new Map<number, Record<string, any>>([[1, { cursor }]])
      sanitizeActivityAwareness(ada, states, new Set(), new Map(), [ada])
      assert.equal('cursor' in states.get(1)!, false)
    }
    const circular: any = { anchor: {}, head: {} }
    circular.head.self = circular
    const states = new Map<number, Record<string, any>>([[1, { cursor: circular }]])
    sanitizeActivityAwareness(ada, states, new Set(), new Map(), [ada])
    assert.equal('cursor' in states.get(1)!, false)
  })

  it('pins client ids to their connection and blocks removing other people', () => {
    const claims = new Map()
    sanitizeActivityAwareness(ada, new Map([[1, {}]]), new Set(), claims, [ada, bob])
    // Bob tries to overwrite and to remove Ada's client
    const states = new Map<number, Record<string, any>>([[1, { cursor: { anchor: {}, head: {} } }]])
    const removed = new Set([1])
    sanitizeActivityAwareness(bob, states, removed, claims, [ada, bob])
    assert.equal(states.size, 0)
    assert.equal(removed.size, 0)
    // Ada removes her own
    const own = new Set([1])
    sanitizeActivityAwareness(ada, new Map(), own, claims, [ada, bob])
    assert.equal(own.size, 1)
    assert.equal(claims.has(1), false)
    // A closed connection's id can be claimed again
    sanitizeActivityAwareness(ada, new Map([[5, {}]]), new Set(), claims, [ada])
    const reclaimed = new Map<number, Record<string, any>>([[5, {}]])
    sanitizeActivityAwareness(bob, reclaimed, new Set(), claims, [bob])
    assert.equal(reclaimed.get(5)!.user.name, 'Bob')
  })

  it('fills a safe identity when the context is incomplete', () => {
    assert.deepEqual(presenceUserOf({ readOnly: true }), {
      id: 0,
      name: 'Unknown',
      color: '#64748b',
      avatar: null,
      uuid: null,
    })
  })

  it('gives activities their own, larger seat limits', () => {
    const editors = Array.from({ length: 49 }, (_, i) => ({ readOnly: false, socketId: `e${i}` }))
    assert.equal(seatRefusal(editors, { readOnly: false, socketId: 'new' }, ACTIVITY_SEATS), null)
    editors.push({ readOnly: false, socketId: 'e49' })
    assert.match(seatRefusal(editors, { readOnly: false, socketId: 'new' }, ACTIVITY_SEATS) ?? '', /Activity is full \(max 50/)
    assert.equal(seatRefusal(editors, { readOnly: true, socketId: 'viewer' }, ACTIVITY_SEATS), null)
    const viewers = Array.from({ length: 50 }, (_, i) => ({ readOnly: true, socketId: `v${i}` }))
    assert.match(seatRefusal(viewers, { readOnly: true, socketId: 'new' }, ACTIVITY_SEATS) ?? '', /50 viewers/)
    assert.match(
      seatRefusal([{ readOnly: false, socketId: 's' }, { readOnly: false, socketId: 's' }], { readOnly: false, socketId: 's' }, ACTIVITY_SEATS) ?? '',
      /this activity on one connection/,
    )
  })
})

describe('room registry', () => {
  const stub = (name: string, parse: (n: string) => string | null) => ({ name, parse }) as unknown as RoomKind
  const registry = createRoomRegistry([
    stub('livenotes', extractLiveNotesUuid),
    stub('activity', (n) => (n === `activity:${UUID}` ? UUID : null)),
  ])

  it('routes each document name to its kind', () => {
    assert.equal(registry.resolve(`livenotes:${SESSION}`)?.kind.name, 'livenotes')
    assert.equal(registry.resolve(`livenotes:${SESSION}`)?.resourceId, SESSION)
    assert.equal(registry.resolve(`activity:${UUID}`)?.resourceId, UUID)
    assert.equal(registry.kind('activity')?.name, 'activity')
  })

  it('rejects unknown kinds and malformed ids', () => {
    for (const name of ['', 'course:x', `livenotes:${UUID}`, `activity:${SESSION}`, 'livenotes:livesession_short', 'activity']) {
      assert.equal(registry.resolve(name), null, name)
    }
    assert.equal(registry.kind('course'), undefined)
  })
})

describe('activity access', () => {
  it('builds the presence identity from the API answer', () => {
    assert.deepEqual(
      presenceIdentity(
        { role: 'editor', user: { id: 7, username: 'ada', display_name: 'Ada L.', color: '#AABBCC', avatar_image: 'a.png', user_uuid: 'user_7' } },
      ),
      { id: 7, name: 'Ada L.', color: '#AABBCC', avatar: 'a.png', uuid: 'user_7', role: 'editor' },
    )
    assert.deepEqual(presenceIdentity({ role: 'nope', user: { username: 'bob', color: 'red' } }), {
      id: 0,
      name: 'bob',
      color: '#64748b',
      avatar: null,
      uuid: null,
      role: 'viewer',
    })
    assert.equal(presenceIdentity({}).name, 'Unknown')
  })

  function kindWith(reply: () => Promise<Response>) {
    const calls: string[] = []
    const { kind } = createActivityKind(
      {
        apiUrl: 'http://api',
        internalKey: 'k',
        fetchWithTimeout: async (url) => {
          calls.push(url)
          return reply()
        },
        getRedis: () => {
          throw new Error('unused')
        },
        maxYdocBytes: 1e6,
        redisTtlSeconds: 60,
      },
      {} as ActivityRooms,
    )
    return { kind, calls }
  }

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

  it('authorizes editors read-write and viewers read-only', async () => {
    const editor = kindWith(async () => json(200, { role: 'editor', user: { id: 1, username: 'ada' } }))
    assert.deepEqual(await editor.kind.authorize(UUID, 'tok', 1), {
      readOnly: false,
      user: { id: 1, name: 'ada', color: '#64748b', avatar: null, uuid: null, role: 'editor' },
    })
    assert.deepEqual(editor.calls, [`http://api/api/v1/activities/${UUID}/collab/access`])
    const viewer = kindWith(async () => json(200, { role: 'viewer', user: { id: 1 } }))
    assert.equal((await viewer.kind.authorize(UUID, 'tok', 1)).readOnly, true)
  })

  it('refuses learners, an answer without a user and an unreachable API', async () => {
    await assert.rejects(kindWith(async () => json(403, {})).kind.authorize(UUID, 't', 1), /Not authorized/)
    await assert.rejects(
      kindWith(async () => json(200, { role: 'editor', user: {} })).kind.authorize(UUID, 't', 1),
      /Not authorized/,
    )
    await assert.rejects(
      kindWith(async () => {
        throw new Error('ECONNREFUSED')
      }).kind.authorize(UUID, 't', 1),
      /unavailable/,
    )
  })
})

describe('internal HTTP: kick', () => {
  it('closes the listed rooms, ignoring malformed uuids', async () => {
    let fail = false
    const seen: string[][] = []
    const server = http.createServer(async (req, res) => {
      await handleInternalRequest(req, res, {
        internalKey: 'secret-key',
        rooms: {} as ActivityRooms,
        maxBodyBytes: 100_000,
        kick: async (uuids) => {
          if (fail) throw new Error('boom')
          seen.push(uuids)
          return uuids.length
        },
      })
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/internal/activities/kick`
    const post = (body: string, key = 'secret-key') => fetch(url, { method: 'POST', headers: { 'X-Internal-Key': key }, body })
    const ok = await post(JSON.stringify({ activity_uuids: [UUID, 'activity_../../x', 7] }))
    assert.deepEqual(await ok.json(), { closed_rooms: 1 })
    assert.deepEqual(seen, [[UUID]])
    assert.equal((await post('{}', 'wrong')).status, 403)
    assert.equal((await post('nope')).status, 400)
    assert.equal((await post(JSON.stringify({ activity_uuids: 'x' }))).status, 400)
    assert.equal((await post(JSON.stringify({ activity_uuids: Array(1001).fill(UUID) }))).status, 400)
    fail = true
    assert.equal((await post(JSON.stringify({ activity_uuids: [UUID] }))).status, 500)
    server.closeAllConnections()
    await new Promise((r) => server.close(r))
  })
})

describe('internal HTTP', () => {
  async function serve(rooms: Partial<ActivityRooms>, kick?: (uuids: string[]) => Promise<number>) {
    const results: boolean[] = []
    const server = http.createServer(async (req, res) => {
      results.push(await handleInternalRequest(req, res, { internalKey: 'secret-key', rooms: rooms as ActivityRooms, maxBodyBytes: 100_000, kick }))
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    return {
      base,
      results,
      close: () =>
        new Promise((r) => {
          server.closeAllConnections()
          server.close(r)
        }),
    }
  }

  it('matches keys in constant time and only exactly', () => {
    assert.equal(keyMatches('secret-key', 'secret-key'), true)
    assert.equal(keyMatches('secret-kex', 'secret-key'), false)
    assert.equal(keyMatches('short', 'secret-key'), false)
    assert.equal(keyMatches(undefined, 'secret-key'), false)
    assert.equal(keyMatches('x', ''), false)
    assert.equal(isInternalPath('/internal/activity/x/reset'), true)
    assert.equal(isInternalPath('/health'), false)
    assert.equal(isInternalPath(undefined), false)
  })

  it('resets a room with a valid key and body', async () => {
    const seen: unknown[] = []
    const { base, results, close } = await serve({
      reset: async (uuid, payload) => {
        seen.push({ uuid, ...payload })
        return 'applied'
      },
    })
    const res = await fetch(`${base}/internal/activity/${UUID}/reset`, {
      method: 'POST',
      headers: { 'X-Internal-Key': 'secret-key' },
      body: JSON.stringify({ content: { type: 'doc' }, current_version: 4, by: { id: 2, name: 'Grace' } }),
    })
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { result: 'applied' })
    assert.deepEqual(seen, [{ uuid: UUID, content: { type: 'doc' }, current_version: 4, by: { id: 2, name: 'Grace' } }])
    assert.deepEqual(results, [true])
    await close()
  })

  it('rejects a wrong key, unknown paths, bad bodies and reports failures', async () => {
    let fail = false
    const { base, results, close } = await serve({
      reset: async () => {
        if (fail) throw new Error('boom')
        return 'not-loaded'
      },
    })
    const post = (path: string, body: string, key = 'secret-key', method = 'POST') =>
      fetch(`${base}${path}`, { method, headers: { 'X-Internal-Key': key }, body: method === 'GET' ? undefined : body })
    const resetPath = `/internal/activity/${UUID}/reset`
    assert.equal((await post(resetPath, '{}', 'wrong')).status, 403)
    assert.equal((await post('/internal/activity/activity_bad/reset', '{}')).status, 404)
    assert.equal((await post(resetPath, '', 'secret-key', 'GET')).status, 404)
    assert.equal((await post(resetPath, 'not json')).status, 400)
    assert.equal((await post(resetPath, JSON.stringify({ content: {} }))).status, 400)
    assert.equal((await post(resetPath, JSON.stringify({ current_version: 1, pad: 'x'.repeat(200_000) }))).status, 400)
    const noEditor = await post(resetPath, JSON.stringify({ current_version: 1, by: { id: 'x' } }))
    assert.equal(noEditor.status, 200)
    fail = true
    assert.equal((await post(resetPath, JSON.stringify({ current_version: 1 }))).status, 500)
    assert.equal(results[0], false)
    assert.ok(results.slice(1).every(Boolean))
    await close()
  })
})
