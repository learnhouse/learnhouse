// The app's analytics (backend + PostHog) become the onEvent callback.
import { useCallback, useEffect } from 'react'
import { useLearnHouseInternal } from '../context'

export { AnalyticsEvent } from '@services/analytics/events'

export type EventProps = Record<string, unknown>

export function useLHAnalytics(surface?: string) {
  const { emit } = useLearnHouseInternal()
  const track = useCallback(
    (event: string, props?: EventProps) => emit({ type: 'analytics', name: event, surface, ...props }),
    [emit, surface],
  )
  return { track }
}

export function useTrackView(event: string, props?: EventProps) {
  const { track } = useLHAnalytics()
  useEffect(() => {
    track(event, props)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event])
}

export function useStandardProps() {
  return {}
}
