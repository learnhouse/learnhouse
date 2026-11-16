// What the editor page shows while it loads. Pure, so every way the page can
// get stuck has a visible answer (and a test): the skeleton is only ever shown
// while something is actually on its way.

/** Longest the skeleton waits for the editor's data before offering a reload. */
export const LOADER_STALL_MS = 15_000
/** Longest the skeleton covers a mounted editor that never reported ready. */
export const EDITOR_READY_FALLBACK_MS = 8_000

export type EditorLoaderView =
  /** The data is here: the editor renders (behind the skeleton until ready). */
  | 'editor'
  /** The bootstrap request failed. */
  | 'error'
  /** No session to load with (signed out, or it could not be restored). */
  | 'signed_out'
  /** Still nothing after LOADER_STALL_MS. */
  | 'stalled'
  | 'loading'

export function editorLoaderView(s: {
  hasData: boolean
  hasError: boolean
  hasToken: boolean
  authStatus: 'loading' | 'authenticated' | 'unauthenticated'
  stalled: boolean
}): EditorLoaderView {
  // Data wins: a failed background refetch must not unmount an open editor
  if (s.hasData) return 'editor'
  if (s.hasError) return 'error'
  // The request only starts once there is a token: without one it never would
  if (!s.hasToken && s.authStatus === 'unauthenticated') return 'signed_out'
  if (s.stalled) return 'stalled'
  return 'loading'
}
