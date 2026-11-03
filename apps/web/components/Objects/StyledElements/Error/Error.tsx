'use client'
import { classifyError } from '@lib/errors/classify'
import type { ResolutionKind } from '@lib/errors/types'
import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import ErrorActions from './ErrorActions'
import ErrorShell, { ErrorDetails } from './ErrorShell'

interface ErrorUIProps {
  /** The actual error; when given we classify it for a meaningful message. */
  error?: unknown
  /** Override the headline (back-compat with old `<ErrorUI message=.. />`). */
  message?: string
  /** Override the sub-line. */
  submessage?: string
  /** Next error-boundary reset(); wired to the Retry action when present. */
  reset?: () => void
  /** Sentry event id, so the "Report this problem" button ties to this event. */
  eventId?: string
  /** Force a specific set of recovery actions (otherwise from classification). */
  resolutions?: ResolutionKind[]
  /** Where "Log back in" should return to. */
  loginNext?: string
  /** Tighter layout for inline (non-full-page) use. */
  compact?: boolean
}

/**
 * The shared error surface. Given a raw `error` it shows a SPECIFIC, reassuring
 * message (from the error catalog) plus the recovery actions that actually help
 * (including a sign-out escape hatch and a Sentry "report this problem" button).
 * Collapsible technical details carry the real cause + ids for support.
 */
function ErrorUI({
  error,
  message,
  submessage,
  reset,
  eventId,
  resolutions,
  loginNext,
  compact,
}: ErrorUIProps) {
  const { t } = useTranslation()

  const classified = useMemo(
    () => (error !== undefined ? classifyError(error) : undefined),
    [error],
  )

  // Headline + body: explicit props win, else the classified category, else a
  // meaningful default (never a bare "Something went wrong").
  const title = message || classified?.category.title || t('errors.default_title')
  const description =
    submessage ||
    classified?.category.description ||
    t('errors.default_description')

  const actions: ResolutionKind[] =
    resolutions ||
    classified?.category.resolutions ||
    (['retry', 'home', 'report'] as ResolutionKind[])

  return (
    <ErrorShell
      kind={classified?.category.kind}
      title={title}
      description={description}
      compact={compact}
      actions={<ErrorActions resolutions={actions} reset={reset} eventId={eventId} loginNext={loginNext} />}
      details={
        <ErrorDetails
          rows={[
            ['cause', classified?.detail],
            ['status', classified?.status],
            ['digest', classified?.digest],
            ['ref', eventId],
          ]}
        />
      }
    />
  )
}

export default ErrorUI
