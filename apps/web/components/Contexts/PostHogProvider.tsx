'use client'
import React, { Suspense, useEffect, useRef } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import posthog from 'posthog-js'
import { PostHogProvider as PHProvider, usePostHog } from 'posthog-js/react'
import { getPOSTHOG_KEY_VAL } from '@services/config/config'
import { useLHSession } from '@components/Contexts/LHSessionContext'

let initialized = false

function initPostHog(key: string) {
  if (initialized || typeof window === 'undefined') return
  initialized = true
  posthog.init(key, {
    // Same-origin reverse proxy (see next.config.js rewrites) so adblockers
    // don't strip ingestion. ui_host keeps "open in PostHog" links working.
    api_host: '/ingest',
    ui_host: 'https://eu.posthog.com',
    persistence: 'localStorage+cookie',
    autocapture: true,
    capture_pageview: false, // fired manually by PostHogPageView (App Router)
    capture_pageleave: true,
    // Session replay ON but privacy-safe: mask every input and all text so no
    // typed PII (and no on-screen content) leaks into recordings.
    disable_session_recording: false,
    session_recording: {
      maskAllInputs: true,
      maskTextSelector: '*',
    },
  })
}

/** Fires PostHog's native $pageview on every App Router navigation. */
function PostHogPageView() {
  const posthogClient = usePostHog()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  useEffect(() => {
    if (!posthogClient || !pathname) return
    let url = window.origin + pathname
    const qs = searchParams?.toString()
    if (qs) url += `?${qs}`
    posthogClient.capture('$pageview', { $current_url: url })
  }, [posthogClient, pathname, searchParams])

  return null
}

/**
 * Identifies the user across ALL auth paths and resets on logout/expiry.
 * Watches the central session (AuthContext) so credentials, Google, SSO,
 * token-exchange, cross-tab logout and 401 expiry are all covered from one place.
 */
function PostHogIdentify() {
  const posthogClient = usePostHog()
  const session = useLHSession() as any
  const status = session?.status
  const user = session?.data?.user
  const identifiedRef = useRef<string | null>(null)

  useEffect(() => {
    if (!posthogClient) return

    if (status === 'authenticated' && user?.user_uuid) {
      if (identifiedRef.current !== user.user_uuid) {
        identifiedRef.current = user.user_uuid
        posthogClient.identify(String(user.user_uuid), {
          email: user.email,
          username: user.username,
        })
      }
      return
    }

    if (status === 'unauthenticated' && identifiedRef.current) {
      identifiedRef.current = null
      posthogClient.reset()
    }
  }, [posthogClient, status, user?.user_uuid, user?.email, user?.username])

  return null
}

/**
 * Mounts PostHog when NEXT_PUBLIC_POSTHOG_KEY is set; otherwise renders children
 * untouched and never loads PostHog (true off-switch / opt-in).
 */
export default function PostHogProvider({ children }: { children: React.ReactNode }) {
  const key = getPOSTHOG_KEY_VAL()

  useEffect(() => {
    if (key) initPostHog(key)
  }, [key])

  if (!key) return <>{children}</>

  return (
    <PHProvider client={posthog}>
      <Suspense fallback={null}>
        <PostHogPageView />
      </Suspense>
      <PostHogIdentify />
      {children}
    </PHProvider>
  )
}
