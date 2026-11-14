import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as Y from 'yjs'
import {
  type ActivityApi,
  type ActivityCache,
  type ActivityState,
  type PutStateBody,
  type PutStateResult,
  INTERNAL_ORIGIN,
  createActivityRooms,
  extractActivityUuid,
} from '../src/activityRoom.ts'
import {
  FRAGMENT_NAME,
  type PMNode,
  prosemirrorJSONToYDoc,
  replaceFragmentContent,
  sameDocument,
  yDocToProsemirrorJSON,
} from '../src/prosemirrorY.ts'

const UUID = 'activity_12345678-1234-1234-1234-123456789abc'

const para = (text: string): PMNode => ({ type: 'paragraph', content: [{ type: 'text', text }] })
const doc = (...texts: string[]): PMNode => ({ type: 'doc', content: texts.map(para) })

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64')

/** In-memory API with the same version rules as the real endpoints. */
function fakeApi(initial: { content: unknown; version: number; ydoc?: Uint8Array | null; ydocVersion?: number | null }) {
  const state = {
    content: initial.content,
    version: initial.version,
    ydoc: initial.ydoc ?? null,
    ydocVersion: initial.ydocVersion ?? null,
    lastModifiedBy: null as { id: number; name: string } | null,
  }
  const puts: PutStateBody[] = []
  let failNext = 0
  let failStatus = 500
  let unreachable = false
  const api: ActivityApi = {
    async getState(): Promise<ActivityState | null> {
      if (unreachable) throw new Error('ECONNREFUSED')
      return {
        content: state.content,
        current_version: state.version,
        ydoc_b64: state.ydoc ? b64(state.ydoc) : null,
        ydoc_version: state.ydocVersion,
        last_modified_by: state.lastModifiedBy,
      }
    },
    async putState(_uuid, body): Promise<PutStateResult> {
      puts.push(body)
      if (failNext > 0) {
        failNext--
        if (failStatus === 0) throw new Error('timeout')
        return { status: failStatus }
      }
      if (body.base_version !== state.version) return { status: 409 }
      if (body.content) {
        state.content = body.content
        state.version += 1
      }
      state.ydoc = new Uint8Array(Buffer.from(body.ydoc_b64, 'base64'))
      state.ydocVersion = state.version
      return { status: 200, current_version: state.version, version_number: body.checkpoint ? state.version : null }
    },
  }
  return {
    api,
    state,
    puts,
    /** A write outside the room (legacy save, AI tool): bumps the version. */
    externalWrite(content: unknown, by = { id: 9, name: 'Ada' }) {
      state.content = content
      state.version += 1
      state.lastModifiedBy = by
    },
    failNextPuts(count: number, status = 500) {
      failNext = count
      failStatus = status
    },
    setUnreachable(value: boolean) {
      unreachable = value
    },
  }
}

function fakeCache(): ActivityCache & { entries: Map<string, { state: Uint8Array; version: number }>; deleted: string[] } {
  const entries = new Map<string, { state: Uint8Array; version: number }>()
  const deleted: string[] = []
  return {
    entries,
    deleted,
    async get(uuid) {
      return entries.get(uuid) ?? null
    },
    async set(uuid, state, version) {
      entries.set(uuid, { state, version })
    },
    async delete(uuid) {
      entries.delete(uuid)
      deleted.push(uuid)
    },
  }
}

const quietLog = { log() {}, warn() {}, error() {} }

/** A live document as Hocuspocus would hold it, recording stateless broadcasts. */
function liveDoc(state: Uint8Array) {
  const d = new Y.Doc() as Y.Doc & { broadcastStateless(payload: string): void; messages: any[] }
  d.messages = []
  d.broadcastStateless = (payload: string) => d.messages.push(JSON.parse(payload))
  Y.applyUpdate(d, state)
  return d
}

