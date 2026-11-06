'use client'
import { useCallback, useEffect, useRef } from 'react'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { trackEvent } from '@services/analytics/analytics'
import {
  AnalyticsEvent,
  BACKEND_EVENTS,
  MEMBER_ONLY_BACKEND_EVENTS,
} from '@services/analytics/events'

/**
 * Backend sink for org analytics. Sends only the events the API accepts
 * (BACKEND_EVENTS), for anonymous visitors too: the Authorization header is
 * added when there is a session, the org id is always required.
 *
 * `track` keeps the same identity across renders, so effects that depend on
 * it don't re-fire when the session or org object refreshes.
 */
export function useAnalytics() {
  const org = useOrg() as any
  const session = useLHSession() as any
  const orgId: number | undefined = org?.id
  const accessToken: string | undefined = session?.data?.tokens?.access_token

  const latest = useRef({ orgId, accessToken })
  useEffect(() => {
    latest.current = { orgId, accessToken }
  }, [orgId, accessToken])

  const track = useCallback((event: AnalyticsEvent, properties: Record<string, unknown> = {}) => {
    const { orgId: currentOrgId, accessToken: token } = latest.current
    if (!currentOrgId || !BACKEND_EVENTS.has(event)) return
    // The API drops these for visitors who aren't signed in; don't send them.
    if (!token && MEMBER_ONLY_BACKEND_EVENTS.has(event)) return
    trackEvent(event, currentOrgId, properties, token)
  }, [])

  return { track }
}
