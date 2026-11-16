// End-to-end tests of the collab server for activity rooms: a real Hocuspocus
// server (the same factory index.ts uses) with an in-memory API, and real
// HocuspocusProvider clients over WebSockets.

import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as Y from 'yjs'
import jwt from 'jsonwebtoken'
import { HocuspocusProvider } from '@hocuspocus/provider'
import { createCollabServer } from '../src/server.ts'
import { createActivityKind } from '../src/activityKind.ts'
import {
  type ActivityApi,
  type ActivityCache,
  type PutStateBody,
  createActivityRooms,
} from '../src/activityRoom.ts'
import { FRAGMENT_NAME, type PMNode, sameDocument, yDocToProsemirrorJSON } from '../src/prosemirrorY.ts'

const SECRET = 's'.repeat(40)
const INTERNAL = 'i'.repeat(40)
const UUID = 'activity_aaaaaaaa-1234-1234-1234-123456789abc'
const ROOM = `activity:${UUID}`

const para = (text: string): PMNode => ({ type: 'paragraph', content: [{ type: 'text', text }] })
const doc = (...texts: string[]): PMNode => ({ type: 'doc', content: texts.map(para) })

const quietLog = { log() {}, warn() {}, error() {} }

/** In-memory API: content, version and ydoc per activity, plus who may do what. */
function memoryApi() {
  const activities = new Map<string, { content: unknown; version: number; ydoc: string | null; ydocVersion: number | null }>()
  const roles = new Map<number, 'editor' | 'viewer' | null>()
  const puts: Array<{ uuid: string; body: PutStateBody; at: number }> = []
  const api: ActivityApi = {
    async getState(uuid) {
      const a = activities.get(uuid)
      if (!a) return null
      return { content: a.content, current_version: a.version, ydoc_b64: a.ydoc, ydoc_version: a.ydocVersion, last_modified_by: null }
    },
    async putState(uuid, body) {
      puts.push({ uuid, body, at: Date.now() })
      const a = activities.get(uuid)
      if (!a) return { status: 404 }
      if (body.base_version !== a.version) return { status: 409 }
      if (body.content) {
        a.content = body.content
        a.version += 1
      }
      a.ydoc = body.ydoc_b64
      a.ydocVersion = a.version
      return { status: 200, current_version: a.version, version_number: body.checkpoint ? a.version : null }
    },
  }
  return { api, activities, roles, puts }
}

const noCache: ActivityCache = { get: async () => null, set: async () => {}, delete: async () => {} }

const token = (sub: number) => jwt.sign({ sub }, SECRET, { algorithm: 'HS256', expiresIn: '1h' })

async function startServer(opts: { debounceMs: number; maxDebounceMs: number }) {
  const mem = memoryApi()
  const rooms = createActivityRooms({ api: mem.api, cache: noCache, maxYdocBytes: 5 * 1024 * 1024, log: quietLog })
  const { kind } = createActivityKind(
    {
      apiUrl: 'http://api.invalid',
      internalKey: INTERNAL,
      // The access endpoint, answered from the role table
      fetchWithTimeout: async (_url, init) => {
        const auth = String((init?.headers as Record<string, string>)?.Authorization ?? '')
        const sub = Number((jwt.decode(auth.replace('Bearer ', '')) as any)?.sub)
        const role = mem.roles.get(sub)
        if (!role) return new Response('{}', { status: 403 })
        return new Response(
          JSON.stringify({ role, user: { id: sub, username: `user${sub}`, display_name: `User ${sub}`, color: '#112233' } }),
          { status: 200 },
        )
      },
      getRedis: () => {
        throw new Error('unused')
      },
      maxYdocBytes: 5 * 1024 * 1024,
      redisTtlSeconds: 60,
    },
    rooms,
  )
  const collab = createCollabServer({
    port: 0,
    secretKey: SECRET,
    internalKey: INTERNAL,
    trustProxy: false,
    kinds: [kind],
    activityRooms: rooms,
    debounceMs: opts.debounceMs,
    maxDebounceMs: opts.maxDebounceMs,
    accessRecheckMs: 0,
    quiet: true,
  })
  await collab.server.listen()
  const port = (collab.server.address as { port: number }).port
  return { mem, rooms, collab, url: `ws://127.0.0.1:${port}`, http: `http://127.0.0.1:${port}` }
}

type Started = Awaited<ReturnType<typeof startServer>>

