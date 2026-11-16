'use client'
import React from 'react'
import type { CollabSession } from './collabRuntime'
import { type CollabSnapshot, INITIAL_SNAPSHOT } from './collabStatus'

/** The editor's collab session, or null in the legacy (manual save) mode. */
export const CollabContext = React.createContext<CollabSession | null>(null)

export function useCollabSession(): CollabSession | null {
  return React.useContext(CollabContext)
}

const noopSubscribe = () => () => {}
const initial = () => INITIAL_SNAPSHOT

/**
 * The session's status (connection, saving, presence). Re-renders only the
 * component using it, never the editor.
 */
export function useCollabSnapshot(session: CollabSession | null): CollabSnapshot {
  return React.useSyncExternalStore(
    session ? session.subscribe : noopSubscribe,
    session ? session.getSnapshot : initial,
    initial,
  )
}
