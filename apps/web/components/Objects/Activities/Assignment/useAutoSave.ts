import React from 'react'
import { createBeforeUnloadHandler } from '@components/Objects/Editor/unsavedChangesGuard'

// Value-driven auto-save.
//
// The learner's answer is auto-persisted whenever the CURRENT serialized value
// differs from the LAST-SAVED serialized value. Both strings are supplied by the
// task, which seeds them equal on hydration (so nothing saves on load) and
// reseeds the baseline on every save. Because "dirty" is a pure content
// predicate (currentValue !== savedValue) rather than a boolean flag, it is
// immune to query refetches, window focus, submission-status changes, and
// unrelated re-renders — the failure modes of the previous flag+poller design.

export type AutoSaveStatus =
  | 'idle'
  // A debounced edit is waiting for the timer to elapse. Distinct from 'saving'
  // so the UI doesn't claim a request is in flight while only a timer is armed.
  | 'pending'
  | 'saving'
  | 'saved'
  // Transient failure: a capped, backed-off retry is scheduled (or the cap has
  // just been reached and the value stays dirty until the learner edits again).
  | 'error'
  // Permanent refusal (policy): retrying can never succeed, so we don't.
  | 'blocked'

// What a task's save callback reports back.
//   true  / 'ok'      -> persisted
//   false / 'retry'   -> transient failure, worth retrying
//   'blocked'         -> the server/task refused on policy grounds (past-due
//                        403, `require_passing_to_submit`, …). Retrying loops
//                        forever and lies to the learner, so we stop.
export type SaveOutcome = 'ok' | 'retry' | 'blocked'
export type SaveResult = boolean | SaveOutcome

type Args = {
  currentValue: string
  savedValue: string
  save: (_opts?: { silent?: boolean }) => void | Promise<SaveResult | void>
  enabled: boolean
  debounceMs?: number
  // Backoff before automatically retrying a failed save (doubles per attempt).
  retryMs?: number
  // Hard cap on automatic retries for a given value. Without it a permanently
  // failing write re-armed the debounce effect forever (~every 5s for the life
  // of the mount) behind a "Couldn't save — retrying…" chip that never resolved.
  maxRetries?: number
}

export type AutoSaveController = {
  status: AutoSaveStatus
  isDirty: boolean
  isSaving: boolean
  // True when the last save attempt did NOT reach the server-side row: either a
  // transient failure (retry pending / cap reached) or a permanent refusal.
  // Consumers that only know about this flag still show a warning instead of a
  // stuck spinner; `isBlocked` below separates the terminal case.
  isError: boolean
  // Terminal: the save was refused on policy grounds and will NOT be retried.
  // Deserves distinct copy ("can't be saved") rather than "retrying…".
  isBlocked: boolean
  // A debounced edit exists but nothing has been sent yet.
  isPending: boolean
  // Persist immediately if dirty. Used by the submit-for-grading flush.
  flush: () => Promise<boolean>
  // Manual save (non-silent, shows a toast). Routed through the same in-flight
  // guard as auto-save so a manual click can't race a background save into two
  // rows.
  saveNow: () => Promise<boolean>
  getIsDirty: () => boolean
}

// Callbacks predate the discriminated result and still return plain booleans
// (or nothing at all), so normalize everything to a SaveOutcome here.
function toOutcome(res: SaveResult | void): SaveOutcome {
  if (res === 'blocked') return 'blocked'
  if (res === false || res === 'retry') return 'retry'
  return 'ok'
}

