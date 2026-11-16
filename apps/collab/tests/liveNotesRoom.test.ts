// Live session notes rooms: a real collab server with the notes kind, an
// in-memory API and real HocuspocusProvider clients. Covers naming, access
// (editor, viewer, refused), two editors converging, persistence through the
// API, read-only viewers and stamped presence.

import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as Y from 'yjs'
import jwt from 'jsonwebtoken'
import { HocuspocusProvider } from '@hocuspocus/provider'
import { createCollabServer } from '../src/server.ts'
import { createActivityRooms, type ActivityCache } from '../src/activityRoom.ts'
import { colorForUser, createLiveNotesRoom, extractLiveNotesUuid } from '../src/liveNotesRoom.ts'

const SECRET = 's'.repeat(40)
const INTERNAL = 'i'.repeat(40)
const SESSION = 'livesession_aaaaaaaa-1234-1234-1234-123456789abc'
const ROOM = `livenotes:${SESSION}`
const token = (sub: number) => jwt.sign({ sub }, SECRET, { algorithm: 'HS256', expiresIn: '1h' })
const quietLog = { log() {}, warn() {}, error() {} }
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function until(fn: () => boolean, timeout = 4000) {
  const t0 = Date.now()
  while (!fn()) {
    if (Date.now() - t0 > timeout) throw new Error('timed out')
    await wait(20)
  }
}

function memory() {
  const roles = new Map<number, 'editor' | 'viewer'>()
  const puts: Uint8Array[] = []
  const seen: string[] = []
  const fetchWithTimeout = async (url: string, init?: RequestInit) => {
    seen.push(url)
    const headers = (init?.headers ?? {}) as Record<string, string>
    if (url.endsWith('/notes/membership')) {
      const sub = Number((jwt.decode(String(headers.Authorization).replace('Bearer ', '')) as any)?.sub)
      const role = roles.get(sub)
      if (!role) return new Response('{}', { status: 403 })
      return new Response(JSON.stringify({ role, username: `Person ${sub}` }), { status: 200 })
    }
    if (url.endsWith('/notes/ydoc')) {
      if (headers['X-Internal-Key'] !== INTERNAL) return new Response('', { status: 403 })
      if (init?.method === 'PUT') {
        puts.push(new Uint8Array(init.body as ArrayBuffer))
        return new Response('{}', { status: 200 })
      }
      const last = puts[puts.length - 1]
      return new Response(last ? Buffer.from(last) : '', { status: 200 })
    }
    return new Response('', { status: 404 })
  }
  return { roles, puts, seen, fetchWithTimeout }
}

async function start() {
  const mem = memory()
  const notes = createLiveNotesRoom({ apiUrl: 'http://api.invalid', internalKey: INTERNAL, fetchWithTimeout: mem.fetchWithTimeout as any, maxYdocBytes: 5 * 1024 * 1024 })
  const noCache: ActivityCache = { get: async () => null, set: async () => {}, delete: async () => {} }
  const rooms = createActivityRooms({ api: { getState: async () => null, putState: async () => ({ status: 404 }) }, cache: noCache, maxYdocBytes: 5 * 1024 * 1024, log: quietLog })
  const collab = createCollabServer({
    port: 0, secretKey: SECRET, internalKey: INTERNAL, trustProxy: false, kinds: [notes], activityRooms: rooms,
    debounceMs: 30, maxDebounceMs: 100, accessRecheckMs: 0, quiet: true,
  })
  await collab.server.listen()
  const port = (collab.server.address as { port: number }).port
  return { mem, collab, url: `ws://127.0.0.1:${port}` }
}

type Started = Awaited<ReturnType<typeof start>>
interface Client { provider: HocuspocusProvider; ydoc: Y.Doc; scope?: string; failed?: string }

function connect(server: Started, userId: number): Promise<Client> {
  const ydoc = new Y.Doc()
  const client: Client = { ydoc, provider: null as any }
  return new Promise((resolve) => {
    client.provider = new HocuspocusProvider({
      url: server.url, name: ROOM, document: ydoc, token: token(userId),
      onAuthenticated: ({ scope }) => { client.scope = scope },
      onAuthenticationFailed: ({ reason }) => { client.failed = reason; resolve(client) },
      onSynced: () => resolve(client),
    })
  })
}

describe('live notes room names', () => {
  it('accepts only the session uuid shape the API mints', () => {
    assert.equal(extractLiveNotesUuid(ROOM), SESSION)
    assert.equal(extractLiveNotesUuid('livenotes:livesession_../../x'), null)
    assert.equal(extractLiveNotesUuid(`board:${SESSION}`), null)
    assert.equal(extractLiveNotesUuid(`livenotes:${SESSION}:extra`), null)
  })
  it('gives each person a stable caret color', () => {
    assert.equal(colorForUser(7), colorForUser(7))
    assert.match(colorForUser('abc'), /^#[0-9a-f]{6}$/)
  })
})

describe('live notes rooms', () => {
  let server: Started
  const clients: Client[] = []
  before(async () => { server = await start() })
  after(async () => {
    for (const c of clients) c.provider.destroy()
    await server.collab.destroy()
  })

  it('refuses people the API turns away', async () => {
    const c = await connect(server, 99)
    clients.push(c)
    assert.ok(c.failed)
  })

  it('lets two editors write together and stores the result through the API', async () => {
    server.mem.roles.set(1, 'editor')
    server.mem.roles.set(2, 'editor')
    const a = await connect(server, 1)
    const b = await connect(server, 2)
    clients.push(a, b)
    assert.equal(a.failed, undefined)
    a.ydoc.getXmlFragment('default').insert(0, [new Y.XmlText('Agenda: domains')])
    await until(() => b.ydoc.getXmlFragment('default').toString().includes('domains'))
    await until(() => server.mem.puts.length > 0)
    const stored = new Y.Doc()
    Y.applyUpdate(stored, server.mem.puts[server.mem.puts.length - 1])
    assert.match(stored.getXmlFragment('default').toString(), /domains/)
    assert.ok(server.mem.seen.some((u) => u.endsWith(`/live_sessions/${SESSION}/notes/ydoc`)))
  })

  it('gives viewers a read-only socket whose edits never reach others', async () => {
    server.mem.roles.set(3, 'viewer')
    const v = await connect(server, 3)
    clients.push(v)
    assert.equal(v.scope, 'readonly')
    assert.match(v.ydoc.getXmlFragment('default').toString(), /domains/)
    v.ydoc.getXmlFragment('default').insert(0, [new Y.XmlText('spoofed')])
    await wait(300)
    assert.doesNotMatch(clients[1].ydoc.getXmlFragment('default').toString(), /spoofed/)
  })

  it('stamps presence from the connection, not the client', async () => {
    const [a, b] = [clients[1], clients[2]]
    a.provider.setAwarenessField('user', { name: 'Someone else', color: '#000000', id: 42 })
    a.provider.setAwarenessField('junk', 'x'.repeat(100))
    await until(() => [...b.provider.awareness!.getStates().values()].some((s: any) => s?.user?.name === 'Person 1'))
    const seen = [...b.provider.awareness!.getStates().values()].find((s: any) => s?.user?.name === 'Person 1') as any
    assert.equal(seen.user.id, 1)
    assert.equal(seen.junk, undefined)
  })
})
