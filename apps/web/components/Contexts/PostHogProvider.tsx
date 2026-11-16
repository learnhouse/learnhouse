'use client'
import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { getPOSTHOG_KEY_VAL } from '@services/config/config'
import { onAfterLoad } from '@/lib/afterLoad'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { scrubUrl } from '@services/utils/ts/scrubUrl'
import {
  PostHogClientContext,
  PostHogFacade,
  usePostHogClient,
  usePostHogReady,
} from '@/lib/analytics/posthogClient'

// The SDK and its init options live in lib/analytics/posthogInit.ts, loaded
// once the browser is idle after the page; calls made before that are queued
// by the facade (lib/analytics/posthogClient.ts).
const loadPostHogInit = () => import('@/lib/analytics/posthogInit')

/**
 * Disables ALL PostHog capture (autocapture, pageviews, session replay) while
 * the user is in the super-admin area (/admin); that's the platform owner's
 * internal dashboard and is intentionally untracked. Re-enables elsewhere.
 */
function PostHogAdminGuard() {
  const posthogClient = usePostHogClient()
  // Re-checked once the SDK has loaded: its persisted opt-out is unknown before.
  const ready = usePostHogReady()
  const pathname = usePathname()
  // An impersonation is not the member's activity.
  const impersonating = !!(useLHSession() as any)?.data?.impersonation

  useEffect(() => {
    if (!posthogClient) return
    const isAdmin = pathname?.startsWith('/admin') || impersonating
    if (isAdmin) {
      if (!posthogClient.has_opted_out_capturing()) posthogClient.opt_out_capturing()
    } else if (posthogClient.has_opted_out_capturing()) {
      posthogClient.opt_in_capturing()
    }
  }, [posthogClient, pathname, ready, impersonating])

  return null
}

/** Fires PostHog's native $pageview on every App Router navigation. */
function PostHogPageView() {
  const posthogClient = usePostHogClient()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  useEffect(() => {
    if (!posthogClient || !pathname) return
    // Never emit pageviews for the super-admin area.
    if (pathname.startsWith('/admin')) return
    let url = window.origin + pathname
    const qs = searchParams?.toString()
    if (qs) url += `?${qs}`
    posthogClient.capture('$pageview', { $current_url: scrubUrl(url) })
  }, [posthogClient, pathname, searchParams])

  return null
}

/**
 * Identifies the user across ALL auth paths and resets on logout/expiry.
 * Watches the central session (AuthContext) so credentials, Google, SSO,
 * token-exchange, cross-tab logout and 401 expiry are all covered from one place.
 */
function PostHogIdentify() {
  const posthogClient = usePostHogClient()
  const session = useLHSession() as any
  const status = session?.status
  const user = session?.data?.user
  const identifiedRef = useRef<string | null>(null)

  const impersonating = !!session?.data?.impersonation

  useEffect(() => {
    if (!posthogClient) return
    // Never identify the browser as the member an impersonation acts for.
    if (impersonating) return

    if (status === 'authenticated' && user?.user_uuid) {
      if (identifiedRef.current !== user.user_uuid) {
        identifiedRef.current = user.user_uuid
        // Identify by uuid only; no email/PII in person properties.
        posthogClient.identify(String(user.user_uuid))
      }
      return
    }

    if (status === 'unauthenticated' && identifiedRef.current) {
      identifiedRef.current = null
      posthogClient.reset()
    }
  }, [posthogClient, status, user?.user_uuid, impersonating])

  return null
}

/**
 * Mounts PostHog when NEXT_PUBLIC_POSTHOG_KEY is set; otherwise renders children
 * untouched and never loads PostHog (true off-switch / opt-in).
 */
export default function PostHogProvider({ children }: { children: React.ReactNode }) {
  const key = getPOSTHOG_KEY_VAL()
  const client = useMemo(() => (key ? new PostHogFacade() : null), [key])
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!client || !key) return
    let cancelled = false
    const load = () => {
      loadPostHogInit()
        .then(({ initPostHog }) => {
          if (cancelled) return
          client.attach(initPostHog(key))
          setReady(true)
        })
        .catch(() => {})
    }
    // After the page's own work: analytics never competes with first paint.
    const cancelWait = onAfterLoad(load, { timeout: 3000 })
    return () => { cancelled = true; cancelWait() }
  }, [client, key])

  const value = useMemo(() => ({ client, ready }), [client, ready])

  if (!client) return <>{children}</>

  return (
    <PostHogClientContext.Provider value={value}>
      <PostHogAdminGuard />
      <Suspense fallback={null}>
        <PostHogPageView />
      </Suspense>
      <PostHogIdentify />
      {children}
    </PostHogClientContext.Provider>
  )
}
