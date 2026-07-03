/**
 * learnhouse-analytics — the single import surface for product analytics.
 *
 *   import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'
 *   const { track } = useLHAnalytics('learner')
 *   track(AnalyticsEvent.CourseStarted, { course_uuid })
 */
export { AnalyticsEvent } from './events'
export { useLHAnalytics, type EventProps } from './useLHAnalytics'
export { useTrackView } from './useTrackView'
export { useStandardProps, type StandardProps } from './context'
