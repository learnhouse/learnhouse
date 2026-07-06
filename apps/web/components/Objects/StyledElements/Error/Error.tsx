'use client'
import { classifyError } from '@lib/errors/classify'
import type { ResolutionKind } from '@lib/errors/types'
import { AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react'
import React, { useMemo, useState } from 'react'
import ErrorActions from './ErrorActions'

interface ErrorUIProps {
  /** The actual error — when given we classify it for a meaningful message. */
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
 * — including a sign-out escape hatch and a Sentry "report this problem" button.
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
  const [showDetails, setShowDetails] = useState(false)

  const classified = useMemo(
    () => (error !== undefined ? classifyError(error) : undefined),
    [error],
  )

  // Headline + body: explicit props win, else the classified category, else a
  // meaningful default (never a bare "Something went wrong").
  const title = message || classified?.category.title || 'Something unexpected happened'
  const description =
    submessage ||
    classified?.category.description ||
    "We ran into an error. It's been logged automatically — retrying or heading home usually helps."

  const actions: ResolutionKind[] =
    resolutions ||
    classified?.category.resolutions ||
    (['retry', 'home', 'report'] as ResolutionKind[])

  // The raw cause we can safely show under "details".
  const detail = classified?.detail
  const status = classified?.status
  const digest = classified?.digest
  const hasDetails = Boolean(detail || status || digest || eventId)

  return (
    <div
      className={`flex flex-col items-center text-center mx-auto antialiased ${
        compact ? 'py-6 px-4 space-y-4 max-w-lg' : 'py-12 px-6 space-y-6 max-w-xl'
      }`}
    >
      <div className="flex items-center gap-4">
        <div className="bg-rose-100 p-3 rounded-2xl shrink-0">
          <AlertTriangle className="text-rose-700" size={compact ? 28 : 38} />
        </div>
        <div className="flex flex-col text-left">
          <p className={`font-bold text-rose-700 ${compact ? 'text-xl' : 'text-2xl md:text-3xl'}`}>
            {title}
          </p>
          {classified?.category.kind && (
            <span className="text-[11px] uppercase tracking-wide font-semibold text-rose-400">
              {classified.category.kind.replace(/_/g, ' ')}
            </span>
          )}
        </div>
      </div>

      <p className={`text-gray-600 ${compact ? 'text-sm' : 'text-base'} max-w-prose`}>
        {description}
      </p>

      <ErrorActions resolutions={actions} reset={reset} eventId={eventId} loginNext={loginNext} />

      {hasDetails && (
        <div className="w-full max-w-lg">
          <button
            onClick={() => setShowDetails((s) => !s)}
            className="flex items-center gap-1 mx-auto text-xs font-semibold text-gray-400 hover:text-gray-600 transition-colors"
          >
            {showDetails ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <span>{showDetails ? 'Hide technical details' : 'Show technical details'}</span>
          </button>
          {showDetails && (
            <div className="mt-3 bg-gray-50 border border-gray-200 rounded-xl p-4 text-left">
              <dl className="space-y-1.5 text-xs font-mono text-gray-600 break-words">
                {detail && (
                  <div className="flex gap-2">
                    <dt className="text-gray-400 shrink-0">cause</dt>
                    <dd className="break-all">{detail}</dd>
                  </div>
                )}
                {status !== undefined && (
                  <div className="flex gap-2">
                    <dt className="text-gray-400 shrink-0">status</dt>
                    <dd>{status}</dd>
                  </div>
                )}
                {digest && (
                  <div className="flex gap-2">
                    <dt className="text-gray-400 shrink-0">digest</dt>
                    <dd className="break-all">{digest}</dd>
                  </div>
                )}
                {eventId && (
                  <div className="flex gap-2">
                    <dt className="text-gray-400 shrink-0">ref</dt>
                    <dd className="break-all">{eventId}</dd>
                  </div>
                )}
              </dl>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default ErrorUI