async function setup(api: ReturnType<typeof fakeApi>, cache = fakeCache(), retryDelayMs = 20) {
  const rooms = createActivityRooms({ api: api.api, cache, maxYdocBytes: 5 * 1024 * 1024, retryDelayMs, log: quietLog })
  const state = await rooms.load(UUID)
  const live = liveDoc(state)
  rooms.afterLoad(UUID, live)
  return { rooms, live, cache }
}

/** Edits the live doc as a client connection would. */
function edit(live: Y.Doc, fn: (fragment: Y.XmlFragment) => void, userId = 1, rooms?: ReturnType<typeof createActivityRooms>) {
  const origin = { source: 'connection' }
  live.transact(() => fn(live.getXmlFragment(FRAGMENT_NAME)), origin)
  rooms?.recordChange(UUID, origin, userId)
}

function appendParagraph(fragment: Y.XmlFragment, text: string) {
  const p = new Y.XmlElement('paragraph')
  const t = new Y.XmlText()
  t.insert(0, text)
  p.insert(0, [t])
  fragment.push([p])
}

describe('activity room names', () => {
  it('accepts only the exact uuid shape the API mints', () => {
    assert.equal(extractActivityUuid(`activity:${UUID}`), UUID)
    for (const bad of [
      UUID,
      `activity:${UUID}x`,
      'activity:activity_../../etc',
      `activity:activity_${'g'.repeat(8)}-1234-1234-1234-123456789abc`,
      `board:${UUID}`,
      `activity:${UUID.toUpperCase()}`,
    ]) {
      assert.equal(extractActivityUuid(bad), null, bad)
    }
  })
})

