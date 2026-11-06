'use client'
import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { useLHAnalytics } from '@services/analytics'
import { isTrackedPagePath } from '@services/analytics/rules'

// document.referrer doesn't change on client-side navigation, so only the
// first page view of a page load carries it; later ones would otherwise all
// be credited to whatever site the visitor came from.
let referrerSent = false

function getReferrerDomain(): string {
  if (referrerSent || typeof document === 'undefined' || !document.referrer) return ''
  try {
    return new URL(document.referrer).hostname
  } catch {
    return ''
  }
}

export function usePageView() {
  const pathname = usePathname()
  // trackPageView emits the backend page_view only; PostHog's native $pageview
  // is fired by PostHogPageView, so this never double-counts in PostHog.
  const { trackPageView } = useLHAnalytics()

  useEffect(() => {
    if (!pathname || !isTrackedPagePath(pathname)) return
    // Device and country are derived server-side, and self-referrals dropped.
    trackPageView({ path: pathname, referrer_domain: getReferrerDomain() })
    referrerSent = true
  }, [pathname, trackPageView])
}
