// Activity editor rooms: `activity:{activity_uuid}` for the activity's own
// content and `activity:{activity_uuid}:{locale}` for one of its translations.
// Each is an independent document; the functions below take the room's
// resource id (`{uuid}` or `{uuid}:{locale}`, see extractActivityUuid).
//
// The collab server is the only writer of an activity's content while it is
// edited collaboratively: clients never save content themselves, so their
// saves can't clash. This module owns everything the server does for a room:
//
//   load    – seed the Y doc from the API (stored ydoc when it is current,
//             otherwise the stored content written into the same Y lineage),
//   persist – debounced by Hocuspocus; sends the content, the ydoc and who
//             edited since the last save, guarded by the version it was
//             based on (a 409 means someone wrote the activity outside the
//             room, and the room re-syncs from the API: that write wins),
//   reset   – an external write (legacy save, AI tools, version restore)
//             replaces the room's content in one transaction,
//   checkpoint – a named version on request of an editor.
//
// Every operation on a room runs on one promise chain, so persists, resets
// and checkpoints never interleave.

import * as Y from 'yjs'
import {
  FRAGMENT_NAME,
  type PMNode,
  canonicalize,
  normalizeActivityContent,
  prosemirrorJSONToYDoc,
  replaceFragmentContent,
  sameDocument,
  yDocToProsemirrorJSON,
} from './prosemirrorY.js'

/** Strict shape of the uuids the API mints for activities. */
const UUID_PATTERN = 'activity_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
/**
 * Normalized locale codes: language (2-3 lowercase letters), optionally a
 * region (2 uppercase letters or 3 digits) or a script (Titlecase, 4 letters),
 * e.g. `fr`, `pt-BR`, `es-419`, `zh-Hans`.
 */
const LOCALE_PATTERN = '[a-z]{2,3}(?:-(?:[A-Z]{2}|[A-Z][a-z]{3}|[0-9]{3}))?'
const LOCALE = new RegExp(`^${LOCALE_PATTERN}$`)
/** `activity:{uuid}` (default language) or `activity:{uuid}:{locale}` (a translation). */
const ACTIVITY_ROOM = new RegExp(`^activity:(${UUID_PATTERN}(?::${LOCALE_PATTERN})?)$`)
const RESOURCE_ID = new RegExp(`^(${UUID_PATTERN})(?::(${LOCALE_PATTERN}))?$`)

export function isValidLocale(locale: unknown): locale is string {
  return typeof locale === 'string' && LOCALE.test(locale)
}

/**
 * The room's resource id for a document name: the activity uuid for the
 * default room, `{uuid}:{locale}` for a translation room. Every room of an
 * activity is an independent document keyed by this id.
 */
export function extractActivityUuid(documentName: string): string | null {
  const match = documentName.match(ACTIVITY_ROOM)
  return match ? match[1] : null
}

/** Splits a resource id into the activity uuid and the locale (null = default room). */
export function parseActivityResource(resourceId: string): { uuid: string; locale: string | null } | null {
  const match = resourceId.match(RESOURCE_ID)
  return match ? { uuid: match[1], locale: match[2] ?? null } : null
}

/** The resource id of an activity's room in `locale` (null/undefined = default room). */
export function activityResourceId(uuid: string, locale?: string | null): string {
  return locale ? `${uuid}:${locale}` : uuid
}

export interface ActivityState {
  content: unknown
  current_version: number
  ydoc_b64: string | null
  ydoc_version: number | null
  last_modified_by?: { id: number; name: string } | null
}

export interface PutStateBody {
  base_version: number
  ydoc_b64: string
  content?: PMNode
  contributor_user_ids?: number[]
  checkpoint?: { label: string; user_id: number } | null
}

export interface PutStateResult {
  status: number
  current_version?: number
  version_number?: number | null
}

/**
 * The API calls a room needs (internal key endpoints). `uuid` is the room's
 * resource id: `{uuid}` or `{uuid}:{locale}` for a translation.
 */
export interface ActivityApi {
  /** Current state, or null when the activity no longer exists. Throws when the API can't answer. */
  getState(uuid: string): Promise<ActivityState | null>
  putState(uuid: string, body: PutStateBody): Promise<PutStateResult>
}

/** Short-lived recovery cache (Redis in production), keyed by resource id. */
export interface ActivityCache {
  get(uuid: string): Promise<{ state: Uint8Array; version: number } | null>
  set(uuid: string, state: Uint8Array, version: number): Promise<void>
  delete(uuid: string): Promise<void>
}