describe('activity room loading', () => {
  it('seeds from the content when no ydoc is stored, then stores the ydoc right away', async () => {
    const api = fakeApi({ content: doc('hello'), version: 3 })
    const { rooms, live } = await setup(api)
    await rooms.store(UUID) // waits for the queued seed save
    assert.ok(sameDocument(yDocToProsemirrorJSON(live), doc('hello')))
    assert.equal(api.puts.length, 1)
    assert.equal(api.puts[0].content, undefined, 'a seed stores the ydoc only')
    assert.equal(api.puts[0].base_version, 3)
    assert.equal(api.state.version, 3, 'a ydoc-only save does not bump the version')
    assert.equal(api.state.ydocVersion, 3)
  })

  it('loads the stored ydoc when it matches the current version, without saving', async () => {
    const stored = Y.encodeStateAsUpdate(prosemirrorJSONToYDoc(doc('stored')))
    const api = fakeApi({ content: doc('stored'), version: 5, ydoc: stored, ydocVersion: 5 })
    const { rooms, live } = await setup(api)
    await rooms.store(UUID)
    assert.ok(sameDocument(yDocToProsemirrorJSON(live), doc('stored')))
    assert.equal(api.puts.length, 0)
    assert.deepEqual(rooms.inspect(UUID), { baseVersion: 5, dirty: false, contributors: [], needsYdocSave: false, loaded: true })
  })

  it('rewrites a stale ydoc from the content inside the same lineage', async () => {
    // A client that synced the old ydoc and went offline
    const original = prosemirrorJSONToYDoc(doc('first', 'second'))
    const offlineClient = new Y.Doc()
    Y.applyUpdate(offlineClient, Y.encodeStateAsUpdate(original))
    // The content then changed outside collab (version 7 > ydoc version 6)
    const api = fakeApi({ content: doc('rewritten'), version: 7, ydoc: Y.encodeStateAsUpdate(original), ydocVersion: 6 })
    const { rooms, live } = await setup(api)
    await rooms.store(UUID)
    assert.ok(sameDocument(yDocToProsemirrorJSON(live), doc('rewritten')))
    assert.equal(api.puts.length, 1)
    assert.equal(api.puts[0].content, undefined)
    assert.equal(api.state.ydocVersion, 7)
    // The offline client reconnects: same lineage, so it merges instead of
    // duplicating the old content next to the new one
    Y.applyUpdate(live, Y.encodeStateAsUpdate(offlineClient))
    Y.applyUpdate(offlineClient, Y.encodeStateAsUpdate(live))
    assert.ok(sameDocument(yDocToProsemirrorJSON(live), doc('rewritten')))
    assert.ok(sameDocument(yDocToProsemirrorJSON(offlineClient), doc('rewritten')))
  })

  it('a rebuilt lineage would duplicate (why stale ydocs are rewritten, not reseeded)', () => {
    const original = prosemirrorJSONToYDoc(doc('a'))
    const reseeded = prosemirrorJSONToYDoc(doc('a'))
    Y.applyUpdate(reseeded, Y.encodeStateAsUpdate(original))
    assert.equal(yDocToProsemirrorJSON(reseeded).content!.length, 2)
  })

  it('recovers unsaved edits from the cache and saves them', async () => {
    const withEdits = prosemirrorJSONToYDoc(doc('saved', 'unsaved edit'))
    const cache = fakeCache()
    cache.entries.set(UUID, { state: Y.encodeStateAsUpdate(withEdits), version: 4 })
    const stored = Y.encodeStateAsUpdate(prosemirrorJSONToYDoc(doc('saved')))
    const api = fakeApi({ content: doc('saved'), version: 4, ydoc: stored, ydocVersion: 4 })
    const { rooms, live } = await setup(api, cache)
    await rooms.store(UUID)
    assert.ok(sameDocument(yDocToProsemirrorJSON(live), doc('saved', 'unsaved edit')))
    assert.ok(sameDocument(api.state.content as PMNode, doc('saved', 'unsaved edit')))
    assert.equal(api.state.version, 5)
  })

  it('ignores a cache from an older version', async () => {
    const cache = fakeCache()
    cache.entries.set(UUID, { state: Y.encodeStateAsUpdate(prosemirrorJSONToYDoc(doc('old'))), version: 1 })
    const api = fakeApi({ content: doc('current'), version: 2 })
    const { live } = await setup(api, cache)
    assert.ok(sameDocument(yDocToProsemirrorJSON(live), doc('current')))
  })

  it('refuses to load when the API is unreachable or the activity is gone', async () => {
    const api = fakeApi({ content: doc('x'), version: 1 })
    api.setUnreachable(true)
    const rooms = createActivityRooms({ api: api.api, cache: fakeCache(), maxYdocBytes: 1e6, log: quietLog })
    await assert.rejects(rooms.load(UUID), /ECONNREFUSED/)
    const gone = createActivityRooms({
      api: { getState: async () => null, putState: async () => ({ status: 404 }) },
      cache: fakeCache(),
      maxYdocBytes: 1e6,
      log: quietLog,
    })
    await assert.rejects(gone.load(UUID), /not found/)
  })

  it('seeds an empty activity with one paragraph', async () => {
    const api = fakeApi({ content: {}, version: 1 })
    const { live } = await setup(api)
    assert.deepEqual(yDocToProsemirrorJSON(live), { type: 'doc', content: [{ type: 'paragraph' }] })
  })
})