interface Client {
  provider: HocuspocusProvider
  ydoc: Y.Doc
  stateless: any[]
  closes: number[]
  scope?: string
  failed?: string
}

function connect(server: Started, userId: number, name = ROOM): Promise<Client> {
  const ydoc = new Y.Doc()
  const client: Client = { ydoc, stateless: [], closes: [], provider: null as any }
  return new Promise((resolve) => {
    client.provider = new HocuspocusProvider({
      url: server.url,
      name,
      document: ydoc,
      token: token(userId),
      onAuthenticated: ({ scope }) => {
        client.scope = scope
      },
      onAuthenticationFailed: ({ reason }) => {
        client.failed = reason
        resolve(client)
      },
      onSynced: () => resolve(client),
      onStateless: ({ payload }) => client.stateless.push(JSON.parse(payload)),
      onClose: ({ event }) => client.closes.push(event.code),
    })
  })
}

function appendParagraph(client: Client, text: string) {
  client.ydoc.transact(() => {
    const p = new Y.XmlElement('paragraph')
    const t = new Y.XmlText()
    t.insert(0, text)
    p.insert(0, [t])
    client.ydoc.getXmlFragment(FRAGMENT_NAME).push([p])
  })
}

async function waitFor(check: () => boolean, timeoutMs = 3000, label = 'condition') {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${label}`)
    await new Promise((r) => setTimeout(r, 15))
  }
}

const json = (client: Client) => yDocToProsemirrorJSON(client.ydoc)

describe('collab server: activity rooms', () => {
  let server: Started

  before(async () => {
    server = await startServer({ debounceMs: 150, maxDebounceMs: 600 })
  })
  after(async () => {
    await server.collab.destroy()
  })

  function seed(content: unknown, version = 1) {
    server.mem.activities.set(UUID, { content, version, ydoc: null, ydocVersion: null })
  }

  it('seeds the room, syncs editors and saves their edits with contributors', async () => {
    seed(doc('Hello'))
    server.mem.roles.set(1, 'editor')
    server.mem.roles.set(2, 'editor')
    const a = await connect(server, 1)
    const b = await connect(server, 2)
    assert.equal(a.scope, 'read-write')
    assert.ok(sameDocument(json(a), doc('Hello')))

    appendParagraph(a, 'from a')
    appendParagraph(b, 'from b')
    await waitFor(() => json(a).content!.length === 3 && json(b).content!.length === 3, 3000, 'convergence')
    assert.deepEqual(json(a), json(b))

    // Saved after the debounce, with both contributors and the agreed content
    await waitFor(() => server.mem.puts.some((p) => p.body.content && p.body.contributor_user_ids!.length === 2), 3000, 'save')
    const saved = server.mem.activities.get(UUID)!
    assert.ok(sameDocument(saved.content as PMNode, json(a)))
    await waitFor(() => a.stateless.some((m) => m.type === 'saved'), 3000, 'saved message')
    a.provider.destroy()
    b.provider.destroy()
    await waitFor(() => !server.collab.server.hocuspocus.documents.has(ROOM), 3000, 'unload')
  })

  it('reloads the persisted ydoc (no duplication across sessions)', async () => {
    const a = await connect(server, 1)
    const content = json(a)
    assert.equal(content.content!.length, 3)
    a.provider.destroy()
    await waitFor(() => !server.collab.server.hocuspocus.documents.has(ROOM), 3000, 'unload')
  })

  it('makes viewers read-only and refuses learners', async () => {
    server.mem.roles.set(3, 'viewer')
    server.mem.roles.set(4, null)
    const editor = await connect(server, 1)
    const viewer = await connect(server, 3)
    assert.equal(viewer.scope, 'readonly')
    const before = json(editor)
    appendParagraph(viewer, 'viewer edit')
    await new Promise((r) => setTimeout(r, 300))
    assert.deepEqual(json(editor), before, 'the viewer edit never reached the room')

    const learner = await connect(server, 4)
    assert.ok(learner.failed, 'learner authentication fails')
    learner.provider.destroy()

    const badRoom = await connect(server, 1, 'activity:activity_not-a-uuid')
    assert.ok(badRoom.failed)
    badRoom.provider.destroy()
    viewer.provider.destroy()
    editor.provider.destroy()
    await waitFor(() => !server.collab.server.hocuspocus.documents.has(ROOM), 3000, 'unload')
  })

  it('stamps presence from the server, so nobody can pose as someone else', async () => {
    const a = await connect(server, 1)
    const b = await connect(server, 2)
    a.provider.awareness!.setLocalStateField('user', { id: 2, name: 'Mallory', color: '#000000' })
    a.provider.awareness!.setLocalStateField('chatBubble', 'spam')
    await waitFor(() => {
      const state = b.provider.awareness!.getStates().get(a.ydoc.clientID)
      return state?.user?.name === 'User 1'
    }, 3000, 'sanitized presence')
    const state = b.provider.awareness!.getStates().get(a.ydoc.clientID)!
    assert.deepEqual(state.user, { id: 1, name: 'User 1', color: '#112233', avatar: null, uuid: null })
    assert.equal('chatBubble' in state, false)
    a.provider.destroy()
    b.provider.destroy()
    await waitFor(() => !server.collab.server.hocuspocus.documents.has(ROOM), 3000, 'unload')
  })

  it('applies an external write to connected clients and tells them who made it', async () => {
    const a = await connect(server, 1)
    const version = server.mem.activities.get(UUID)!.version
    // The API wrote the activity (e.g. a version restore) and notifies
    server.mem.activities.get(UUID)!.content = doc('Restored')
    server.mem.activities.get(UUID)!.version = version + 1
    const res = await fetch(`${server.http}/internal/activity/${UUID}/reset`, {
      method: 'POST',
      headers: { 'X-Internal-Key': INTERNAL },
      body: JSON.stringify({ content: doc('Restored'), current_version: version + 1, by: { id: 9, name: 'Grace' } }),
    })
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { result: 'applied' })
    await waitFor(() => sameDocument(json(a), doc('Restored')), 3000, 'reset content')
    await waitFor(() => a.stateless.some((m) => m.type === 'external-update'), 3000, 'external message')
    assert.deepEqual(a.stateless.find((m) => m.type === 'external-update').by, { id: 9, name: 'Grace' })

    const denied = await fetch(`${server.http}/internal/activity/${UUID}/reset`, {
      method: 'POST',
      headers: { 'X-Internal-Key': 'wrong' },
      body: '{}',
    })
    assert.equal(denied.status, 403)
    a.provider.destroy()
    await waitFor(() => !server.collab.server.hocuspocus.documents.has(ROOM), 3000, 'unload')
  })

  it('saves a named version for editors only', async () => {
    const a = await connect(server, 1)
    const viewer = await connect(server, 3)
    viewer.provider.sendStateless(JSON.stringify({ type: 'checkpoint', label: 'nope', requestId: 'v' }))
    a.provider.sendStateless(JSON.stringify({ type: 'checkpoint', label: 'Draft 1', requestId: 'r1' }))
    await waitFor(() => a.stateless.some((m) => m.type === 'checkpoint'), 3000, 'checkpoint reply')
    const reply = a.stateless.find((m) => m.type === 'checkpoint')
    assert.equal(reply.ok, true)
    assert.equal(reply.requestId, 'r1')
    assert.deepEqual(server.mem.puts.at(-1)!.body.checkpoint, { label: 'Draft 1', user_id: 1 })
    // Rate limited per connection
    a.provider.sendStateless(JSON.stringify({ type: 'checkpoint', label: 'again', requestId: 'r2' }))
    await waitFor(() => a.stateless.some((m) => m.requestId === 'r2'), 3000, 'second reply')
    assert.equal(a.stateless.find((m) => m.requestId === 'r2').ok, false)
    // Garbage is ignored
    a.provider.sendStateless('not json')
    a.provider.sendStateless(JSON.stringify({ type: 'other' }))
    await new Promise((r) => setTimeout(r, 100))
    assert.equal(viewer.stateless.filter((m) => m.type === 'checkpoint').length, 0)
    a.provider.destroy()
    viewer.provider.destroy()
    await waitFor(() => !server.collab.server.hocuspocus.documents.has(ROOM), 3000, 'unload')
  })

  it('drops a connection whose access was revoked at the next re-check', async () => {
    server.mem.roles.set(5, 'editor')
    const a = await connect(server, 5)
    const b = await connect(server, 1)
    server.mem.roles.set(5, null)
    await server.collab.recheckAccess()
    await waitFor(() => a.closes.includes(4403), 3000, 'revoked close')
    // A demoted editor becomes read-only without being dropped
    server.mem.roles.set(1, 'viewer')
    await server.collab.recheckAccess()
    const conn = server.collab.server.hocuspocus.documents.get(ROOM)!.getConnections()[0]
    assert.equal(conn.readOnly, true)
    server.mem.roles.set(1, 'editor')
    a.provider.destroy()
    b.provider.destroy()
    await waitFor(() => !server.collab.server.hocuspocus.documents.has(ROOM), 3000, 'unload')
  })

  it('saves and closes a room whose live editing was turned off', async () => {
    const a = await connect(server, 1)
    appendParagraph(a, 'typed just before the switch')
    await waitFor(() => server.collab.server.hocuspocus.documents.get(ROOM)!.getXmlFragment(FRAGMENT_NAME).length > 0, 3000, 'edit applied')
    await new Promise((r) => setTimeout(r, 50))
    const res = await fetch(`${server.http}/internal/activities/kick`, {
      method: 'POST',
      headers: { 'X-Internal-Key': INTERNAL },
      body: JSON.stringify({ activity_uuids: [UUID, 'activity_00000000-0000-0000-0000-000000000000'] }),
    })
    assert.deepEqual(await res.json(), { closed_rooms: 1 })
    await waitFor(() => a.closes.includes(4409), 3000, 'disabled close')
    const saved = JSON.stringify(server.mem.activities.get(UUID)!.content)
    assert.ok(saved.includes('typed just before the switch'), 'saved before closing')
    a.provider.destroy()
    await waitFor(() => !server.collab.server.hocuspocus.documents.has(ROOM), 3000, 'unload')
  })

  it('answers health checks', async () => {
    const res = await fetch(`${server.http}/health`)
    assert.deepEqual(await res.json(), { status: 'ok' })
  })
})

describe('collab server: persistence timing', () => {
  it('saves immediately on the last disconnect, long before the debounce', async () => {
    const server = await startServer({ debounceMs: 10_000, maxDebounceMs: 30_000 })
    server.mem.activities.set(UUID, { content: doc('x'), version: 1, ydoc: null, ydocVersion: null })
    server.mem.roles.set(1, 'editor')
    const a = await connect(server, 1)
    appendParagraph(a, 'quick edit')
    await new Promise((r) => setTimeout(r, 100))
    const disconnectedAt = Date.now()
    a.provider.destroy()
    await waitFor(() => server.mem.puts.some((p) => p.body.content), 3000, 'flush on unload')
    const put = server.mem.puts.find((p) => p.body.content)!
    assert.ok(put.at - disconnectedAt < 1500, `saved ${put.at - disconnectedAt} ms after disconnect`)
    assert.ok(sameDocument(put.body.content!, doc('x', 'quick edit')))
    await server.collab.destroy()
  })

  it('saves after the idle debounce, and at the max debounce while edits keep coming', async () => {
    const server = await startServer({ debounceMs: 200, maxDebounceMs: 700 })
    server.mem.activities.set(UUID, { content: doc('x'), version: 1, ydoc: null, ydocVersion: null })
    server.mem.roles.set(1, 'editor')
    const a = await connect(server, 1)
    const started = Date.now()
    // Edit every 100 ms for 1.2 s: the idle debounce never elapses
    for (let i = 0; i < 12; i++) {
      appendParagraph(a, `edit ${i}`)
      await new Promise((r) => setTimeout(r, 100))
    }
    const contentSaves = server.mem.puts.filter((p) => p.body.content)
    assert.ok(contentSaves.length >= 1, 'saved while editing (max debounce)')
    assert.ok(contentSaves[0].at - started < 1100)
    // Then idle: saved once more after ~200 ms
    await waitFor(
      () => sameDocument(server.mem.activities.get(UUID)!.content as PMNode, json(a)),
      2000,
      'idle save',
    )
    a.provider.destroy()
    await server.collab.destroy()
  })

  it('saves pending edits when the server shuts down', async () => {
    const server = await startServer({ debounceMs: 10_000, maxDebounceMs: 30_000 })
    server.mem.activities.set(UUID, { content: doc('x'), version: 1, ydoc: null, ydocVersion: null })
    server.mem.roles.set(1, 'editor')
    const a = await connect(server, 1)
    appendParagraph(a, 'before shutdown')
    await new Promise((r) => setTimeout(r, 100))
    await server.collab.destroy()
    assert.ok(sameDocument(server.mem.activities.get(UUID)!.content as PMNode, doc('x', 'before shutdown')))
    a.provider.destroy()
  })
})
