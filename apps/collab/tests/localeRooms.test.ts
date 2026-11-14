// Per-locale activity rooms: `activity:{uuid}:{locale}` next to the default
// `activity:{uuid}`. Name parsing, the API URLs and cache keys a locale room
// uses, and end-to-end: the rooms of one activity are independent documents
// (seed, persist, reset), kick closes all of them, checkpoints are refused.

import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as Y from 'yjs'
import jwt from 'jsonwebtoken'
import { HocuspocusProvider } from '@hocuspocus/provider'
import { createCollabServer } from '../src/server.ts'
import {
  activityCacheKey,
  activityEndpoint,
  createActivityKind,
  createHttpActivityApi,
  createRedisActivityCache,
} from '../src/activityKind.ts'
import {
  type ActivityApi,
  type ActivityCache,
  type PutStateBody,
  activityResourceId,
  createActivityRooms,
  extractActivityUuid,
  isValidLocale,
  parseActivityResource,
} from '../src/activityRoom.ts'
import { FRAGMENT_NAME, type PMNode, sameDocument, yDocToProsemirrorJSON } from '../src/prosemirrorY.ts'

const SECRET = 's'.repeat(40)
const INTERNAL = 'i'.repeat(40)
const UUID = 'activity_bbbbbbbb-1234-1234-1234-123456789abc'
const OTHER = 'activity_cccccccc-1234-1234-1234-123456789abc'
const API = 'http://api.invalid'

const para = (text: string): PMNode => ({ type: 'paragraph', content: [{ type: 'text', text }] })
const doc = (...texts: string[]): PMNode => ({ type: 'doc', content: texts.map(para) })
const quietLog = { log() {}, warn() {}, error() {} }

describe('locale room names', () => {
  it('parses the default room and translation rooms into resource ids', () => {
    assert.equal(extractActivityUuid(`activity:${UUID}`), UUID)
    for (const locale of ['fr', 'fil', 'pt-BR', 'zh-Hans', 'es-419', 'sr-Latn']) {
      assert.equal(extractActivityUuid(`activity:${UUID}:${locale}`), `${UUID}:${locale}`, locale)
      assert.deepEqual(parseActivityResource(`${UUID}:${locale}`), { uuid: UUID, locale })
      assert.equal(isValidLocale(locale), true)
    }
    assert.deepEqual(parseActivityResource(UUID), { uuid: UUID, locale: null })
    assert.equal(activityResourceId(UUID, null), UUID)
    assert.equal(activityResourceId(UUID), UUID)
    assert.equal(activityResourceId(UUID, 'pt-BR'), `${UUID}:pt-BR`)
  })

  it('rejects anything that is not a normalized locale', () => {
    const bad = [
      'FR', 'f', 'fren', 'fr-br', 'fr_FR', 'pt-bR', 'zh-hans', 'zh-HANS', 'es-41', 'es-4190',
      'en-US-x', 'fr-', '-fr', '', ' fr', 'fr ', '../x', 'fr?x=1', 'fr:de', 'fr%20', 'é',
    ]
    for (const locale of bad) {
      assert.equal(extractActivityUuid(`activity:${UUID}:${locale}`), null, JSON.stringify(locale))
      assert.equal(parseActivityResource(`${UUID}:${locale}`), null, JSON.stringify(locale))
      assert.equal(isValidLocale(locale), false, JSON.stringify(locale))
    }
    assert.equal(isValidLocale(null), false)
    assert.equal(extractActivityUuid(`activity:activity_nope:fr`), null)
    assert.equal(extractActivityUuid(`activity:${UUID}:`), null)
    assert.equal(extractActivityUuid(`board:${UUID}:fr`), null)
  })
})

