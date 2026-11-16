// The collaborative editing runtime: Yjs document, Hocuspocus provider, the
// Tiptap collaboration extensions and the room's status. Loaded lazily (see
// useActivityCollab) so the legacy editor never downloads it.

import * as Y from 'yjs'
import { HocuspocusProvider } from '@hocuspocus/provider'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCaret from '@tiptap/extension-collaboration-caret'
import { yXmlFragmentToProsemirrorJSON } from '@tiptap/y-tiptap'
import type { AnyExtension } from '@tiptap/core'
import { avatarUrl } from './collabAvatar'
import {
  type CollabSnapshot,
  type CollabUser,
  INITIAL_SNAPSHOT,
  editsSaved,
  initials,
  presenceList,
  samePeers,
  terminalCloseOf,
} from './collabStatus'
import { activityRoomName } from '../Translation/translationEditorModel'
import {
  BLOCK_INTERVAL_MS,
  CARET_INTERVAL_MS,
  POINTER_INTERVAL_MS,
  type BlockFocus,
  type PointerAnchor,
  createPresenceBatcher,
} from './pointerPresence'

const CHECKPOINT_TIMEOUT_MS = 10_000

export interface ExternalUpdate {
  by: { id: number; name: string } | null
  version: number
}

export interface CollabSession {
  ydoc: Y.Doc
  provider: HocuspocusProvider
  user: CollabUser
  /** Collaboration + carets, to add to the editor's extensions. */
  extensions: AnyExtension[]
  subscribe(_listener: () => void): () => void
  getSnapshot(): CollabSnapshot
  /** Saves now and records a named version. */
  saveVersion(_label: string): Promise<{ ok: boolean; version: number | null }>
  /**
   * Shares this user's mouse pointer (null hides it). Batched with the caret
   * into at most ~15 awareness updates a second.
   */
  setPointer(_pointer: PointerAnchor | null): void
  /** Shares the block this user has selected or is editing inside (null: none). */
  setBlock(_block: BlockFocus | null): void
  /** Scrolls the editor to a user's caret; false when they have none. */
  scrollToUser(_userId: number): boolean
  onExternalUpdate(_listener: (_update: ExternalUpdate) => void): () => void
  /**
   * Tells the room's other editors that data kept outside the document
   * (REST, e.g. comments) changed, so they refetch. Relayed by the collab
   * server, never stored; a no-op for read-only sessions.
   */
  signal(_topic: 'comments'): void
  onSignal(_topic: 'comments', _listener: (_by: number | null) => void): () => void
  /** The room's content as ProseMirror JSON. */
  contentJSON(): unknown
  destroy(): void
}

export { avatarUrl }

