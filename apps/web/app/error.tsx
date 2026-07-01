'use client'

import BoundaryError from '@components/Objects/StyledElements/Error/BoundaryError'
import { useTrackView, AnalyticsEvent } from '@services/analytics'

export default function Error({
  error,
  reset,
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

  // BoundaryError captures to Sentry (keeping the event id for the report
  // button), auto-reloads on stale-deploy errors, and renders the meaningful
  // ErrorUI with recovery actions (retry / home / sign out / report).
  return <BoundaryError error={error} reset={reset} />
}
