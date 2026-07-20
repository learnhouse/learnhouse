import React from 'react'

// Value-driven auto-save.
//
// The learner's answer is auto-persisted whenever the CURRENT serialized value
// differs from the LAST-SAVED serialized value. Both strings are supplied by the
// task, which seeds them equal on hydration (so nothing saves on load) and
// reseeds the baseline on every save. Because "dirty" is a pure content
// predicate (currentValue !== savedValue) rather than a boolean flag, it is
// immune to query refetches, window focus, submission-status changes, and
// unrelated re-renders — the failure modes of the previous flag+poller design.

export type AutoSaveStatus = 'idle' | 'saving' | 'saved' | 'error'

type Args = {
  currentValue: string
  savedValue: string
  save: (_opts?: { silent?: boolean }) => void | Promise<boolean | void>
  enabled: boolean
  debounceMs?: number
  // Backoff before automatically retrying a failed save.
  retryMs?: number
}

export type AutoSaveController = {
  status: AutoSaveStatus
  isDirty: boolean
  isSaving: boolean
  // True when the last save attempt failed and a retry is pending. Used to show
  // a distinct "couldn't save" indicator instead of a stuck "Saving…" spinner.
  isError: boolean
  // Persist immediately if dirty. Used by the submit-for-grading flush.
  flush: () => Promise<boolean>
  // Manual save (non-silent, shows a toast). Routed through the same in-flight
  // guard as auto-save so a manual click can't race a background save into two
  // rows.
  saveNow: () => Promise<boolean>
  getIsDirty: () => boolean
}

export function useAutoSave({
  currentValue,
  savedValue,
  save,
  enabled,
  debounceMs = 1000,
  retryMs = 4000,
}: Args): AutoSaveController {
  const [status, setStatus] = React.useState<AutoSaveStatus>('idle')
  // Bumped after a failed save to re-arm the debounce effect (whose deps are
  // otherwise unchanged, so it would never retry on its own).
  const [retryTick, setRetryTick] = React.useState(0)
  const retryTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  // Always read the freshest value/baseline/save fn from refs so the debounce
  // timer and the flush never act on a stale closure.
  const curRef = React.useRef(currentValue)
  const savedRef = React.useRef(savedValue)
  const saveRef = React.useRef(save)
  const enabledRef = React.useRef(enabled)
  const inFlight = React.useRef(false)
  const mounted = React.useRef(true)
  React.useEffect(() => { curRef.current = currentValue })
  React.useEffect(() => { savedRef.current = savedValue })
  React.useEffect(() => { saveRef.current = save })
  React.useEffect(() => { enabledRef.current = enabled })
  React.useEffect(() => () => {
    mounted.current = false
    if (retryTimer.current) clearTimeout(retryTimer.current)
  }, [])

  // After a failed save, schedule a single re-arm of the debounce effect so the
  // still-dirty value is retried once the backoff elapses (the effect's string
  // deps don't change on failure, so nothing else would trigger a retry).
  const scheduleRetry = React.useCallback(() => {
    if (retryTimer.current) clearTimeout(retryTimer.current)
    retryTimer.current = setTimeout(() => {
      if (mounted.current && enabledRef.current && curRef.current !== savedRef.current) {
        setRetryTick((t) => t + 1)
      }
    }, retryMs)
  }, [retryMs])

  const isDirty = enabled && currentValue !== savedValue

  const getIsDirty = React.useCallback(
    () => enabledRef.current && curRef.current !== savedRef.current,
    []
  )

  // Tracks the currently running save so flush/manual can AWAIT it rather than
  // returning a false "success" while a request is still in flight.
  const inFlightPromise = React.useRef<Promise<boolean> | null>(null)

  const doSave = React.useCallback(async (silent: boolean): Promise<boolean> => {
    inFlight.current = true
    if (mounted.current) setStatus('saving')
    const p = (async () => {
      try {
        const res = await saveRef.current({ silent })
        const ok = res !== false
        if (mounted.current) setStatus(ok ? 'saved' : 'error')
        if (!ok) scheduleRetry()
        return ok
      } catch {
        // A failed save must NOT reseed the baseline (the value isn't on the
        // server): mark 'error' so the UI shows a distinct indicator instead of
        // a stuck spinner, and re-arm a retry so a transient failure recovers.
        if (mounted.current) setStatus('error')
        scheduleRetry()
        return false
      } finally {
        inFlight.current = false
        inFlightPromise.current = null
      }
    })()
    inFlightPromise.current = p
    return p
  }, [scheduleRetry])

  // Background debounce path: coalesce (skip while a save runs; the effect
  // re-arms when the baseline reseeds after that save).
  const runAutoSave = React.useCallback(async (): Promise<boolean> => {
    if (inFlight.current) return true
    if (!getIsDirty()) return true
    return doSave(true)
  }, [getIsDirty, doSave])

  // Persist-and-settle: used by the submit-time flush and the manual Save so
  // they GUARANTEE the latest value is on the server before returning. Awaits
  // any in-flight save, then saves while still dirty (bounded loop) so an edit
  // made during an in-flight request is never dropped from grading.
  const persist = React.useCallback(
    async (silent: boolean, force: boolean): Promise<boolean> => {
      if (inFlightPromise.current) {
        try { await inFlightPromise.current } catch { /* ignore */ }
      }
      let didSave = false
      for (let i = 0; i < 5; i++) {
        if (!getIsDirty()) break
        const ok = await doSave(silent)
        didSave = true
        if (!ok) return false
      }
      // Manual save with nothing dirty still does one save so the click gives
      // feedback and any never-persisted value is written.
      if (force && !didSave) return doSave(silent)
      return true
    },
    [getIsDirty, doSave]
  )

  // Trailing debounce. Deps are the primitive strings, so an edit re-arms and a
  // post-save baseline reseed re-runs the effect — following a mid-flight edit
  // to completion, then settling when currentValue === savedValue.
  React.useEffect(() => {
    if (!enabled || currentValue === savedValue) return
    const id = setTimeout(() => { runAutoSave() }, debounceMs)
    return () => clearTimeout(id)
    // retryTick re-arms this effect after a failed save so a still-dirty value
    // is retried even though the value/baseline strings are unchanged.
  }, [currentValue, savedValue, enabled, debounceMs, runAutoSave, retryTick])

  const flush = React.useCallback(() => persist(true, false), [persist])
  const saveNow = React.useCallback(() => persist(false, true), [persist])

  return {
    status,
    isDirty,
    isSaving: status === 'saving',
    isError: status === 'error',
    flush,
    saveNow,
    getIsDirty,
  }
}
