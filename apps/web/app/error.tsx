'use client'

import ErrorUI from '@components/Objects/StyledElements/Error/Error'
import * as Sentry from '@sentry/nextjs'
import { useEffect } from 'react'
import { useTrackView, AnalyticsEvent } from '@services/analytics'

export default function Error({
  error,
  reset: _reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useTrackView(
    AnalyticsEvent.ErrorViewShown,
    {
      error_digest: error.digest,
      path: typeof window !== 'undefined' ? window.location.pathname : undefined,
    },
    true,
    'public',
  )

  useEffect(() => {
    if (Sentry.isInitialized()) {
      Sentry.captureException(error)
    }
    console.error(error)

    if (
      error.message.includes('Failed to find Server Action') ||
      error.message.includes('older or newer deployment')
    ) {
      window.location.reload()
    }
  }, [error])

  return <ErrorUI />
}
