'use client' // Error components must be Client Components

import BoundaryError from '@components/Objects/StyledElements/Error/BoundaryError'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  // Previously rendered an empty <div> — a silent blank page. Now shows the
  // meaningful ErrorUI with recovery actions and captures to Sentry.
  return <BoundaryError error={error} reset={reset} />
}
