// Loaded on demand (see components/Contexts/PostHogProvider.tsx): this is the
// only module that imports posthog-js, so the SDK stays out of every page's
// first download. Same init options as before.
import posthog from 'posthog-js'
import type { CaptureResult, PostHog } from 'posthog-js'
import { scrubUrl, scrubUrlProperties } from '@services/utils/ts/scrubUrl'

let initialized = false

// Auth links carry reset codes, magic/verify tokens, OAuth codes etc. in the
// query string; strip them from every URL-valued property before sending.
function scrubCapture(cr: CaptureResult | null): CaptureResult | null {
  if (!cr) return cr
  scrubUrlProperties(cr.properties)
  scrubUrlProperties(cr.$set)
  scrubUrlProperties(cr.$set_once)
  // Session replay meta events record the page href.
  const snapshots = cr.properties?.$snapshot_data
  if (Array.isArray(snapshots)) {
    for (const snap of snapshots) {
      if (snap?.data && typeof snap.data.href === 'string') snap.data.href = scrubUrl(snap.data.href)
    }
  }
  return cr
}

export function initPostHog(key: string): PostHog {
  if (initialized) return posthog
  initialized = true
  posthog.init(key, {
    // Same-origin reverse proxy (see next.config.js rewrites) so adblockers
    // don't strip ingestion. Not '/ingest': filter lists block '/ingest/*ip='.
    // ui_host keeps "open in PostHog" links working.
    api_host: '/lhrel',
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
      maskCapturedNetworkRequestFn: (req) => {
        if (req?.name) req.name = scrubUrl(req.name)
        return req
      },
    },
    before_send: scrubCapture,
  })
  return posthog
}