describe('locale room API calls', () => {
  function recordingFetch(status = 200, body: unknown = {}) {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetchWithTimeout = async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      return new Response(JSON.stringify(body), { status })
    }
    return { calls, fetchWithTimeout }
  }
  const deps = (fetchWithTimeout: any) => ({
    apiUrl: API,
    internalKey: INTERNAL,
    fetchWithTimeout,
    getRedis: () => {
      throw new Error('unused')
    },
    maxYdocBytes: 1024,
    redisTtlSeconds: 60,
  })

  it('builds the state and access URLs with ?locale= for translation rooms only', () => {
    assert.equal(activityEndpoint(API, UUID, 'state'), `${API}/api/v1/activities/${UUID}/collab/state`)
    assert.equal(activityEndpoint(API, `${UUID}:pt-BR`, 'state'), `${API}/api/v1/activities/${UUID}/collab/state?locale=pt-BR`)
    assert.equal(activityEndpoint(API, `${UUID}:zh-Hans`, 'access'), `${API}/api/v1/activities/${UUID}/collab/access?locale=zh-Hans`)
    assert.throws(() => activityEndpoint(API, `${UUID}:../x`, 'state'))
  })

  it('gets and puts a translation state at its own URL (404 = missing translation)', async () => {
    const ok = recordingFetch(200, { content: doc('Bonjour'), current_version: 3, ydoc_b64: null, ydoc_version: null })
    const api = createHttpActivityApi(deps(ok.fetchWithTimeout))
    const state = await api.getState(`${UUID}:fr`)
    assert.equal(state?.current_version, 3)
    await api.putState(`${UUID}:fr`, { base_version: 3, ydoc_b64: '' })
    await api.getState(UUID)
    assert.deepEqual(
      ok.calls.map((c) => [c.init?.method ?? 'GET', c.url]),
      [
        ['GET', `${API}/api/v1/activities/${UUID}/collab/state?locale=fr`],
        ['PUT', `${API}/api/v1/activities/${UUID}/collab/state?locale=fr`],
        ['GET', `${API}/api/v1/activities/${UUID}/collab/state`],
      ],
    )
    assert.equal((ok.calls[0].init?.headers as Record<string, string>)['X-Internal-Key'], INTERNAL)

    const missing = recordingFetch(404)
    assert.equal(await createHttpActivityApi(deps(missing.fetchWithTimeout)).getState(`${UUID}:de`), null)
  })

  it('checks access for a translation room with ?locale=', async () => {
    const f = recordingFetch(200, { role: 'editor', user: { id: 7, username: 'ada' } })
    const { kind } = createActivityKind(deps(f.fetchWithTimeout))
    const auth = await kind.authorize(`${UUID}:es-419`, 'tok', 7)
    assert.equal(auth.readOnly, false)
    await kind.fetchAccess(UUID, 'tok')
    assert.deepEqual(f.calls.map((c) => c.url), [
      `${API}/api/v1/activities/${UUID}/collab/access?locale=es-419`,
      `${API}/api/v1/activities/${UUID}/collab/access`,
    ])
    assert.equal((f.calls[0].init?.headers as Record<string, string>).Authorization, 'Bearer tok')
  })

  it('keeps translation rooms under their own Redis keys', async () => {
    assert.equal(activityCacheKey(UUID), `collab:activity:${UUID}`)
    assert.equal(activityCacheKey(`${UUID}:fr`), `collab:activity:${UUID}:fr`)
    const store = new Map<string, Buffer | string>()
    const redis: any = {
      getBuffer: async (k: string) => (store.get(k) as Buffer) ?? null,
      get: async (k: string) => (store.get(k) as string) ?? null,
      del: async (...keys: string[]) => keys.forEach((k) => store.delete(k)),
      multi() {
        const ops: Array<() => void> = []
        const chain = {
          setex: (k: string, _ttl: number, v: Buffer | string) => (ops.push(() => store.set(k, v)), chain),
          exec: async () => ops.forEach((op) => op()),
        }
        return chain
      },
    }
    const cache = createRedisActivityCache({ ...deps(null), getRedis: () => redis })
    await cache.set(`${UUID}:fr`, new Uint8Array([1, 2]), 4)
    await cache.set(UUID, new Uint8Array([9]), 8)
    assert.deepEqual([...store.keys()].sort(), [
      `collab:activity:${UUID}`,
      `collab:activity:${UUID}:fr`,
      `collab:activity:${UUID}:fr:v`,
      `collab:activity:${UUID}:v`,
    ])
    assert.deepEqual(await cache.get(`${UUID}:fr`), { state: new Uint8Array([1, 2]), version: 4 })
    await cache.delete(`${UUID}:fr`)
    assert.equal(await cache.get(`${UUID}:fr`), null)
    assert.deepEqual(await cache.get(UUID), { state: new Uint8Array([9]), version: 8 })
  })
})