describe('activity room saves', () => {
  it('saves content and contributors only after edits, and bumps the base version', async () => {
    const api = fakeApi({ content: doc('a'), version: 1 })
    const { rooms, live } = await setup(api)
    await rooms.store(UUID)
    const seedPuts = api.puts.length
    await rooms.store(UUID)
    assert.equal(api.puts.length, seedPuts, 'nothing to save without edits')

    edit(live, (f) => appendParagraph(f, 'b'), 11, rooms)
    edit(live, (f) => appendParagraph(f, 'c'), 12, rooms)
    edit(live, (f) => appendParagraph(f, 'd'), 11, rooms)
    await rooms.store(UUID)
    const put = api.puts.at(-1)!
    assert.ok(sameDocument(put.content!, doc('a', 'b', 'c', 'd')))
    assert.deepEqual(put.contributor_user_ids!.sort(), [11, 12])
    assert.equal(put.base_version, 1)
    assert.equal(rooms.inspect(UUID)!.baseVersion, 2)
    const saved = live.messages.at(-1)
    assert.equal(saved.type, 'saved')
    assert.equal(saved.version, 2)
    // The state vector of what was saved: every edit above is in it
    const sv = Y.decodeStateVector(new Uint8Array(Buffer.from(saved.sv, 'base64')))
    assert.equal(sv.get(live.clientID), Y.getState(live.store, live.clientID))
    // The cache holds the saved state tagged with the new version
    assert.equal(rooms.inspect(UUID)!.dirty, false)
  })

  it('stores only the ydoc when the edit changed no content (comments meta map)', async () => {
    const api = fakeApi({ content: doc('a'), version: 1 })
    const { rooms, live } = await setup(api)
    await rooms.store(UUID)
    const origin = { source: 'connection' }
    live.transact(() => live.getMap('meta').set('commentsRev', 1), origin)
    rooms.recordChange(UUID, origin, 1)
    await rooms.store(UUID)
    assert.equal(api.puts.at(-1)!.content, undefined)
    assert.equal(api.state.version, 1)
    assert.equal(rooms.inspect(UUID)!.dirty, false)
    // A failed meta-only save is retried as a ydoc save
    live.transact(() => live.getMap('meta').set('commentsRev', 2), origin)
    rooms.recordChange(UUID, origin, 1)
    api.failNextPuts(1, 500)
    await rooms.store(UUID)
    assert.equal(rooms.inspect(UUID)!.needsYdocSave, true)
  })

  it('ignores the server\'s own writes', async () => {
    const api = fakeApi({ content: doc('a'), version: 1 })
    const { rooms } = await setup(api)
    assert.equal(rooms.recordChange(UUID, INTERNAL_ORIGIN, 1), false)
    assert.equal(rooms.recordChange('activity_unknown', {}, 1), false)
    assert.equal(rooms.inspect(UUID)!.dirty, false)
  })

  it('keeps failed saves and retries them', async () => {
    const api = fakeApi({ content: doc('a'), version: 1 })
    const { rooms, live } = await setup(api, fakeCache(), 10)
    await rooms.store(UUID)
    edit(live, (f) => appendParagraph(f, 'b'), 3, rooms)
    api.failNextPuts(1, 0)
    await rooms.store(UUID)
    assert.equal(rooms.inspect(UUID)!.dirty, true)
    assert.deepEqual(rooms.inspect(UUID)!.contributors, [3])
    assert.equal(live.messages.at(-1).type, 'save-failed')
    // The retry timer saves it
    await new Promise((r) => setTimeout(r, 40))
    await rooms.store(UUID)
    assert.ok(sameDocument(api.state.content as PMNode, doc('a', 'b')))
    assert.equal(rooms.inspect(UUID)!.dirty, false)
  })

  it('keeps a failed ydoc-only save pending', async () => {
    const api = fakeApi({ content: doc('a'), version: 1 })
    api.failNextPuts(1, 503)
    const { rooms } = await setup(api, fakeCache(), 10)
    await rooms.drain()
    assert.equal(rooms.inspect(UUID)!.needsYdocSave, true)
    assert.equal(api.state.ydocVersion, null)
    // The retry timer stores it
    await new Promise((r) => setTimeout(r, 40))
    await rooms.drain()
    assert.equal(api.state.ydocVersion, 1)
    assert.equal(rooms.inspect(UUID)!.needsYdocSave, false)
  })

  it('drops edits for an activity that was deleted', async () => {
    const api = fakeApi({ content: doc('a'), version: 1 })
    const { rooms, live } = await setup(api)
    await rooms.store(UUID)
    edit(live, (f) => appendParagraph(f, 'b'), 1, rooms)
    api.failNextPuts(1, 404)
    await rooms.store(UUID)
    assert.equal(rooms.inspect(UUID)!.dirty, false)
  })

  it('refuses to persist a document over the size cap', async () => {
    const api = fakeApi({ content: doc('a'), version: 1 })
    const rooms = createActivityRooms({ api: api.api, cache: fakeCache(), maxYdocBytes: 10, log: quietLog })
    const live = liveDoc(await rooms.load(UUID))
    rooms.afterLoad(UUID, live)
    await rooms.store(UUID)
    assert.equal(api.puts.length, 0)
  })

  it('re-syncs from the API when a write outside the room raced a save (409)', async () => {
    const api = fakeApi({ content: doc('a'), version: 1 })
    const { rooms, live } = await setup(api)
    await rooms.store(UUID)
    edit(live, (f) => appendParagraph(f, 'mine'), 1, rooms)
    // Written outside the room and the notification never arrived
    api.externalWrite(doc('theirs'))
    await rooms.store(UUID)
    assert.ok(sameDocument(yDocToProsemirrorJSON(live), doc('theirs')), 'the outside write wins')
    assert.ok(sameDocument(api.state.content as PMNode, doc('theirs')))
    assert.equal(rooms.inspect(UUID)!.baseVersion, 2)
    assert.equal(api.state.ydocVersion, 2)
    assert.deepEqual(live.messages.find((m) => m.type === 'external-update'), {
      type: 'external-update',
      by: { id: 9, name: 'Ada' },
      version: 2,
    })
  })

  it('saves a named version on request', async () => {
    const api = fakeApi({ content: doc('a'), version: 1 })
    const { rooms } = await setup(api)
    await rooms.store(UUID)
    const result = await rooms.checkpoint(UUID, '  Before review  ', 4)
    assert.equal(result!.status, 200)
    assert.deepEqual(api.puts.at(-1)!.checkpoint, { label: 'Before review', user_id: 4 })
    assert.ok(api.puts.at(-1)!.content, 'a checkpoint carries the content')
    assert.equal(await rooms.checkpoint('activity_unknown', 'x', 1), null)
  })

  it('serializes saves, resets and checkpoints on one queue', async () => {
    const api = fakeApi({ content: doc('a'), version: 1 })
    let inFlight = 0
    let maxInFlight = 0
    const slowApi: ActivityApi = {
      getState: api.api.getState,
      async putState(uuid, body) {
        inFlight++
        maxInFlight = Math.max(maxInFlight, inFlight)
        await new Promise((r) => setTimeout(r, 5))
        inFlight--
        return api.api.putState(uuid, body)
      },
    }
    const rooms = createActivityRooms({ api: slowApi, cache: fakeCache(), maxYdocBytes: 1e6, log: quietLog })
    const live = liveDoc(await rooms.load(UUID))
    rooms.afterLoad(UUID, live)
    edit(live, (f) => appendParagraph(f, 'b'), 1, rooms)
    await Promise.all([rooms.store(UUID), rooms.checkpoint(UUID, 'v', 1), rooms.store(UUID)])
    assert.equal(maxInFlight, 1)
  })
})

