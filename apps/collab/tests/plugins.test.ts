// The optional plugin loader, and the server with and without a plugin: with
// none (a community build) only the built-in room kinds open; a plugin adds
// room kinds, internal routes and a shutdown hook.

import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as Y from 'yjs'
import jwt from 'jsonwebtoken'
import { HocuspocusProvider } from '@hocuspocus/provider'
import { createCollabServer } from '../src/server.ts'
import { createActivityKind } from '../src/activityKind.ts'
import { createActivityRooms, type ActivityCache } from '../src/activityRoom.ts'
import { type CollabPlugin, type CollabPluginDeps, findEePlugin, loadEePlugin } from '../src/plugins.ts'
import { calls } from './fixtures/plugins/scratch.ts'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FIXTURES = path.join(HERE, 'fixtures', 'plugins')
const NO_EE = path.join(HERE, 'fixtures', 'no-such-ee-dir')

const SECRET = 's'.repeat(40)
const INTERNAL = 'i'.repeat(40)
const ACTIVITY = 'activity_eeeeeeee-1234-1234-1234-123456789abc'
const BOARD = 'board_eeeeeeee-1234-1234-1234-123456789abc'
const token = (sub: number) => jwt.sign({ sub }, SECRET, { algorithm: 'HS256', expiresIn: '1h' })
const quietLog = { log() {}, warn() {}, error() {} }

const deps: CollabPluginDeps = {
  apiUrl: 'http://api.invalid',
  internalKey: INTERNAL,
  fetchWithTimeout: async () => new Response('', { status: 404 }),
  getRedis: () => {
    throw new Error('unused')
  },
  maxYdocBytes: 5 * 1024 * 1024,
  redisTtlSeconds: 60,
}

/** Silences console.error while a loader failure is logged. */
async function quietly<T>(fn: () => Promise<T>): Promise<T> {
  const original = console.error
  console.error = () => {}
  try {
    return await fn()
  } finally {
    console.error = original
  }
}

describe('plugin loader', () => {
  it('finds nothing without an ee/ folder', async () => {
    assert.equal(findEePlugin({}, NO_EE), null)
    assert.equal(await loadEePlugin(deps, { env: {}, dir: NO_EE }), null)
  })

  it('loads nothing when EE is disabled, even with a plugin present', async () => {
    const env = { LEARNHOUSE_DISABLE_EE: '1', COLLAB_EE_PLUGIN: path.join(FIXTURES, 'scratch.ts') }
    assert.equal(findEePlugin(env, FIXTURES), null)
    assert.equal(await loadEePlugin(deps, { env }), null)
  })

  it('takes an explicit plugin path, and ignores one that does not exist', () => {
    const file = path.join(FIXTURES, 'scratch.ts')
    assert.equal(findEePlugin({ COLLAB_EE_PLUGIN: file }, NO_EE), file)
    assert.equal(findEePlugin({ COLLAB_EE_PLUGIN: path.join(FIXTURES, 'missing.ts') }, FIXTURES), null)
  })

  it('registers a plugin with the server dependencies', async () => {
    const original = console.log
    console.log = () => {}
    let plugin: CollabPlugin | null
    try {
      plugin = await loadEePlugin(deps, { env: { COLLAB_EE_PLUGIN: path.join(FIXTURES, 'scratch.ts') } })
    } finally {
      console.log = original
    }
    assert.equal(plugin?.name, 'scratch-test')
    assert.deepEqual(plugin?.kinds?.map((k) => k.name), ['scratch'])
    assert.equal(calls.deps, deps)
  })

  it('skips a plugin that exports no factory or fails to start', async () => {
    for (const name of ['noFactory.ts', 'broken.ts']) {
      const env = { COLLAB_EE_PLUGIN: path.join(FIXTURES, name) }
      assert.equal(await quietly(() => loadEePlugin(deps, { env })), null, name)
    }
  })
})

async function startServer(plugin: CollabPlugin | null) {
  const noCache: ActivityCache = { get: async () => null, set: async () => {}, delete: async () => {} }
  const rooms = createActivityRooms({
    api: {
      getState: async () => ({ content: { type: 'doc', content: [] }, current_version: 1, ydoc_b64: null, ydoc_version: null, last_modified_by: null }),
      putState: async () => ({ status: 200, current_version: 1, version_number: null }),
    },
    cache: noCache,
    maxYdocBytes: 5 * 1024 * 1024,
    log: quietLog,
  })
  const { kind } = createActivityKind(
    {
      ...deps,
      fetchWithTimeout: async () =>
        new Response(JSON.stringify({ role: 'editor', user: { id: 1, username: 'u1', display_name: 'U 1', color: '#112233' } }), { status: 200 }),
    },
    rooms,
  )
  const collab = createCollabServer({
    port: 0,
    secretKey: SECRET,
    internalKey: INTERNAL,
    trustProxy: false,
    kinds: [kind, ...(plugin?.kinds ?? [])],
    internalRoutes: plugin?.internalRoutes,
    activityRooms: rooms,
    debounceMs: 30,
    maxDebounceMs: 100,
    accessRecheckMs: 0,
    quiet: true,
  })
  await collab.server.listen()
  const port = (collab.server.address as { port: number }).port
  return { collab, ws: `ws://127.0.0.1:${port}`, http: `http://127.0.0.1:${port}` }
}