// ── End to end ────────────────────────────────────────────────────────────

/** In-memory API keyed by resource id (`{uuid}` or `{uuid}:{locale}`). */
function memoryApi() {
  const docs = new Map<string, { content: unknown; version: number; ydoc: string | null; ydocVersion: number | null }>()
  const puts: Array<{ id: string; body: PutStateBody }> = []
  const api: ActivityApi = {
    async getState(id) {
      const a = docs.get(id)
      if (!a) return null
      return { content: a.content, current_version: a.version, ydoc_b64: a.ydoc, ydoc_version: a.ydocVersion, last_modified_by: null }
    },
    async putState(id, body) {
      puts.push({ id, body })
      const a = docs.get(id)
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
  return { api, docs, puts }
}

const token = (sub: number) => jwt.sign({ sub }, SECRET, { algorithm: 'HS256', expiresIn: '1h' })

interface Client {
  provider: HocuspocusProvider
  ydoc: Y.Doc
  stateless: any[]
  closes: number[]
  failed?: string
}

describe('collab server: locale rooms', () => {
  let mem: ReturnType<typeof memoryApi>
  let collab: ReturnType<typeof createCollabServer>
  let url = ''
  let http = ''
  const accessUrls: string[] = []
  const cacheDrops: string[] = []

  before(async () => {
    mem = memoryApi()
    const cache: ActivityCache = {
      get: async () => null,
      set: async () => {},
      delete: async (id) => {
        cacheDrops.push(id)
      },
    }
    const rooms = createActivityRooms({ api: mem.api, cache, maxYdocBytes: 5 * 1024 * 1024, log: quietLog })
    const { kind } = createActivityKind(
      {
        apiUrl: API,
        internalKey: INTERNAL,
        fetchWithTimeout: async (u, init) => {
          accessUrls.push(u)
          const auth = String((init?.headers as Record<string, string>)?.Authorization ?? '')
          const sub = Number((jwt.decode(auth.replace('Bearer ', '')) as any)?.sub)
          return new Response(JSON.stringify({ role: 'editor', user: { id: sub, username: `user${sub}` } }), { status: 200 })
        },
        getRedis: () => {
          throw new Error('unused')
        },
        maxYdocBytes: 5 * 1024 * 1024,
        redisTtlSeconds: 60,
      },
      rooms,
    )
    collab = createCollabServer({
      port: 0,
      secretKey: SECRET,
      internalKey: INTERNAL,
      trustProxy: false,
      kinds: [kind],
      activityRooms: rooms,
      debounceMs: 100,
      maxDebounceMs: 400,
      accessRecheckMs: 0,
      quiet: true,
    })
    await collab.server.listen()
    const port = (collab.server.address as { port: number }).port
    url = `ws://127.0.0.1:${port}`
    http = `http://127.0.0.1:${port}`
  })
  after(async () => {
    await collab.destroy()
  })

  function connect(name: string, userId = 1): Promise<Client> {
    const ydoc = new Y.Doc()
    const client: Client = { ydoc, stateless: [], closes: [], provider: null as any }
    return new Promise((resolve) => {
      client.provider = new HocuspocusProvider({
        url,
        name,
        document: ydoc,
        token: token(userId),
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

  const json = (c: Client) => yDocToProsemirrorJSON(c.ydoc)
  const docs = () => collab.server.hocuspocus.documents

  function append(c: Client, text: string) {
    c.ydoc.transact(() => {
      const p = new Y.XmlElement('paragraph')
      const t = new Y.XmlText()
      t.insert(0, text)
      p.insert(0, [t])
      c.ydoc.getXmlFragment(FRAGMENT_NAME).push([p])
    })
  }

  async function waitFor(check: () => boolean, label: string, timeoutMs = 3000) {
    const start = Date.now()
    while (!check()) {
      if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${label}`)
      await new Promise((r) => setTimeout(r, 15))
    }
  }

  async function closeAll(...clients: Client[]) {
    for (const c of clients) c.provider.destroy()
    await waitFor(() => docs().size === 0, 'unload')
  }

  function seedAll() {
    mem.docs.set(UUID, { content: doc('Hello'), version: 5, ydoc: null, ydocVersion: null })
    mem.docs.set(`${UUID}:fr`, { content: doc('Bonjour'), version: 1, ydoc: null, ydocVersion: null })
    mem.docs.set(`${UUID}:pt-BR`, { content: doc('Olá'), version: 2, ydoc: null, ydocVersion: null })
  }

  it('seeds and persists each language room independently', async () => {
    seedAll()
    const en = await connect(`activity:${UUID}`)
    const fr = await connect(`activity:${UUID}:fr`)
    const pt = await connect(`activity:${UUID}:pt-BR`)
    assert.ok(sameDocument(json(en), doc('Hello')))
    assert.ok(sameDocument(json(fr), doc('Bonjour')))
    assert.ok(sameDocument(json(pt), doc('Olá')))
    assert.ok(accessUrls.includes(`${API}/api/v1/activities/${UUID}/collab/access?locale=fr`))
    assert.ok(accessUrls.includes(`${API}/api/v1/activities/${UUID}/collab/access?locale=pt-BR`))
    assert.ok(accessUrls.includes(`${API}/api/v1/activities/${UUID}/collab/access`))

    append(fr, 'le monde')
    await waitFor(() => sameDocument(mem.docs.get(`${UUID}:fr`)!.content as PMNode, doc('Bonjour', 'le monde')), 'fr save')
    assert.equal(mem.docs.get(`${UUID}:fr`)!.version, 2)
    // The other rooms of the activity never saw the edit
    assert.ok(sameDocument(json(en), doc('Hello')))
    assert.ok(sameDocument(json(pt), doc('Olá')))
    assert.ok(sameDocument(mem.docs.get(UUID)!.content as PMNode, doc('Hello')))
    assert.equal(mem.docs.get(UUID)!.version, 5)
    assert.ok(mem.puts.filter((p) => p.body.content).every((p) => p.id === `${UUID}:fr`))
    await closeAll(en, fr, pt)
  })

  it('refuses invalid locale room names and a missing translation', async () => {
    const bad = await connect(`activity:${UUID}:FR`)
    assert.ok(bad.failed, 'invalid locale refused')
    bad.provider.destroy()
    // No translation row (404) => the load fails like a missing activity
    const missing = await connect(`activity:${UUID}:de`)
    assert.ok(missing.failed, 'missing translation refused')
    assert.equal(missing.provider.isSynced, false)
    assert.equal(docs().has(`activity:${UUID}:de`), false)
    missing.provider.destroy()
    await waitFor(() => docs().size === 0, 'unload')
  })

  it('resets only the room of the given locale', async () => {
    seedAll()
    const en = await connect(`activity:${UUID}`)
    const fr = await connect(`activity:${UUID}:fr`)
    const frVersion = mem.docs.get(`${UUID}:fr`)!.version
    mem.docs.get(`${UUID}:fr`)!.content = doc('Rétabli')
    mem.docs.get(`${UUID}:fr`)!.version = frVersion + 1
    const res = await fetch(`${http}/internal/activity/${UUID}/reset?locale=fr`, {
      method: 'POST',
      headers: { 'X-Internal-Key': INTERNAL },
      body: JSON.stringify({ content: doc('Rétabli'), current_version: frVersion + 1, by: { id: 9, name: 'Grace' } }),
    })
    assert.deepEqual(await res.json(), { result: 'applied' })
    await waitFor(() => sameDocument(json(fr), doc('Rétabli')), 'fr reset')
    assert.ok(fr.stateless.some((m) => m.type === 'external-update'))
    await new Promise((r) => setTimeout(r, 150))
    assert.ok(sameDocument(json(en), doc('Hello')), 'default room untouched')
    assert.equal(en.stateless.filter((m) => m.type === 'external-update').length, 0)

    // Without ?locale the default room is reset, the translation is not
    mem.docs.get(UUID)!.content = doc('Restored')
    mem.docs.get(UUID)!.version += 1
    const res2 = await fetch(`${http}/internal/activity/${UUID}/reset`, {
      method: 'POST',
      headers: { 'X-Internal-Key': INTERNAL },
      body: JSON.stringify({ content: doc('Restored'), current_version: mem.docs.get(UUID)!.version }),
    })
    assert.deepEqual(await res2.json(), { result: 'applied' })
    await waitFor(() => sameDocument(json(en), doc('Restored')), 'default reset')
    assert.ok(sameDocument(json(fr), doc('Rétabli')), 'translation untouched')

    // A room that is not open: only its own cache entry is dropped
    const res3 = await fetch(`${http}/internal/activity/${UUID}/reset?locale=pt-BR`, {
      method: 'POST',
      headers: { 'X-Internal-Key': INTERNAL },
      body: JSON.stringify({ content: doc('x'), current_version: 9 }),
    })
    assert.deepEqual(await res3.json(), { result: 'not-loaded' })
    assert.deepEqual(cacheDrops, [`${UUID}:pt-BR`])

    for (const q of ['locale=FR', 'locale=', 'locale=fr-fr', 'locale=..%2Fx']) {
      const bad = await fetch(`${http}/internal/activity/${UUID}/reset?${q}`, {
        method: 'POST',
        headers: { 'X-Internal-Key': INTERNAL },
        body: JSON.stringify({ content: doc('x'), current_version: 99 }),
      })
      assert.equal(bad.status, 400, q)
    }
    await closeAll(en, fr)
  })

  it('refuses named versions in translation rooms', async () => {
    seedAll()
    const fr = await connect(`activity:${UUID}:fr`)
    const before = mem.puts.length
    fr.provider.sendStateless(JSON.stringify({ type: 'checkpoint', label: 'v1', requestId: 'r1' }))
    await waitFor(() => fr.stateless.some((m) => m.type === 'checkpoint'), 'checkpoint reply')
    assert.deepEqual(fr.stateless.find((m) => m.type === 'checkpoint'), {
      type: 'checkpoint',
      ok: false,
      version: null,
      requestId: 'r1',
    })
    assert.ok(mem.puts.slice(before).every((p) => !p.body.checkpoint))
    await closeAll(fr)
  })

  it('kick saves and closes the default room and every locale room of the activity', async () => {
    seedAll()
    mem.docs.set(OTHER, { content: doc('Other'), version: 1, ydoc: null, ydocVersion: null })
    mem.docs.set(`${OTHER}:fr`, { content: doc('Autre'), version: 1, ydoc: null, ydocVersion: null })
    const en = await connect(`activity:${UUID}`)
    const fr = await connect(`activity:${UUID}:fr`)
    const pt = await connect(`activity:${UUID}:pt-BR`)
    const otherFr = await connect(`activity:${OTHER}:fr`)
    append(fr, 'tapé avant')
    append(pt, 'digitado antes')
    await waitFor(
      () =>
        docs().get(`activity:${UUID}:fr`)!.getXmlFragment(FRAGMENT_NAME).length === 2 &&
        docs().get(`activity:${UUID}:pt-BR`)!.getXmlFragment(FRAGMENT_NAME).length === 2,
      'edits applied',
    )
    const res = await fetch(`${http}/internal/activities/kick`, {
      method: 'POST',
      headers: { 'X-Internal-Key': INTERNAL },
      body: JSON.stringify({ activity_uuids: [UUID] }),
    })
    assert.deepEqual(await res.json(), { closed_rooms: 3 })
    await waitFor(() => [en, fr, pt].every((c) => c.closes.includes(4409)), 'closed')
    assert.ok(JSON.stringify(mem.docs.get(`${UUID}:fr`)!.content).includes('tapé avant'))
    assert.ok(JSON.stringify(mem.docs.get(`${UUID}:pt-BR`)!.content).includes('digitado antes'))
    // Another activity's room is left alone, even with the same locale
    assert.equal(otherFr.closes.includes(4409), false)
    assert.ok(docs().has(`activity:${OTHER}:fr`))
    await closeAll(en, fr, pt, otherFr)
  })
})
