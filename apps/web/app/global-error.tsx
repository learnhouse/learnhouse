"use client";

import * as Sentry from "@sentry/nextjs";
import '../styles/globals.css'
import { classifyError } from '@lib/errors/classify'
import { AlertTriangle, ChevronDown, ChevronRight, Home, LogOut, MessageSquareWarning, RefreshCcw } from 'lucide-react'
import { useEffect, useState } from 'react'

// Last-resort boundary: catches errors thrown in the root layout itself, so it
// renders OUTSIDE every provider (no router, no AuthContext, no i18n). Kept
// fully self-contained — it classifies the error for a meaningful message and
// offers reload / home / sign out / report, all via plain DOM + the Sentry SDK.

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [eventId, setEventId] = useState<string | undefined>()
  const [showDetails, setShowDetails] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  const { category, detail, status } = classifyError(error)

  useEffect(() => {
    const msg = error?.message || ''
    if (
      msg.includes('Failed to find Server Action') ||
      msg.includes('older or newer deployment') ||
      error?.name === 'ChunkLoadError' ||
      msg.includes('Loading chunk')
    ) {
      window.location.reload()
      return
    }
    if (Sentry.isInitialized()) {
      setEventId(Sentry.captureException(error))
    }
    console.error(error)
  }, [error])

  const report = () => {
    try {
      if (!Sentry.isInitialized()) return
      const id = eventId || Sentry.lastEventId()
      Sentry.showReportDialog({
        ...(id ? { eventId: id } : {}),
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

  const doSignOut = async () => {
    setSigningOut(true)
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
    } catch {
      // ignore — we redirect to login regardless
    }
    window.location.href = '/login'
  }

  const btn = 'flex items-center gap-2 px-5 py-2 rounded-full font-bold text-sm transition-colors shadow-sm'

  return (
    <html lang="en">
      <body className="flex flex-col items-center justify-center min-h-screen bg-gray-50 p-4">
        <div className="flex flex-col items-center space-y-6 max-w-xl text-center">
          <div className="bg-rose-100 p-4 rounded-2xl">
            <AlertTriangle className="text-rose-700" size={44} />
          </div>
          <div>
            <h2 className="text-2xl md:text-3xl font-bold text-rose-700">{category.title}</h2>
            <span className="text-[11px] uppercase tracking-wide font-semibold text-rose-400">
              {category.kind.replace(/_/g, ' ')}
            </span>
          </div>
          <p className="text-gray-600">{category.description}</p>

          <div className="flex flex-wrap items-center justify-center gap-3">
            <button onClick={() => reset()} className={`${btn} text-white bg-rose-700 hover:bg-rose-800`}>
              <RefreshCcw size={16} />
              <span>Try again</span>
            </button>
            <a href="/home" className={`${btn} text-gray-100 bg-gray-700 hover:bg-gray-800`}>
              <Home size={16} />
              <span>Home</span>
            </a>
            <button onClick={doSignOut} disabled={signingOut} className={`${btn} text-gray-600 bg-gray-100 hover:bg-gray-200 disabled:opacity-50`}>
              <LogOut size={16} />
              <span>{signingOut ? 'Signing out…' : 'Sign out'}</span>
            </button>
            {Sentry.isInitialized() && (
              <button onClick={report} className={`${btn} text-rose-700 bg-rose-100 hover:bg-rose-200`}>
                <MessageSquareWarning size={16} />
                <span>Report this problem</span>
              </button>
            )}
          </div>

          {(detail || status || error?.digest || eventId) && (
            <div className="w-full max-w-lg">
              <button
                onClick={() => setShowDetails((s) => !s)}
                className="flex items-center gap-1 mx-auto text-xs font-semibold text-gray-400 hover:text-gray-600 transition-colors"
              >
                {showDetails ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <span>{showDetails ? 'Hide technical details' : 'Show technical details'}</span>
              </button>
              {showDetails && (
                <div className="mt-3 bg-gray-100 border border-gray-200 rounded-xl p-4 text-left text-xs font-mono text-gray-700 break-all space-y-1.5">
                  {detail && <div><span className="text-gray-400">cause </span>{detail}</div>}
                  {status !== undefined && <div><span className="text-gray-400">status </span>{status}</div>}
                  {error?.digest && <div><span className="text-gray-400">digest </span>{error.digest}</div>}
                  {eventId && <div><span className="text-gray-400">ref </span>{eventId}</div>}
                </div>
              )}
            </div>
          )}
        </div>
      </body>
    </html>
  );
}