type Started = Awaited<ReturnType<typeof startServer>>

function open(server: Started, name: string, providers: HocuspocusProvider[]) {
  const ydoc = new Y.Doc()
  return new Promise<{ ydoc: Y.Doc; failed?: string }>((resolve) => {
    providers.push(
      new HocuspocusProvider({
        url: server.ws,
        name,
        document: ydoc,
        token: token(1),
        onAuthenticationFailed: ({ reason }) => resolve({ ydoc, failed: reason }),
        onSynced: () => resolve({ ydoc }),
      }),
    )
  })
}

const internal = (server: Started, url: string, init: RequestInit = {}) =>
  fetch(`${server.http}${url}`, { ...init, headers: { 'X-Internal-Key': INTERNAL, 'Content-Type': 'application/json' } })

describe('server without a plugin (community build)', () => {
  let server: Started
  const providers: HocuspocusProvider[] = []
  before(async () => {
    server = await startServer(await loadEePlugin(deps, { env: {}, dir: NO_EE }))
  })
  after(async () => {
    for (const p of providers) p.destroy()
    await server.collab.destroy()
  })

  it('refuses board documents as an unknown room kind', async () => {
    const board = await open(server, `board:${BOARD}`, providers)
    assert.ok(board.failed, 'the board socket is refused')
  })

  it('still opens activity rooms', async () => {
    const activity = await open(server, `activity:${ACTIVITY}`, providers)
    assert.equal(activity.failed, undefined)
  })

  it('has no board internal routes', async () => {
    const update = Buffer.from(Y.encodeStateAsUpdate(new Y.Doc())).toString('base64')
    const res = await internal(server, `/internal/board/${BOARD}/update`, { method: 'POST', body: JSON.stringify({ update }) })
    assert.equal(res.status, 404)
    assert.equal((await internal(server, `/internal/board/${BOARD}/state`)).status, 404)
  })
})

describe('server with a plugin', () => {
  let server: Started
  let plugin: CollabPlugin
  const providers: HocuspocusProvider[] = []
  before(async () => {
    const original = console.log
    console.log = () => {}
    try {
      plugin = (await loadEePlugin(deps, { env: { COLLAB_EE_PLUGIN: path.join(FIXTURES, 'scratch.ts') } }))!
    } finally {
      console.log = original
    }
    server = await startServer(plugin)
  })
  after(async () => {
    for (const p of providers) p.destroy()
    await server.collab.destroy()
  })

  it("opens the plugin's room kind next to the built-in ones", async () => {
    assert.equal((await open(server, 'scratch:one', providers)).failed, undefined)
    assert.equal((await open(server, `activity:${ACTIVITY}`, providers)).failed, undefined)
    assert.ok((await open(server, 'scratch:NOPE', providers)).failed)
  })

  it("serves the plugin's internal routes over loaded documents", async () => {
    const doc = new Y.Doc()
    doc.getMap('m').set('from', 'api')
    const update = Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64')
    const applied = await internal(server, '/internal/scratch/one/update', { method: 'POST', body: JSON.stringify({ update }) })
    assert.deepEqual(await applied.json(), { applied: true })
    const missing = await internal(server, '/internal/scratch/two/update', { method: 'POST', body: JSON.stringify({ update }) })
    assert.deepEqual(await missing.json(), { applied: false })
    const state = await internal(server, '/internal/scratch/one/state')
    assert.equal(state.status, 200)
    assert.ok((await state.json()).bytes > 0)
    assert.equal((await internal(server, '/internal/scratch/two/state')).status, 404)
  })

  it('keeps the key check, method match and error handling', async () => {
    const denied = await fetch(`${server.http}/internal/scratch/one/state`, { headers: { 'X-Internal-Key': 'wrong' } })
    assert.equal(denied.status, 403)
    assert.equal((await internal(server, '/internal/scratch/one/state', { method: 'POST', body: '{}' })).status, 404)
    const boom = await quietly(() => internal(server, '/internal/scratch/boom'))
    assert.equal(boom.status, 500)
    assert.deepEqual(await boom.json(), { error: 'Internal error' })
  })

  it('runs the shutdown hook', async () => {
    const before = calls.shutdown
    await plugin.shutdown?.()
    assert.equal(calls.shutdown, before + 1)
  })
})