/** The parts of a Hocuspocus Document a room uses. */
export interface RoomDocument extends Y.Doc {
  broadcastStateless?(payload: string): void
}

export interface Editor {
  id: number
  name: string
}

/** Stateless messages sent to clients, JSON encoded. */
export type RoomMessage =
  /** `sv`: base64 state vector of what was saved, so a client knows its own edits are in */
  | { type: 'saved'; version: number; at: number; sv: string }
  | { type: 'save-failed'; at: number }
  | { type: 'external-update'; by: Editor | null; version: number }
  | { type: 'checkpoint'; ok: boolean; version: number | null; requestId?: string }

/**
 * Transaction origin for the server's own writes (seeding fixes, resets).
 * Hocuspocus skips its store hooks for it, and onChange ignores it, so these
 * writes are never mistaken for an edit that needs saving.
 */
export const INTERNAL_ORIGIN = Object.freeze({
  source: 'local' as const,
  skipStoreHooks: true,
  context: { internal: true },
})

export function isInternalOrigin(origin: unknown): boolean {
  return origin === INTERNAL_ORIGIN
}

interface Room {
  uuid: string
  doc: RoomDocument | null
  /** The activity version the room's content corresponds to. */
  baseVersion: number
  /** Edits since the last successful content save. */
  dirty: boolean
  contributors: Set<number>
  /** The ydoc must be stored (fresh seed or rewrite) even without edits. */
  needsYdocSave: boolean
  /** Canonical JSON of the content the API holds, to skip no-op content saves. */
  savedContent: string
  chain: Promise<unknown>
  retryTimer: ReturnType<typeof setTimeout> | null
}

export interface ActivityRoomsOptions {
  api: ActivityApi
  cache: ActivityCache
  maxYdocBytes: number
  /** Delay before retrying a failed save (ms). */
  retryDelayMs?: number
  log?: Pick<Console, 'log' | 'warn' | 'error'>
}

function canonicalJSON(doc: PMNode): string {
  return JSON.stringify(canonicalize(doc))
}

function toB64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

function fromB64(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, 'base64'))
}