function caretElement(user: Record<string, any>): HTMLElement {
  const caret = document.createElement('span')
  caret.className = 'lh-collab-caret'
  caret.style.setProperty('--lh-caret', typeof user.color === 'string' ? user.color : '#64748b')
  caret.dataset.collabUser = String(user.id ?? '')
  const label = document.createElement('span')
  label.className = 'lh-collab-caret__label'
  const url = avatarUrl({ avatar: user.avatar ?? null, uuid: user.uuid ?? null })
  if (url) {
    const img = document.createElement('img')
    img.src = url
    img.alt = ''
    img.className = 'lh-collab-caret__avatar'
    label.appendChild(img)
  } else {
    const dot = document.createElement('span')
    dot.className = 'lh-collab-caret__initials'
    dot.textContent = initials(String(user.name ?? ''))
    label.appendChild(dot)
  }
  label.appendChild(document.createTextNode(String(user.name ?? '')))
  caret.appendChild(document.createTextNode('⁠'))
  caret.appendChild(label)
  return caret
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export interface StartOptions {
  url: string
  activityUuid: string
  /** A translation's room; null/undefined = the source room. */
  locale?: string | null
  user: CollabUser
  getToken: () => Promise<string | null>
}

/**
 * Connects to the activity's room. `ready` resolves once the document has
 * synced (retrying in the background while the server is unreachable), and
 * rejects, after cleaning up, when the room refuses this user.
 */
export function startCollabSession(opts: StartOptions): { session: CollabSession; ready: Promise<void> } {
  const ydoc = new Y.Doc()
  let snapshot: CollabSnapshot = { ...INITIAL_SNAPSHOT }
  const listeners = new Set<() => void>()
  const externalListeners = new Set<(_u: ExternalUpdate) => void>()
  const signalListeners = new Map<string, Set<(_by: number | null) => void>>()
  const pendingCheckpoints = new Map<string, (_r: { ok: boolean; version: number | null }) => void>()
  let destroyed = false
  let everSynced = false

  const set = (patch: Partial<CollabSnapshot>) => {
    let changed = false
    for (const key of Object.keys(patch) as (keyof CollabSnapshot)[]) {
      if (snapshot[key] !== patch[key]) changed = true
    }
    if (!changed) return
    snapshot = { ...snapshot, ...patch }
    listeners.forEach((l) => l())
  }

  let resolveReady!: () => void
  let rejectReady!: (_err: Error) => void
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve
    rejectReady = reject
  })
  const fail = (reason: string) => {
    if (everSynced || destroyed) return
    rejectReady(new Error(reason))
    session.destroy()
  }

  const provider: HocuspocusProvider = new HocuspocusProvider({
    url: opts.url,
    name: activityRoomName(opts.activityUuid, opts.locale),
    document: ydoc,
    token: async () => (await opts.getToken().catch(() => null)) ?? '',
    onStatus: ({ status }) => set({ connection: status as CollabSnapshot['connection'] }),
    onAuthenticated: ({ scope }) => set({ readOnly: scope === 'readonly' }),
    onAuthenticationFailed: () => {
      fail('authentication failed')
      if (everSynced) {
        set({ terminal: 'access_revoked' })
        provider.disconnect()
      }
    },
    onSynced: ({ state }) => {
      set({ synced: state })
      if (state && !everSynced) {
        everSynced = true
        resolveReady()
      }
    },
    onUnsyncedChanges: ({ number }) => set({ unsynced: number }),
    onClose: ({ event }) => {
      const terminal = terminalCloseOf(event as any)
      if (terminal) {
        // Runs before the socket schedules its reconnect, so this stops it
        set({ terminal })
        provider.disconnect()
      }
    },
    onStateless: ({ payload }) => {
      let message: any
      try {
        message = JSON.parse(payload)
      } catch {
        return
      }
      if (message?.type === 'saved') {
        let saved = false
        try {
          const vector = Y.decodeStateVector(b64ToBytes(String(message.sv ?? '')))
          saved = editsSaved(vector.get(ydoc.clientID), Y.getState(ydoc.store, ydoc.clientID))
        } catch {
          saved = false
        }
        set({
          version: typeof message.version === 'number' ? message.version : snapshot.version,
          lastSavedAt: Date.now(),
          saveFailed: false,
          ...(saved ? { unsaved: false } : {}),
        })
      } else if (message?.type === 'save-failed') {
        set({ saveFailed: true })
      } else if (message?.type === 'external-update') {
        const update: ExternalUpdate = { by: message.by ?? null, version: Number(message.version) || 0 }
        set({ version: update.version })
        externalListeners.forEach((l) => l(update))
      } else if (message?.type === 'signal' && typeof message.topic === 'string') {
        const by = typeof message.by === 'number' ? message.by : null
        signalListeners.get(message.topic)?.forEach((l) => l(by))
      } else if (message?.type === 'checkpoint' && typeof message.requestId === 'string') {
        const resolve = pendingCheckpoints.get(message.requestId)
        pendingCheckpoints.delete(message.requestId)
        resolve?.({ ok: message.ok === true, version: typeof message.version === 'number' ? message.version : null })
      }
    },
  })

  // Local edits are "unsaved" until a save's state vector covers them
  const onUpdate = (_update: Uint8Array, origin: unknown) => {
    if (origin !== provider) set({ unsaved: true })
  }
  ydoc.on('update', onUpdate)

  const awareness = provider.awareness!
  // The caret (from CollaborationCaret) and the mouse pointer go out together:
  // one awareness update carries both, at most every POINTER_INTERVAL_MS while
  // the pointer moves and every CARET_INTERVAL_MS for the caret alone. The
  // latest value wins; clearing either is sent at once.
  const setField = awareness.setLocalStateField.bind(awareness)
  const presence = createPresenceBatcher(
    (patch) => {
      if (destroyed) return
      awareness.setLocalState({ ...(awareness.getLocalState() ?? {}), ...patch })
    },
    { cursor: CARET_INTERVAL_MS, pointer: POINTER_INTERVAL_MS, block: BLOCK_INTERVAL_MS },
  )
  awareness.setLocalStateField = (field: string, value: any) => {
    if (field === 'cursor') presence.set('cursor', value, value === null)
    else setField(field, value)
  }

  const refreshPeers = () => {
    const peers = presenceList(awareness.getStates() as Map<number, Record<string, any>>, ydoc.clientID, opts.user.id)
    if (!samePeers(peers, snapshot.peers)) set({ peers })
  }
  awareness.on('change', refreshPeers)

  // A caret's name shows while its owner is active and fades when they stop
  // (CSS). ProseMirror reuses the caret element when it moves, so restart the
  // label's animation whenever that person's caret changes (not when only
  // their mouse pointer moves).
  const lastCarets = new Map<number, string>()
  const wakeLabels = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }) => {
    const ids = new Set<number>()
    const states = awareness.getStates() as Map<number, Record<string, any>>
    for (const clientId of removed) lastCarets.delete(clientId)
    for (const clientId of [...added, ...updated]) {
      const state = states.get(clientId)
      const userId = state?.user?.id
      if (clientId === ydoc.clientID || typeof userId !== 'number') continue
      const caret = JSON.stringify(state?.cursor ?? null)
      if (lastCarets.get(clientId) === caret) continue
      lastCarets.set(clientId, caret)
      ids.add(userId)
    }
    if (ids.size === 0) return
    requestAnimationFrame(() => {
      for (const userId of ids) {
        document
          .querySelectorAll<HTMLElement>(`.lh-collab-caret[data-collab-user="${userId}"] .lh-collab-caret__label`)
          .forEach((label) => {
            label.style.animation = 'none'
            void label.offsetWidth
            label.style.animation = ''
          })
      }
    })
  }
  awareness.on('change', wakeLabels)

  // Others see you dimmed while this tab is in the background
  const onVisibility = () => setField('idle', document.visibilityState === 'hidden')
  document.addEventListener('visibilitychange', onVisibility)

  const extensions: AnyExtension[] = [
    Collaboration.configure({ document: ydoc }),
    CollaborationCaret.configure({
      provider,
      user: opts.user,
      render: caretElement,
      selectionRender: (user: Record<string, any>) => ({
        nodeName: 'span',
        class: 'lh-collab-selection',
        style: `--lh-caret: ${typeof user.color === 'string' ? user.color : '#64748b'}`,
      }),
    }),
  ]

  const session: CollabSession = {
    ydoc,
    provider,
    user: opts.user,
    extensions,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSnapshot: () => snapshot,
    saveVersion(label) {
      const requestId = Math.random().toString(36).slice(2)
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          pendingCheckpoints.delete(requestId)
          resolve({ ok: false, version: null })
        }, CHECKPOINT_TIMEOUT_MS)
        pendingCheckpoints.set(requestId, (r) => {
          clearTimeout(timer)
          resolve(r)
        })
        provider.sendStateless(JSON.stringify({ type: 'checkpoint', label, requestId }))
      })
    },
    setPointer(pointer) {
      if (!destroyed) presence.set('pointer', pointer, pointer === null)
    },
    setBlock(block) {
      if (!destroyed) presence.set('block', block)
    },
    scrollToUser(userId) {
      const caret = document.querySelector<HTMLElement>(`.lh-collab-caret[data-collab-user="${userId}"]`)
      if (!caret) return false
      caret.scrollIntoView({ behavior: 'smooth', block: 'center' })
      caret.classList.remove('lh-collab-caret--ping')
      void caret.offsetWidth
      caret.classList.add('lh-collab-caret--ping')
      setTimeout(() => caret.classList.remove('lh-collab-caret--ping'), 2500)
      return true
    },
    onExternalUpdate(listener) {
      externalListeners.add(listener)
      return () => externalListeners.delete(listener)
    },
    signal(topic) {
      if (destroyed || snapshot.readOnly) return
      provider.sendStateless(JSON.stringify({ type: 'signal', topic }))
    },
    onSignal(topic, listener) {
      let set = signalListeners.get(topic)
      if (!set) signalListeners.set(topic, (set = new Set()))
      set.add(listener)
      return () => set!.delete(listener)
    },
    contentJSON: () => yXmlFragmentToProsemirrorJSON(ydoc.getXmlFragment('default')),
    destroy() {
      if (destroyed) return
      destroyed = true
      presence.cancel()
      document.removeEventListener('visibilitychange', onVisibility)
      awareness.off('change', refreshPeers)
      awareness.off('change', wakeLabels)
      ydoc.off('update', onUpdate)
      pendingCheckpoints.forEach((resolve) => resolve({ ok: false, version: null }))
      pendingCheckpoints.clear()
      provider.destroy()
      ydoc.destroy()
      listeners.clear()
      externalListeners.clear()
      signalListeners.clear()
    },
  }

  return { session, ready }
}
