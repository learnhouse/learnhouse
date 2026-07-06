'use client'
import { captureError } from '@lib/errors/report'
import { useEffect, useState } from 'react'
import ErrorUI from './Error'

/**
 * Shared body for Next.js `error.tsx` route boundaries that live INSIDE the app
 * providers. Captures the error to Sentry (keeping the event id so the user can
 * file a report tied to it), auto-reloads on stale-deploy/version-mismatch
 * errors, then renders the meaningful ErrorUI with recovery actions.
 *
 * `app/global-error.tsx` can't use this (it renders outside all providers) and
 * inlines its own self-contained version instead.
 */
export default function BoundaryError({
  error,
  reset,
  loginNext,
}: {
  error: Error & { digest?: string }
  reset?: () => void
  loginNext?: string
}) {
  const [eventId, setEventId] = useState<string | undefined>()

  useEffect(() => {
    const msg = error?.message || ''
    // A new deployment invalidated this page's chunks/server actions — the only
    // real fix is to reload into the fresh version.
    if (
      msg.includes('Failed to find Server Action') ||
      msg.includes('older or newer deployment') ||
      error?.name === 'ChunkLoadError' ||
      msg.includes('Loading chunk')
    ) {
      window.location.reload()
      return
    }
    setEventId(captureError(error))
    console.error(error)
  }, [error])

  return <ErrorUI error={error} reset={reset} eventId={eventId} loginNext={loginNext} />
}
