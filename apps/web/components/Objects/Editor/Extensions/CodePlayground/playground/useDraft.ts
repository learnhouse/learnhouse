'use client'
import React from 'react'

/**
 * Local draft of a node attr that the author types into (code, mostly).
 *
 * Keystrokes stay local; the value is committed after a pause and when the
 * field loses focus, so collaborators get one update per pause instead of one
 * per key. While nothing is pending the draft follows the attr, so undo and a
 * collaborator's edits show up.
 */
export function useDraft(value: string, commit: (_v: string) => void, delay = 800) {
  const [draft, setDraftState] = React.useState(value)
  const pending = React.useRef<string | null>(null)
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const commitRef = React.useRef(commit)
  React.useEffect(() => {
    commitRef.current = commit
  })

  // Adopt outside changes when we have nothing unsaved.
  const [lastValue, setLastValue] = React.useState(value)
  if (value !== lastValue) {
    setLastValue(value)
    if (pending.current === null) setDraftState(value)
  }

  const flush = React.useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    const next = pending.current
    pending.current = null
    if (next !== null) commitRef.current(next)
  }, [])

  const setDraft = React.useCallback(
    (next: string) => {
      setDraftState(next)
      pending.current = next
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(flush, delay)
    },
    [delay, flush],
  )

  // Never lose the last keystrokes when the block unmounts (delete, undo, page change).
  React.useEffect(() => flush, [flush])

  return { draft, setDraft, flush }
}
