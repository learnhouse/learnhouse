'use client'
import { useEffect, useRef } from 'react'
import { useLHAnalytics, type EventProps } from './useLHAnalytics'
import { AnalyticsEvent } from './events'

/**
 * Fire a mount/impression event exactly once when `ready` becomes true.
 *
 * Guards against React StrictMode double-invocation and re-render inflation via
 * a ref, so `*_viewed` events count one impression per mount. Pass `ready` to
 * defer firing until the data the event describes has loaded (e.g. onSuccess).
 *
 * Usage:
 *   useTrackView(AnalyticsEvent.StoreViewed, { offers_count }, !isLoading)
 */
export function useTrackView(
  event: AnalyticsEvent,
  props: EventProps = {},
  ready: boolean = true,
  surface?: string,
) {
  const { track } = useLHAnalytics(surface)
  const firedRef = useRef(false)

  useEffect(() => {
    if (!ready || firedRef.current) return
    firedRef.current = true
    track(event, props)
    // Intentionally fire once per mount: exclude `props`/`track` from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, event])
}
