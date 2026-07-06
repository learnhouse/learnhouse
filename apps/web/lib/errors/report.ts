'use client'
import * as Sentry from '@sentry/nextjs'

// Thin wrappers around the Sentry SDK so error UIs can (a) capture an exception
// and get back the event id, and (b) open Sentry's built-in user-feedback
// dialog tied to that exact event. Everything no-ops gracefully when Sentry
// isn't initialized (no DSN, e.g. local dev) so the UI never throws.

/**
 * Capture an error to Sentry and return its event id (used to tie a feedback
 * report to the exact event). Falls back to console + `lastEventId()`.
 */
export function captureError(error: unknown, context?: Record<string, unknown>): string | undefined {
  try {
    if (!Sentry.isInitialized()) {
      console.error(error)
      return undefined
    }
    return Sentry.captureException(error, context ? { extra: context } : undefined)
  } catch (e) {
    console.error('Sentry capture failed:', e)
    return undefined
  }
}

/** Is Sentry wired up (DSN present)? Used to show/hide the "Report" button. */
export function isReportingAvailable(): boolean {
  try {
    return Sentry.isInitialized()
  } catch {
    return false
  }
}

/**
 * Open Sentry's crash-report / user-feedback dialog. When an `eventId` is given
 * (or a recent one exists via `lastEventId()`) the report is associated with
 * that event so we get the user's words next to the stack trace.
 */
export function openFeedbackDialog(opts?: { eventId?: string; user?: { name?: string; email?: string } }): void {
  try {
    if (!Sentry.isInitialized()) {
      console.warn('Feedback unavailable: Sentry not initialized')
      return
    }
    const eventId = opts?.eventId || Sentry.lastEventId()
    Sentry.showReportDialog({
      ...(eventId ? { eventId } : {}),
      ...(opts?.user ? { user: opts.user } : {}),
      title: 'Tell us what happened',
      subtitle: 'Your report goes straight to our team so we can fix it.',
      subtitle2: '',
      labelComments: 'What were you doing when this happened?',
      labelSubmit: 'Send report',
    })
  } catch (e) {
    console.error('Failed to open feedback dialog:', e)
  }
}
