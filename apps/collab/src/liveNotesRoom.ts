// Live session notes: `livenotes:{livesession_uuid}`. The class writes one
// shared document during a live session (Enterprise). Access comes from the
// API (editor while the session is live and you're in the room, viewer
// afterwards); the Yjs state is stored by the API on every Hocuspocus store.
// Presence follows the activity editor's rules: identity stamped from the
// connection, a caret and a couple of flags, nothing else.

import type { RoomKind } from './rooms.js'
import { sanitizeActivityAwareness } from './activityPresence.js'

// The uuid goes straight into an API path, so only the shape the API mints.
export function extractLiveNotesUuid(documentName: string): string | null {
  const match = documentName.match(/^livenotes:(livesession_[0-9a-f-]{36})$/)
  return match ? match[1] : null
}

export const LIVE_NOTES_SEATS = { editors: 300, viewers: 300, noun: 'Notes' }

const COLORS = ['#e11d48', '#7c3aed', '#0284c7', '#059669', '#d97706', '#db2777', '#4f46e5', '#0d9488']

export function colorForUser(id: number | string): string {
  const n = typeof id === 'number' ? id : [...String(id)].reduce((a, c) => a + c.charCodeAt(0), 0)
  return COLORS[Math.abs(n) % COLORS.length]
}

export interface LiveNotesDeps {
  apiUrl: string
  internalKey: string
  fetchWithTimeout(url: string, options?: RequestInit, timeoutMs?: number): Promise<Response>
  maxYdocBytes: number
}

export function createLiveNotesRoom(deps: LiveNotesDeps): RoomKind {
  const { apiUrl, internalKey, fetchWithTimeout } = deps
  const base = (uuid: string) => `${apiUrl}/api/v1/live_sessions/${uuid}/notes`

  function fetchMembership(uuid: string, token: string): Promise<Response> {
    return fetchWithTimeout(`${base(uuid)}/membership`, { headers: { Authorization: `Bearer ${token}` } })
  }

  return {
    name: 'livenotes',
    parse: extractLiveNotesUuid,
    seats: LIVE_NOTES_SEATS,
    presence: { sanitize: sanitizeActivityAwareness as any },
    tooLargeReason: 'Notes are too large',
    fetchAccess: fetchMembership,

    async authorize(uuid, token, tokenUserId) {
      let response: Response
      try {
        response = await fetchMembership(uuid, token)
      } catch (err) {
        console.error(`[collab] Notes access check failed for ${uuid}:`, err)
        throw new Error('Authentication service unavailable')
      }
      if (!response.ok) throw new Error('Not authorized for these notes')
      const access = await response.json()
      const id = Number(tokenUserId)
      return {
        readOnly: access.role !== 'editor',
        user: {
          id: Number.isFinite(id) ? id : String(tokenUserId),
          name: access.username || 'Unknown',
          color: colorForUser(tokenUserId),
          avatar: null,
          uuid: null,
          role: access.role,
        },
      }
    },

    async fetch(uuid) {
      try {
        const response = await fetchWithTimeout(`${base(uuid)}/ydoc`, { headers: { 'X-Internal-Key': internalKey } })
        if (!response.ok) {
          console.error(`[collab] Failed to fetch notes for ${uuid}: ${response.status}`)
          return null
        }
        const buffer = await response.arrayBuffer()
        return buffer.byteLength ? new Uint8Array(buffer) : null
      } catch (err) {
        console.error(`[collab] Error fetching notes for ${uuid}:`, err)
        return null
      }
    },

    async store(uuid, state) {
      if (state.byteLength > deps.maxYdocBytes) {
        console.warn(`[collab] Refusing to persist notes ${uuid}: ${state.byteLength} bytes exceeds the cap`)
        return
      }
      try {
        const response = await fetchWithTimeout(`${base(uuid)}/ydoc`, {
          method: 'PUT',
          headers: { 'X-Internal-Key': internalKey, 'Content-Type': 'application/octet-stream' },
          body: state.buffer.slice(state.byteOffset, state.byteOffset + state.byteLength) as ArrayBuffer,
        })
        if (!response.ok) console.error(`[collab] Notes store failed for ${uuid}: ${response.status}`)
      } catch (err) {
        console.error(`[collab] Notes store error for ${uuid}:`, err)
      }
    },
  }
}
