'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'

// PostHog is loaded only after the page is idle, so analytics never delays
// the first paint or adds to the JavaScript every page ships with.
const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY
let client = null

function loadPostHog() {
  if (!client) {
    client = import('posthog-js').then(({ default: posthog }) => {
      posthog.init(KEY, {
        api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com',
        capture_pageview: false,
        capture_pageleave: true,
      })
      return posthog
    })
  }
  return client
}

/**
 * Records a product event. Loads PostHog if it isn't yet, and sends with a
 * beacon so the event survives the click that navigates away.
 */
export function track(event, properties) {
  if (!KEY || typeof window === 'undefined') return
  loadPostHog()
    .then((posthog) => posthog.capture(event, properties, { transport: 'sendBeacon' }))
    .catch(() => {})
}

function whenIdle(fn) {
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(fn, { timeout: 4000 })
    return () => window.cancelIdleCallback(id)
  }
  const id = window.setTimeout(fn, 1500)
  return () => window.clearTimeout(id)
}

export default function PostHogProvider({ children }) {
  const pathname = usePathname()

  useEffect(() => {
    if (!KEY) return
    return whenIdle(() => {
      loadPostHog().then((posthog) => posthog.capture('$pageview', { $current_url: window.location.href }))
    })
  }, [pathname])

  return children
}
