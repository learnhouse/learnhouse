'use client'
import { useSyncExternalStore } from 'react'
import type { NoteAnchor } from '@services/notes/notes'

/**
 * The lesson page's notes state, shared by the parts that live in different
 * subtrees: the Notes button in the header, the panel, the "Add to notes"
 * bubble over a selection and the video's "Add note at 03:12".
 */

export type NoteCapture = {
  id: number
  /** Quoted lesson text, inserted as a blockquote with a link back. */
  quote?: string
  anchor?: NoteAnchor | null
}

type State = { open: boolean; captures: NoteCapture[] }

let state: State = { open: false, captures: [] }
const listeners = new Set<() => void>()
let nextId = 1

function set(next: Partial<State>) {
  state = { ...state, ...next }
  listeners.forEach((l) => l())
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

export function openNotes() {
  set({ open: true })
}

export function closeNotes() {
  set({ open: false })
}

export function toggleNotes() {
  set({ open: !state.open })
}

/** Open the panel and hand it something to add as a new note. */
export function captureToNotes(capture: Omit<NoteCapture, 'id'>) {
  set({ open: true, captures: [...state.captures, { ...capture, id: nextId++ }] })
}

/** The panel takes the captures it has turned into notes. */
export function takeCaptures(ids: number[]) {
  set({ captures: state.captures.filter((c) => !ids.includes(c.id)) })
}

export function resetNotes() {
  state = { open: false, captures: [] }
  listeners.forEach((l) => l())
}

const server: State = { open: false, captures: [] }

export function useNotesState(): State {
  return useSyncExternalStore(subscribe, () => state, () => server)
}
