'use client'
import React from 'react'
import { type AutosaveStatus, nextAutosaveDelay } from './autosaveTiming'

export type SaveOutcome = 'saved' | 'conflict' | 'failed'

export interface AutosaveState {
  status: AutosaveStatus
  lastSavedAt: number | null
  /** Edits not saved yet (typing, in flight, failed or in conflict). */
  dirty: boolean
}

/**
 * Saves the editor by itself when it isn't collaborative: about `idleMs`
 * after typing stops, at least every `maxMs` while it goes on, and right
 * away when the editor loses focus, the tab is hidden or the user follows a
 * link. A failed save retries with backoff (and when the browser is back
 * online); a conflict pauses saving until the caller resolves it.
 */
export function useAutosave({
  editor,
  enabled,
  save,
  idleMs = 1500,
  maxMs = 10_000,
}: {
  editor: any
  enabled: boolean
  save: () => Promise<SaveOutcome>
  idleMs?: number
  maxMs?: number
}) {
  const [state, setState] = React.useState<AutosaveState>({ status: 'saved', lastSavedAt: null, dirty: false })
  const saveRef = React.useRef(save)
  React.useEffect(() => {
    saveRef.current = save
  })

  const r = React.useRef({
    dirty: false,
    saving: false,
    paused: false,
    failures: 0,
    idle: null as ReturnType<typeof setTimeout> | null,
    max: null as ReturnType<typeof setTimeout> | null,
    retry: null as ReturnType<typeof setTimeout> | null,
    status: 'saved' as AutosaveStatus,
  })

  const update = React.useCallback((patch: Partial<AutosaveState>) => {
    if (patch.status) r.current.status = patch.status
    setState((prev) => {
      const next = { ...prev, ...patch }
      return next.status === prev.status && next.dirty === prev.dirty && next.lastSavedAt === prev.lastSavedAt ? prev : next
    })
  }, [])

  const clearTimers = () => {
    const s = r.current
    if (s.idle) clearTimeout(s.idle)
    if (s.max) clearTimeout(s.max)
    s.idle = null
    s.max = null
  }

  // Lets a save in flight (or a retry) start the next one
  const runRef = React.useRef<() => Promise<void>>(async () => {})

  const run = React.useCallback(async (): Promise<void> => {
    const s = r.current
    clearTimers()
    if (!s.dirty || s.paused) return
    if (s.saving) return // the save in flight re-runs when it ends
    if (s.retry) clearTimeout(s.retry)
    s.retry = null
    s.saving = true
    s.dirty = false
    update({ status: 'saving' })
    let outcome: SaveOutcome = 'failed'
    try {
      outcome = await saveRef.current()
    } catch {
      outcome = 'failed'
    }
    s.saving = false
    if (outcome === 'saved') {
      s.failures = 0
      const now = Date.now()
      if (s.dirty) {
        // Typed while saving: save that too, soon
        update({ lastSavedAt: now, status: 'saving' })
        s.idle = setTimeout(() => void runRef.current(), idleMs)
      } else {
        update({ lastSavedAt: now, status: 'saved', dirty: false })
      }
      return
    }
    s.dirty = true
    if (outcome === 'conflict') {
      s.paused = true
      update({ status: 'conflict', dirty: true })
      return
    }
    s.failures++
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false
    update({ status: offline ? 'offline' : 'failed', dirty: true })
    s.retry = setTimeout(() => void runRef.current(), nextAutosaveDelay(s.failures))
  }, [idleMs, update])
  React.useEffect(() => {
    runRef.current = run
  }, [run])

  const schedule = React.useCallback(() => {
    const s = r.current
    if (s.idle) clearTimeout(s.idle)
    s.idle = setTimeout(() => void run(), idleMs)
    if (!s.max) s.max = setTimeout(() => void run(), maxMs)
  }, [idleMs, maxMs, run])

  // Edits
  React.useEffect(() => {
    if (!editor || !enabled) return
    const onUpdate = () => {
      const s = r.current
      s.dirty = true
      if (!s.saving && s.status !== 'failed' && s.status !== 'offline' && s.status !== 'conflict') {
        // One state change per burst, not per keystroke
        if (!state.dirty) update({ dirty: true })
      }
      if (!s.paused) schedule()
    }
    const onBlur = () => void run()
    editor.on('update', onUpdate)
    editor.on('blur', onBlur)
    return () => {
      editor.off('update', onUpdate)
      editor.off('blur', onBlur)
    }
  }, [editor, enabled, schedule, run, update, state.dirty])

  // Leaving: save now; warn only when a save can't complete in time
  React.useEffect(() => {
    if (!enabled) return
    const onHidden = () => {
      if (document.visibilityState === 'hidden') void run()
    }
    const onOnline = () => void run()
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      const s = r.current
      if (!s.dirty && !s.saving) return undefined
      void run()
      event.preventDefault()
      event.returnValue = ''
      return ''
    }
    // In-app navigation (Next links) doesn't unload the page: save on the way out
    const onClick = (event: MouseEvent) => {
      const anchor = (event.target as HTMLElement | null)?.closest?.('a')
      if (anchor && anchor.target !== '_blank' && r.current.dirty) void run()
    }
    document.addEventListener('visibilitychange', onHidden)
    window.addEventListener('online', onOnline)
    window.addEventListener('beforeunload', onBeforeUnload)
    document.addEventListener('click', onClick, true)
    return () => {
      document.removeEventListener('visibilitychange', onHidden)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('beforeunload', onBeforeUnload)
      document.removeEventListener('click', onClick, true)
    }
  }, [enabled, run])

  // Unmount (route change, switching to live editing): save what's left
  React.useEffect(() => {
    const s = r.current
    return () => {
      clearTimers()
      if (s.retry) clearTimeout(s.retry)
      if (s.dirty && !s.saving && !s.paused) void saveRef.current()
    }
  }, [])

  /** Saves now (Cmd+S, Retry). */
  const flush = React.useCallback(() => {
    r.current.paused = false
    void run()
  }, [run])

  /** The caller saved (a resolved conflict): back to normal. */
  const markSaved = React.useCallback(() => {
    const s = r.current
    s.paused = false
    s.dirty = false
    s.failures = 0
    update({ status: 'saved', dirty: false, lastSavedAt: Date.now() })
  }, [update])

  /** Nothing unsaved and nothing in flight. */
  const isClean = React.useCallback(() => !r.current.dirty && !r.current.saving && !r.current.paused, [])

  return { ...state, flush, markSaved, isClean }
}