describe('external writes (reset)', () => {
  it('replaces a loaded room\'s content in one update and tells clients who wrote it', async () => {
    const api = fakeApi({ content: doc('a'), version: 1 })
    const { rooms, live } = await setup(api)
    await rooms.store(UUID)
    const client = new Y.Doc()
    Y.applyUpdate(client, Y.encodeStateAsUpdate(live))
    let updates = 0
    live.on('update', (update: Uint8Array, origin: unknown) => {
      updates++
      assert.equal(origin, INTERNAL_ORIGIN)
      Y.applyUpdate(client, update)
    })
    api.externalWrite(doc('restored'), { id: 2, name: 'Grace' })
    const result = await rooms.reset(UUID, { content: doc('restored'), current_version: 2, by: { id: 2, name: 'Grace' } })
    assert.equal(result, 'applied')
    assert.equal(updates, 1)
    assert.ok(sameDocument(yDocToProsemirrorJSON(client), doc('restored')))
    assert.deepEqual(live.messages.find((m) => m.type === 'external-update'), {
      type: 'external-update',
      by: { id: 2, name: 'Grace' },
      version: 2,
    })
    // The ydoc is stored for the new version, the content is not re-saved
    assert.equal(api.puts.at(-1)!.content, undefined)
    assert.equal(api.state.ydocVersion, 2)
    assert.equal(rooms.inspect(UUID)!.dirty, false)
  })

  it('ignores a notification for a version the room already has', async () => {
    const api = fakeApi({ content: doc('a'), version: 4 })
    const { rooms, live } = await setup(api)
    await rooms.store(UUID)
    assert.equal(await rooms.reset(UUID, { content: doc('older'), current_version: 4 }), 'stale')
    assert.ok(sameDocument(yDocToProsemirrorJSON(live), doc('a')))
  })

  it('does not disturb clients when the new content is the same', async () => {
    const api = fakeApi({ content: doc('same'), version: 1 })
    const { rooms, live } = await setup(api)
    await rooms.store(UUID)
    api.externalWrite(doc('same'))
    let updates = 0
    live.on('update', () => updates++)
    assert.equal(await rooms.reset(UUID, { content: doc('same'), current_version: 2 }), 'applied')
    assert.equal(updates, 0)
    assert.equal(live.messages.filter((m) => m.type === 'external-update').length, 0)
    assert.equal(rooms.inspect(UUID)!.baseVersion, 2)
  })

  it('drops the cached state of a room that is not loaded', async () => {
    const cache = fakeCache()
    cache.entries.set(UUID, { state: new Uint8Array([0, 0]), version: 1 })
    const rooms = createActivityRooms({ api: fakeApi({ content: doc('a'), version: 1 }).api, cache, maxYdocBytes: 1e6, log: quietLog })
    assert.equal(await rooms.reset(UUID, { content: doc('b'), current_version: 2 }), 'not-loaded')
    assert.deepEqual(cache.deleted, [UUID])
  })

  it('edits made during a reset are kept on top of the new content', async () => {
    const api = fakeApi({ content: doc('a'), version: 1 })
    const { rooms, live } = await setup(api)
    await rooms.store(UUID)
    api.externalWrite(doc('reset'))
    await rooms.reset(UUID, { content: doc('reset'), current_version: 2 })
    edit(live, (f) => appendParagraph(f, 'after'), 5, rooms)
    await rooms.store(UUID)
    assert.ok(sameDocument(api.state.content as PMNode, doc('reset', 'after')))
  })
})

