'use client'
import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { useLHAnalytics } from '@services/analytics'

function getDeviceType(): string {
  if (typeof window === 'undefined') return 'unknown'
  const ua = navigator.userAgent
  if (/Mobi|Android/i.test(ua)) return 'mobile'
  if (/Tablet|iPad/i.test(ua)) return 'tablet'
  return 'desktop'
}

function getReferrerDomain(): string {
  if (typeof document === 'undefined' || !document.referrer) return ''
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
    if (!pathname) return
    trackPageView({
      path: pathname,
      referrer: typeof document !== 'undefined' ? document.referrer : '',
      referrer_domain: getReferrerDomain(),
      device_type: getDeviceType(),
      screen_width: typeof window !== 'undefined' ? window.innerWidth : 0,
    })
  }, [pathname, trackPageView])
}