export function useAutoSave({
  currentValue,
  savedValue,
  save,
  enabled,
  debounceMs = 1000,
  retryMs = 4000,
  maxRetries = 5,
}: Args): AutoSaveController {
  const [status, setStatus] = React.useState<AutoSaveStatus>('idle')
  // Bumped after a failed save to re-arm the debounce effect (whose deps are
  // otherwise unchanged, so it would never retry on its own).
  const [retryTick, setRetryTick] = React.useState(0)
  const retryTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  // Failed attempts for the CURRENT value. Reset whenever the learner edits
  // (a new value deserves a fresh budget) and on every success.
  const attempts = React.useRef(0)
  const lastAttemptedValue = React.useRef<string | null>(null)
  // The exact value the server permanently refused. Kept so we don't replay a
  // doomed write (on unmount, on tab hide, on a manual click) while the learner
  // hasn't changed anything — but a real edit gets a fresh attempt.
  const blockedValue = React.useRef<string | null>(null)

  // Always read the freshest value/baseline/save fn from refs so the debounce
  // timer and the flush never act on a stale closure.
  const curRef = React.useRef(currentValue)
  const savedRef = React.useRef(savedValue)
  const saveRef = React.useRef(save)
  const enabledRef = React.useRef(enabled)
  const inFlight = React.useRef(false)
  const mounted = React.useRef(true)
  // Points at the persist-based flush (defined below). Used by the unmount and
  // page-exit handlers so they await any in-flight save and THEN write the
  // latest dirty value, instead of skipping while a save is mid-flight and
  // losing the newer edit.
  const flushRef = React.useRef<(() => Promise<boolean>) | null>(null)
  React.useEffect(() => { curRef.current = currentValue })
  React.useEffect(() => { savedRef.current = savedValue })
  React.useEffect(() => { saveRef.current = save })
  React.useEffect(() => { enabledRef.current = enabled })

  // After a failed save, schedule a single re-arm of the debounce effect so the
  // still-dirty value is retried once the backoff elapses (the effect's string
  // deps don't change on failure, so nothing else would trigger a retry).
  // Exponential so a server that is down doesn't get hammered every 4s.
  const scheduleRetry = React.useCallback((attempt: number) => {
    if (retryTimer.current) clearTimeout(retryTimer.current)
    const delay = Math.min(retryMs * 2 ** Math.max(0, attempt - 1), 60_000)
    retryTimer.current = setTimeout(() => {
      if (mounted.current && enabledRef.current && curRef.current !== savedRef.current) {
        setRetryTick((t) => t + 1)
      }
    }, delay)
  }, [retryMs])

  const isDirty = enabled && currentValue !== savedValue

  const getIsDirty = React.useCallback(
    () => enabledRef.current && curRef.current !== savedRef.current,
    []
  )

  // Tracks the currently running save so flush/manual can AWAIT it rather than
  // returning a false "success" while a request is still in flight.
  const inFlightPromise = React.useRef<Promise<SaveOutcome> | null>(null)

  const doSave = React.useCallback(async (silent: boolean): Promise<SaveOutcome> => {
    inFlight.current = true
    const attemptedValue = curRef.current
    // A brand-new value gets a fresh retry budget: the cap must bound retries of
    // ONE failing payload, not the learner's whole editing session.
    if (lastAttemptedValue.current !== attemptedValue) {
      lastAttemptedValue.current = attemptedValue
      attempts.current = 0
      blockedValue.current = null
    }
    if (mounted.current) setStatus('saving')
    const p = (async (): Promise<SaveOutcome> => {
      try {
        const outcome = toOutcome(await saveRef.current({ silent }))
        if (outcome === 'ok') {
          attempts.current = 0
          if (mounted.current) setStatus('saved')
          return 'ok'
        }
        if (outcome === 'blocked') {
          // Permanent policy refusal — a retry would fail identically forever.
          // Surface a terminal state instead of an eternal "retrying…" chip.
          if (retryTimer.current) clearTimeout(retryTimer.current)
          blockedValue.current = attemptedValue
          if (mounted.current) setStatus('blocked')
          return 'blocked'
        }
        attempts.current += 1
        if (mounted.current) setStatus('error')
        if (attempts.current < maxRetries) scheduleRetry(attempts.current)
        return 'retry'
      } catch {
        // A failed save must NOT reseed the baseline (the value isn't on the
        // server): mark 'error' so the UI shows a distinct indicator instead of
        // a stuck spinner, and re-arm a retry so a transient failure recovers —
        // but only while the attempt budget lasts.
        attempts.current += 1
        if (mounted.current) setStatus('error')
        if (attempts.current < maxRetries) scheduleRetry(attempts.current)
        return 'retry'
      } finally {
        inFlight.current = false
        inFlightPromise.current = null
      }
    })()
    inFlightPromise.current = p
    return p
  }, [scheduleRetry, maxRetries])

  // Background debounce path: coalesce (skip while a save runs; the effect
  // re-arms when the baseline reseeds after that save).
  const runAutoSave = React.useCallback(async (): Promise<SaveOutcome> => {
    if (inFlight.current) return 'ok'
    if (!getIsDirty()) return 'ok'
    // Don't replay a value the server already refused for good.
    if (blockedValue.current !== null && blockedValue.current === curRef.current) return 'blocked'
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
        const outcome = await doSave(silent)
        didSave = true
        // 'blocked' is terminal: looping would just replay the same refusal.
        if (outcome !== 'ok') return false
      }
      // Manual save with nothing dirty still does one save so the click gives
      // feedback and any never-persisted value is written.
      if (force && !didSave) return (await doSave(silent)) === 'ok'
      return true
    },
    [getIsDirty, doSave]
  )

  // Trailing debounce. Deps are the primitive strings, so an edit re-arms and a
  // post-save baseline reseed re-runs the effect — following a mid-flight edit
  // to completion, then settling when currentValue === savedValue.
  React.useEffect(() => {
    if (!enabled || currentValue === savedValue) return
    // Nothing is in flight yet — say so instead of showing "Saving…" for a
    // request that hasn't been made. A failure indicator survives a re-arm of
    // the SAME value (the retry tick), but a genuine new edit clears it.
    setStatus((s) => {
      if (s === 'saving') return s
      if ((s === 'error' || s === 'blocked') && currentValue === lastAttemptedValue.current) return s
      return 'pending'
    })
    const id = setTimeout(() => { runAutoSave() }, debounceMs)
    return () => clearTimeout(id)
    // retryTick re-arms this effect after a failed save so a still-dirty value
    // is retried even though the value/baseline strings are unchanged.
  }, [currentValue, savedValue, enabled, debounceMs, runAutoSave, retryTick])

  // Persist whatever the debounce timer hasn't sent yet when the component goes
  // away. Continuous typing re-arms the 1000ms timer on every keystroke, so
  // navigating away mid-burst used to discard the entire burst (the cleanup only
  // cleared the timer). Fire-and-forget: the request is what matters, the
  // unmounted component's state updates are no-ops.
  React.useEffect(() => () => {
    if (retryTimer.current) clearTimeout(retryTimer.current)
    const isBlockedValue = blockedValue.current !== null && blockedValue.current === curRef.current
    if (!isBlockedValue && enabledRef.current && curRef.current !== savedRef.current) {
      // Route through the persist-based flush: it awaits an in-flight save and
      // then writes the latest dirty value. Firing the raw save here (as it
      // used to) skipped whenever a save was already running, dropping the
      // newer edit. Fire-and-forget — the request is what matters.
      void flushRef.current?.()
    }
    mounted.current = false
  }, [])

  // Same protection for a tab close / refresh / mobile backgrounding, which
  // unmount cleanups don't reliably reach. `pagehide` covers unload + bfcache,
  // `visibilitychange` covers iOS/Android where `pagehide` may not fire; the
  // beforeunload guard (shared with the Editor) warns if the write can't finish.
  React.useEffect(() => {
    if (typeof window === 'undefined') return
    // Persist-based flush (awaits any in-flight save, then writes the latest
    // dirty value) rather than runAutoSave, which no-ops while a save is
    // in flight and would drop an edit made during that request.
    const flushPending = () => { void flushRef.current?.() }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flushPending()
    }
    // Don't nag about work that can never be persisted anyway (blocked value):
    // staying on the page wouldn't save it.
    const onBeforeUnload = createBeforeUnloadHandler(
      () => getIsDirty() && blockedValue.current !== curRef.current
    )
    window.addEventListener('pagehide', flushPending)
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      window.removeEventListener('pagehide', flushPending)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('beforeunload', onBeforeUnload)
    }
  }, [runAutoSave, getIsDirty])

  const flush = React.useCallback(() => persist(true, false), [persist])
  const saveNow = React.useCallback(() => persist(false, true), [persist])

  // Keep the unmount / page-exit handlers pointed at the current flush.
  React.useEffect(() => { flushRef.current = flush }, [flush])

  return {
    status,
    isDirty,
    isSaving: status === 'saving',
    isError: status === 'error' || status === 'blocked',
    isBlocked: status === 'blocked',
    isPending: status === 'pending',
    flush,
    saveNow,
    getIsDirty,
  }
}