describe('room lifecycle', () => {
  it('forgets a room after unload and drains queued work', async () => {
    const api = fakeApi({ content: doc('a'), version: 1 })
    const { rooms } = await setup(api)
    await rooms.drain()
    await rooms.unload(UUID)
    assert.equal(rooms.inspect(UUID), null)
    await rooms.unload(UUID) // no-op
    await rooms.store(UUID) // no room: nothing to do
  })

  it('survives a failing cache', async () => {
    const api = fakeApi({ content: doc('a'), version: 1 })
    const broken: ActivityCache = {
      get: async () => {
        throw new Error('redis down')
      },
      set: async () => {
        throw new Error('redis down')
      },
      delete: async () => {
        throw new Error('redis down')
      },
    }
    const rooms = createActivityRooms({ api: api.api, cache: broken, maxYdocBytes: 1e6, log: quietLog })
    const live = liveDoc(await rooms.load(UUID))
    rooms.afterLoad(UUID, live)
    await rooms.store(UUID)
    assert.equal(api.state.ydocVersion, 1)
    assert.equal(await rooms.reset('activity_other', { content: doc('b'), current_version: 2 }), 'not-loaded')
  })

  it('a stale ydoc identical to the content is stored without rewriting', async () => {
    const ydoc = prosemirrorJSONToYDoc(doc('same'))
    const api = fakeApi({ content: doc('same'), version: 3, ydoc: Y.encodeStateAsUpdate(ydoc), ydocVersion: 2 })
    const { rooms, live } = await setup(api)
    await rooms.store(UUID)
    // Same items as the stored ydoc: nothing was replaced
    const fragment = live.getXmlFragment(FRAGMENT_NAME)
    assert.equal(fragment.length, 1)
    assert.equal(api.state.ydocVersion, 3)
    replaceFragmentContent(fragment, doc('x'))
  })
})
