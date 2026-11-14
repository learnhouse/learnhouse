'use client'
import React from 'react'
import { getAPIUrl, getCollabUrl } from '@services/config/config'
import type { CollabSession } from './collabRuntime'
import type { CollabUser } from './collabStatus'
import { withLocaleQuery } from '../Translation/translationEditorModel'

/**
 * connecting:  joining the room (the editor already shows the content);
 * live:        synced, `session` is ready for the editor;
 * unavailable: no live editing for this user/page (autosave mode only).
 */
export type CollabState =
  | { phase: 'connecting'; session: null }
  | { phase: 'live'; session: CollabSession }
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
 * synced (see EditorWrapper). An unreachable collab server keeps being
 * retried, so live editing starts when it comes back.
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
    const getToken = () => getTokenRef.current()

    // After the editor's first paint: joining must not compete with it
    const afterPaint = () =>
      new Promise<void>((resolve) => {
        const ric = (window as any).requestIdleCallback as undefined | ((_cb: () => void, _o?: { timeout: number }) => number)
        if (ric) ric(() => resolve(), { timeout: 250 })
        else setTimeout(resolve, 50)
      })

    ;(async () => {
      try {
        await afterPaint()
        if (cancelled) return
        const token = await getToken()
        if (!token) throw new Error('no session')
        const response = await fetch(withLocaleQuery(`${getAPIUrl()}activities/${opts.activityUuid}/collab/access`, opts.locale), {
          headers: { Authorization: `Bearer ${token}` },
          credentials: 'include',
        })
        if (response.status === 503) markUnavailable()
        if (response.status === 403) {
          const body = await response.json().catch(() => null)
          if (body?.detail === 'collab_disabled') {
            if (!cancelled) setState({ phase: 'disabled', session: null })
            return
          }
        }
        if (!response.ok) throw new Error(`access ${response.status}`)
        const access = (await response.json()) as AccessAnswer
        const user: CollabUser = {
          id: access.user.id,
          name: access.user.display_name,
          color: access.user.color,
          avatar: access.user.avatar_image,
          uuid: access.user.user_uuid,
        }
        const { startCollabSession } = await import('./collabRuntime')
        if (cancelled) return
        const started = startCollabSession({ url: getCollabUrl(), activityUuid: opts.activityUuid, locale: opts.locale, user, getToken })
        session = started.session
        await started.ready
        if (!cancelled) setState({ phase: 'live', session: started.session })
      } catch (err) {
        if (cancelled) return
        session?.destroy()
        session = null
        setState({ phase: 'unavailable', session: null, reason: err instanceof Error ? err.message : 'failed' })
      }
    })()

    return () => {
      cancelled = true
      session?.destroy()
    }
  }, [opts.activityUuid, opts.locale, opts.enabled])

  return state
}
