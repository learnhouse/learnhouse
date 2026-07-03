'use client'
import { useCallback } from 'react'
import { usePostHog } from 'posthog-js/react'
import { useAnalytics } from '@/hooks/useAnalytics'
import { useStandardProps } from './context'
import { AnalyticsEvent, POSTHOG_NAME_OVERRIDES, featureGroupOf } from './events'

export type EventProps = Record<string, unknown>

// Dedupe org group-identify calls across the app (PostHog only needs it once
// per org per session; calling on every event would be wasteful).
let lastGroupedOrg: string | null = null

/**
 * The ONE analytics hook. A single `track()` fans every event out to:
 *   1. the existing LearnHouse backend (token-gated; anonymous no-op by design), and
 *   2. PostHog (captures anonymous users too — unlocks logged-out funnels).
 *
 * Standard props (org/plan/surface/locale/role/…) are injected automatically;
 * call-sites pass only event-specific properties.
 *
 * Usage:
 *   const { track } = useLHAnalytics('learner')
 *   track(AnalyticsEvent.CourseStarted, { course_uuid, total_activities })
 */
export function useLHAnalytics(surface?: string) {
  const posthog = usePostHog()
  const { track: backendTrack } = useAnalytics()
  const standard = useStandardProps(surface)

  const track = useCallback(
    (event: AnalyticsEvent, props: EventProps = {}) => {
      const payload = { ...standard, ...props, feature: featureGroupOf(event) }

      // Associate the org group once (enables org-level rollups in PostHog).
      const orgId = standard.org_id != null ? String(standard.org_id) : null
      if (posthog && orgId && orgId !== lastGroupedOrg) {
        lastGroupedOrg = orgId
        posthog.group('organization', orgId, { slug: standard.org_slug })
      }

      // 1) backend sink (existing hook; no-op for anonymous users)
      backendTrack(event, payload)
      // 2) PostHog sink (captures anonymous too)
      posthog?.capture(POSTHOG_NAME_OVERRIDES[event] ?? event, payload)
    },
    [posthog, backendTrack, standard],
  )

  const trackPageView = useCallback(
    (extra: EventProps = {}) => {
      // PostHog $pageview is fired by PostHogPageView; here we only emit the
      // backend page_view so we don't double-count in PostHog.
      backendTrack(AnalyticsEvent.PageViewed, { ...standard, ...extra })
    },
    [backendTrack, standard],
  )

  const identify = useCallback(
    (userId: string, traits: EventProps = {}) => {
      posthog?.identify(String(userId), traits)
    },
    [posthog],
  )

  const group = useCallback(
    (orgId: string, traits: EventProps = {}) => {
      lastGroupedOrg = String(orgId)
      posthog?.group('organization', String(orgId), traits)
    },
    [posthog],
  )

  const reset = useCallback(() => {
    lastGroupedOrg = null
    posthog?.reset()
  }, [posthog])

  return { track, trackPageView, identify, group, reset }
}
