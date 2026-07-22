'use client'
import { useSyncExternalStore } from 'react'
import { getAbsoluteUriWithOrg } from '@services/config/config'
import { getCanonicalUrl } from './utils'

/** Nothing to subscribe to: whether we're on the client never changes after hydration. */
const subscribe = () => () => {}

/**
 * Absolute, shareable URL for a path on the current org — for links the user
 * copies out of the app (RSS feeds, sitemap/robots, invite links) rather than
 * navigates with.
 *
 * The absolute form depends on `window.location`, which doesn't exist during
 * SSR, so the server render (and the hydrating render) falls back to the same
 * value the server would produce. Without that, server and client markup
 * disagree and React reports a hydration mismatch.
 */
export function useAbsoluteUrl(orgslug: string, path: string): string {
  const isHydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  )

  return isHydrated
    ? getAbsoluteUriWithOrg(orgslug, path).replace(/\/+$/, '')
    : getCanonicalUrl(orgslug, path)
}
