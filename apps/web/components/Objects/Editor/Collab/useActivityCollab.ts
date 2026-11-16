'use client'
import React from 'react'
import { getAPIUrl, getCollabUrl } from '@services/config/config'
import type { CollabSession } from './collabRuntime'
import {
  type CollabFailureKind,
  type CollabUser,
  CollabStartError,
  accessResponseKind,
  joinWithRetry,
} from './collabStatus'
import { withLocaleQuery } from '../Translation/translationEditorModel'

/**
 * connecting:   joining the room (the editor already shows the content);
 * reconnecting: the last attempt could not reach or check the room; trying
 *               again after a pause (the editor keeps working meanwhile);
 * live:         synced, `session` is ready for the editor;
 * fallback:     live editing gave up (refused by the room, or unreachable
 *               after every retry): edit without it, saving manually;
 * forbidden:    the API says this user may not edit: show it read-only;
 * unavailable:  no live editing for this user/page (autosave mode only).
 */
export type CollabState =
  | { phase: 'connecting'; session: null }
  | { phase: 'reconnecting'; session: null; attempt: number }
  | { phase: 'live'; session: CollabSession }
  | { phase: 'fallback'; session: null; reason: 'refused' | 'unreachable' }
  | { phase: 'forbidden'; session: null }
  | { phase: 'unavailable'; session: null; reason: string }
  /** Live editing is turned off for this page (org or activity setting). */
  | { phase: 'disabled'; session: null }

// Collaboration not configured on this server: don't ask again for a while
const UNAVAILABLE_KEY = 'lh_collab_unavailable_until'
const UNAVAILABLE_MS = 5 * 60_000

function markUnavailable() {
  try {
    sessionStorage.setItem(UNAVAILABLE_KEY, String(Date.now() + UNAVAILABLE_MS))
  } catch {
    // storage blocked: just try again next time
  }
}

function recentlyUnavailable(): boolean {
  try {
    return Number(sessionStorage.getItem(UNAVAILABLE_KEY) || 0) > Date.now()
  } catch {
    return false
  }
}

interface AccessAnswer {
  role: 'editor' | 'viewer'
  user: { id: number; display_name: string; color: string; avatar_image: string | null; user_uuid: string }
}

/**
 * Joins the activity's live editing room in the background. Never blocks the
 * editor: it opens on the stored content and switches to the room once
 * synced (see EditorWrapper). Every attempt settles (see startCollabSession):
 * one that could not reach or check the room is retried with backoff
 * (RETRY_DELAYS_MS), then live editing gives up and the editor saves manually.
 */
export function useActivityCollab(opts: {
  activityUuid: string
  /** A translation's room (`activity:{uuid}:{locale}`); null/undefined = the source room. */
  locale?: string | null
  enabled: boolean
  getToken: () => Promise<string | null>
}): CollabState {
  const [state, setState] = React.useState<CollabState>(() =>
    !opts.enabled
      ? { phase: 'unavailable', session: null, reason: 'disabled' }
      : recentlyUnavailable()
        ? { phase: 'unavailable', session: null, reason: 'not configured' }
        : { phase: 'connecting', session: null },
  )
  const getTokenRef = React.useRef(opts.getToken)
  React.useEffect(() => {
    getTokenRef.current = opts.getToken
  })

  React.useEffect(() => {
    if (!opts.enabled) {
      setState((prev) => (prev.phase === 'unavailable' ? prev : { phase: 'unavailable', session: null, reason: 'disabled' }))
      return
    }
    if (recentlyUnavailable()) return
    setState((prev) => (prev.phase === 'connecting' ? prev : { phase: 'connecting', session: null }))
    let cancelled = false
    let session: CollabSession | null = null
    let wake: (() => void) | null = null
    const getToken = () => getTokenRef.current()

    // After the editor's first paint: joining must not compete with it
    const afterPaint = () =>
      new Promise<void>((resolve) => {
        const ric = (window as any).requestIdleCallback as undefined | ((_cb: () => void, _o?: { timeout: number }) => number)
        if (ric) ric(() => resolve(), { timeout: 250 })
        else setTimeout(resolve, 50)
      })
    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        const id = setTimeout(resolve, ms)
        wake = () => {
          clearTimeout(id)
          resolve()
        }
      })

    /** One attempt: the API's access check, then the room. Throws CollabStartError. */
    const join = async (): Promise<CollabSession> => {
      const token = await getToken()
      if (!token) throw new CollabStartError('other', 'no session')
      const response = await fetch(withLocaleQuery(`${getAPIUrl()}activities/${opts.activityUuid}/collab/access`, opts.locale), {
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include',
      })
      if (!response.ok) {
        const body = await response.json().catch(() => null)
        const kind = accessResponseKind(response.status, body?.detail) as CollabFailureKind
        if (kind === 'not_configured') markUnavailable()
        throw new CollabStartError(kind, `access ${response.status}`)
      }
      const access = (await response.json()) as AccessAnswer
      const user: CollabUser = {
        id: access.user.id,
        name: access.user.display_name,
        color: access.user.color,
        avatar: access.user.avatar_image,
        uuid: access.user.user_uuid,
      }
      const { startCollabSession } = await import('./collabRuntime')
      if (cancelled) throw new CollabStartError('other', 'cancelled')
      const started = startCollabSession({ url: getCollabUrl(), activityUuid: opts.activityUuid, locale: opts.locale, user, getToken })
      session = started.session
      await started.ready
      return started.session
    }

    ;(async () => {
      await afterPaint()
      const outcome = await joinWithRetry({
        join: async () => {
          try {
            return await join()
          } catch (err) {
            session?.destroy()
            session = null
            throw err
          }
        },
        onRetry: (attempt) => setState({ phase: 'reconnecting', session: null, attempt }),
        sleep,
        isCancelled: () => cancelled,
      })
      if (!outcome || cancelled) return
      setState(outcome.phase === 'live' ? { phase: 'live', session: outcome.session } : { ...outcome, session: null })
    })()

    return () => {
      cancelled = true
      wake?.()
      session?.destroy()
    }
  }, [opts.activityUuid, opts.locale, opts.enabled])

  return state
}
