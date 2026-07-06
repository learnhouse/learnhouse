'use client' // Error components must be Client Components

import BoundaryError from '@components/Objects/StyledElements/Error/BoundaryError'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  // Capture to Sentry, auto-reload on stale-deploy, and render the meaningful
  // ErrorUI with recovery actions (retry / home / sign out / report feedback).
  return <BoundaryError error={error} reset={reset} />
}
