'use client'
import { useCallback, useEffect, useRef } from 'react'
import { usePostHogClient } from '@/lib/analytics/posthogClient'
import { useAnalytics } from '@/hooks/useAnalytics'
import { useOrgMembership } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useStandardProps } from './context'
import {
  AnalyticsEvent,
  BACKEND_EVENTS,
  BACKEND_ONLY_EVENTS,
  POSTHOG_NAME_OVERRIDES,
  featureGroupOf,
} from './events'

export type EventProps = Record<string, unknown>

// Dedupe org group-identify calls across the app (PostHog only needs it once
// per org per session; calling on every event would be wasteful).
let lastGroupedOrg: string | null = null

// Events fired before the session and org have loaded wait for them, so they
// carry the right org id, credentials and standard props. Bounded in case a
// surface never finishes loading.
const MAX_PENDING = 50

/**
 * The ONE analytics hook. A single `track()` fans an event out to:
 *   1. PostHog, for every event except BACKEND_ONLY_EVENTS (captures
 *      anonymous users too, which unlocks logged-out funnels), and
 *   2. the LearnHouse backend, for the events in BACKEND_EVENTS only; these
 *      feed the org analytics dashboards, for anonymous visitors too.
 *
 * Standard props (org/plan/surface/locale/role/…) are injected into the
 * PostHog payload automatically; call-sites pass only event-specific
 * properties. The backend gets the call-site properties alone: it derives
 * device, country and visitor itself and drops properties it doesn't know.
 *
 * `track` keeps the same identity for the life of the component, so an
 * effect that depends on it fires once per real change, not on every
 * session or org refresh. Events tracked while the session or org is still
 * loading are held and sent once both are known.
 *
 * Usage:
 *   const { track } = useLHAnalytics('learner')
 *   track(AnalyticsEvent.CourseStarted, { course_uuid, total_activities })
 */
export function useLHAnalytics(surface?: string) {
  // Null when PostHog is off; queues until the SDK has loaded otherwise.
  const posthog = usePostHogClient()
  const { track: backendTrack } = useAnalytics()
  const standard = useStandardProps(surface)
  const { orgslug } = useOrgMembership()
  const session = useLHSession() as any
  // Outside an OrgProvider (orgslug '') there's no org to wait for.
  const ready = session?.status !== 'loading' && (!orgslug || standard.org_id != null)

  const latest = useRef({ posthog, standard, ready })
  const pending = useRef<Array<[AnalyticsEvent, EventProps]>>([])

  const send = useCallback(
    (event: AnalyticsEvent, props: EventProps) => {
      const { posthog: ph, standard: std } = latest.current

      if (BACKEND_EVENTS.has(event)) backendTrack(event, props)
      if (BACKEND_ONLY_EVENTS.has(event)) return

      const payload = { ...std, ...props, feature: featureGroupOf(event) }

      // Associate the org group once (enables org-level rollups in PostHog).
      const orgId = std.org_id != null ? String(std.org_id) : null
      if (ph && orgId && orgId !== lastGroupedOrg) {
        lastGroupedOrg = orgId
        ph.group('organization', orgId, { slug: std.org_slug })
      }
      ph?.capture(POSTHOG_NAME_OVERRIDES[event] ?? event, payload)
    },
    [backendTrack],
  )

  useEffect(() => {
    latest.current = { posthog, standard, ready }
    if (!ready || pending.current.length === 0) return
    const queued = pending.current
    pending.current = []
    for (const [event, props] of queued) send(event, props)
  }, [posthog, standard, ready, send])

  const track = useCallback(
    (event: AnalyticsEvent, props: EventProps = {}) => {
      if (latest.current.ready) {
        send(event, props)
      } else if (pending.current.length < MAX_PENDING) {
        pending.current.push([event, props])
      }
    },
    [send],
  )

  const trackPageView = useCallback(
    (extra: EventProps = {}) => {
      // PostHog $pageview is fired by PostHogPageView; page_view is
      // backend-only so PostHog never double-counts.
      track(AnalyticsEvent.PageViewed, extra)
    },
    [track],
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