export function createActivityRooms(opts: ActivityRoomsOptions) {
  const { api, cache, maxYdocBytes } = opts
  const retryDelayMs = opts.retryDelayMs ?? 5000
  const log = opts.log ?? console
  const rooms = new Map<string, Room>()

  function roomFor(uuid: string): Room {
    let room = rooms.get(uuid)
    if (!room) {
      room = {
        uuid,
        doc: null,
        baseVersion: 0,
        dirty: false,
        contributors: new Set(),
        needsYdocSave: false,
        savedContent: '',
        chain: Promise.resolve(),
        retryTimer: null,
      }
      rooms.set(uuid, room)
    }
    return room
  }

  /** Runs `fn` after everything already queued on the room. */
  function enqueue<T>(room: Room, fn: () => Promise<T>): Promise<T> {
    const next = room.chain.then(fn, fn)
    room.chain = next.catch(() => undefined)
    return next
  }

  function broadcast(room: Room, message: RoomMessage) {
    try {
      room.doc?.broadcastStateless?.(JSON.stringify(message))
    } catch (err) {
      log.error(`[collab] broadcast failed for ${room.uuid}:`, err)
    }
  }

  /** Writes `content` into the doc's fragment as one internal transaction. */
  function replaceContent(doc: Y.Doc, content: unknown) {
    const normalized = normalizeActivityContent(content)
    doc.transact(() => {
      replaceFragmentContent(doc.getXmlFragment(FRAGMENT_NAME), normalized)
    }, INTERNAL_ORIGIN)
  }

  // ── Load ────────────────────────────────────────────────────────────────

  /**
   * The Y state a room starts from. Throws when the API can't answer, so the
   * load fails and no client edits an empty stand-in that would then be saved
   * over the real content.
   */
  async function load(uuid: string): Promise<Uint8Array> {
    const state = await api.getState(uuid)
    if (!state) throw new Error(`Activity ${uuid} not found`)
    const room = roomFor(uuid)
    room.baseVersion = state.current_version
    room.dirty = false
    room.contributors.clear()
    room.needsYdocSave = false
    const content = normalizeActivityContent(state.content)
    room.savedContent = canonicalJSON(content)

    // Edits the server held when it last stopped (cached before every save)
    let cached: { state: Uint8Array; version: number } | null = null
    try {
      cached = await cache.get(uuid)
    } catch (err) {
      log.error(`[collab] cache read failed for ${uuid}:`, err)
    }

    const temp = new Y.Doc()
    if (cached && cached.version === state.current_version) {
      Y.applyUpdate(temp, cached.state)
      // Unsaved edits survive a restart: they differ from the stored content
      room.dirty = !sameDocument(yDocToProsemirrorJSON(temp), content)
      room.needsYdocSave = state.ydoc_version !== state.current_version
    } else if (state.ydoc_b64 && state.ydoc_version === state.current_version) {
      Y.applyUpdate(temp, fromB64(state.ydoc_b64))
      room.dirty = !sameDocument(yDocToProsemirrorJSON(temp), content)
    } else if (state.ydoc_b64) {
      // The content changed outside the room since the ydoc was stored.
      // Rewrite it inside the stored lineage rather than seeding a new one:
      // a client still holding the old doc then merges instead of
      // duplicating everything.
      Y.applyUpdate(temp, fromB64(state.ydoc_b64))
      if (!sameDocument(yDocToProsemirrorJSON(temp), content)) replaceContent(temp, content)
      room.needsYdocSave = true
    } else {
      prosemirrorJSONToYDoc(content, temp)
      // Stored right away so every later load continues this lineage
      room.needsYdocSave = true
    }
    const update = Y.encodeStateAsUpdate(temp)
    temp.destroy()
    return update
  }

  /** Called once Hocuspocus applied the loaded state to the live document. */
  function afterLoad(uuid: string, doc: RoomDocument) {
    const room = roomFor(uuid)
    room.doc = doc
    if (room.needsYdocSave || room.dirty) {
      void enqueue(room, () => save(room))
    }
  }

  // ── Edits & saves ───────────────────────────────────────────────────────

  /** Records an applied update; returns false for the server's own writes. */
  function recordChange(uuid: string, origin: unknown, userId: number | null): boolean {
    if (isInternalOrigin(origin)) return false
    const room = rooms.get(uuid)
    if (!room) return false
    room.dirty = true
    if (typeof userId === 'number' && userId > 0) room.contributors.add(userId)
    return true
  }

  function scheduleRetry(room: Room) {
    if (room.retryTimer) return
    room.retryTimer = setTimeout(() => {
      room.retryTimer = null
      if (rooms.get(room.uuid) === room && (room.dirty || room.needsYdocSave)) {
        void enqueue(room, () => save(room))
      }
    }, retryDelayMs)
    room.retryTimer.unref?.()
  }

  async function writeCache(room: Room, state: Uint8Array) {
    try {
      await cache.set(room.uuid, state, room.baseVersion)
    } catch (err) {
      log.error(`[collab] cache write failed for ${room.uuid}:`, err)
    }
  }

  /**
   * Saves the room: content when edited (or for a checkpoint), otherwise the
   * ydoc alone when it must be stored. Never run concurrently (enqueue).
   */
  async function save(
    room: Room,
    checkpoint: { label: string; user_id: number } | null = null,
  ): Promise<PutStateResult | null> {
    const doc = room.doc
    if (!doc) return null
    const state = Y.encodeStateAsUpdate(doc)
    const savedVector = Y.encodeStateVector(doc)
    await writeCache(room, state)
    if (!room.dirty && !room.needsYdocSave && !checkpoint) return null
    if (state.byteLength > maxYdocBytes) {
      log.warn(`[collab] Refusing to persist ${room.uuid}: ${state.byteLength} bytes exceeds the cap`)
      return null
    }

    const content = yDocToProsemirrorJSON(doc)
    const contentJSON = canonicalJSON(content)
    // Changes outside the content (the comments' "meta" map) only store the
    // ydoc: no new version for them
    const withContent = checkpoint !== null || (room.dirty && contentJSON !== room.savedContent)
    const contributors = [...room.contributors]
    const body: PutStateBody = { base_version: room.baseVersion, ydoc_b64: toB64(state) }
    if (withContent) {
      body.content = content
      body.contributor_user_ids = contributors
      if (checkpoint) body.checkpoint = checkpoint
    }
    // Edits landing while the request is in flight mark the room dirty again
    room.dirty = false
    room.contributors.clear()
    const hadYdocSave = room.needsYdocSave
    room.needsYdocSave = false

    let result: PutStateResult
    try {
      result = await api.putState(room.uuid, body)
    } catch (err) {
      result = { status: 0 }
      log.error(`[collab] save failed for ${room.uuid}:`, err)
    }

    if (result.status === 200 && typeof result.current_version === 'number') {
      room.baseVersion = result.current_version
      if (withContent) room.savedContent = contentJSON
      await writeCache(room, state)
      broadcast(room, { type: 'saved', version: result.current_version, at: Date.now(), sv: toB64(savedVector) })
      return result
    }

    if (result.status === 409) {
      // Written outside the room since our base version: that write wins.
      await resyncFromApi(room)
      return result
    }

    if (result.status === 404) {
      log.warn(`[collab] ${room.uuid} no longer exists; dropping its edits`)
      return result
    }

    // Keep what we failed to send and try again later
    if (withContent) {
      room.dirty = true
      for (const id of contributors) room.contributors.add(id)
      broadcast(room, { type: 'save-failed', at: Date.now() })
    }
    room.needsYdocSave = room.needsYdocSave || hadYdocSave || !withContent
    scheduleRetry(room)
    return result
  }

  /** Store hook: Hocuspocus calls it debounced and on the last disconnect. */
  function store(uuid: string): Promise<unknown> {
    const room = rooms.get(uuid)
    if (!room || !room.doc) return Promise.resolve()
    return enqueue(room, () => save(room))
  }

  // ── External writes ─────────────────────────────────────────────────────

  async function applyExternal(room: Room, content: unknown, version: number, by: Editor | null) {
    const doc = room.doc
    if (!doc) return
    const normalized = normalizeActivityContent(content)
    const changed = !sameDocument(yDocToProsemirrorJSON(doc), normalized)
    if (changed) replaceContent(doc, normalized)
    room.savedContent = canonicalJSON(normalized)
    room.baseVersion = version
    room.dirty = false
    room.contributors.clear()
    // The stored ydoc is now behind this version; store it in our lineage
    room.needsYdocSave = true
    if (changed) broadcast(room, { type: 'external-update', by, version })
    await save(room)
  }

  async function resyncFromApi(room: Room) {
    let state: ActivityState | null
    try {
      state = await api.getState(room.uuid)
    } catch (err) {
      log.error(`[collab] re-sync failed for ${room.uuid}:`, err)
      room.dirty = true
      scheduleRetry(room)
      return
    }
    if (!state) return
    await applyExternal(room, state.content, state.current_version, state.last_modified_by ?? null)
  }

  /**
   * The API wrote the activity's content outside the room. A loaded room
   * takes the new content; otherwise the cached state is dropped so the next
   * load starts from the API.
   */
  async function reset(
    uuid: string,
    payload: { content: unknown; current_version: number; by?: Editor | null },
  ): Promise<'applied' | 'stale' | 'not-loaded'> {
    const room = rooms.get(uuid)
    if (!room || !room.doc) {
      try {
        await cache.delete(uuid)
      } catch (err) {
        log.error(`[collab] cache drop failed for ${uuid}:`, err)
      }
      return 'not-loaded'
    }
    return enqueue(room, async () => {
      // A late notification for a version the room already moved past
      if (payload.current_version <= room.baseVersion) return 'stale' as const
      await applyExternal(room, payload.content, payload.current_version, payload.by ?? null)
      return 'applied' as const
    })
  }

  // ── Checkpoints ─────────────────────────────────────────────────────────

  /** Saves now and records a named version. */
  function checkpoint(uuid: string, label: string, userId: number): Promise<PutStateResult | null> {
    const room = rooms.get(uuid)
    if (!room || !room.doc) return Promise.resolve(null)
    const clean = label.trim().slice(0, 120)
    return enqueue(room, () => save(room, { label: clean, user_id: userId }))
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────

  /** Saves the room now, whatever the debounce (before closing it). */
  function flush(uuid: string): Promise<unknown> {
    const room = rooms.get(uuid)
    if (!room || !room.doc) return Promise.resolve(null)
    return enqueue(room, () => save(room))
  }

  /** Forgets a room once Hocuspocus unloaded it (after its last store). */
  async function unload(uuid: string) {
    const room = rooms.get(uuid)
    if (!room) return
    await room.chain
    if (room.retryTimer) clearTimeout(room.retryTimer)
    rooms.delete(uuid)
  }

  /** Waits for every queued operation (shutdown). */
  async function drain() {
    await Promise.allSettled([...rooms.values()].map((room) => room.chain))
  }

  function inspect(uuid: string) {
    const room = rooms.get(uuid)
    return room
      ? {
          baseVersion: room.baseVersion,
          dirty: room.dirty,
          contributors: [...room.contributors],
          needsYdocSave: room.needsYdocSave,
          loaded: room.doc !== null,
        }
      : null
  }

  return { load, afterLoad, recordChange, store, flush, reset, checkpoint, unload, drain, inspect }
}

export type ActivityRooms = ReturnType<typeof createActivityRooms>
