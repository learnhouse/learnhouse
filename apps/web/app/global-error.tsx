"use client";

import * as Sentry from "@sentry/nextjs";
import '../styles/globals.css'
import { classifyError } from '@lib/errors/classify'
import { detectClientLanguage, directionForLanguage, type Direction } from '@lib/direction'
import ErrorShell, { ErrorActionRows, ErrorButton, ErrorDetails } from '@components/Objects/StyledElements/Error/ErrorShell'
import { Home, LogOut, MessageSquareWarning, RefreshCcw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { getPlatformHomeUri } from '@services/config/config'

// Last-resort boundary: catches errors thrown in the root layout itself, so it
// renders OUTSIDE every provider (no router, no AuthContext, no i18n). Kept
// self-contained: it classifies the error for a meaningful message and offers
// reload / home / sign out / report, all via plain DOM + the Sentry SDK. The
// look comes from ErrorShell, which needs no providers.

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [eventId, setEventId] = useState<string | undefined>()
  const [signingOut, setSigningOut] = useState(false)

  // dir-init.js can't help here: this boundary renders its own <html>, so the
  // attribute has to come from React. Detect once, on the client. A
  // server-rendered error page is LTR for one frame, acceptable on an error
  // screen, and not worth a second blocking script.
  const [dir] = useState<Direction>(() =>
    typeof window === 'undefined' ? 'ltr' : directionForLanguage(detectClientLanguage())
  )

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
      // ignore; we redirect to login regardless
    }
    window.location.href = '/login'
  }

  const reportable = Sentry.isInitialized()

  return (
    <html lang="en" dir={dir} suppressHydrationWarning>
      <body className="min-h-screen bg-[#f8f8f8] flex items-center justify-center">
        <ErrorShell
          kind={category.kind}
          title={category.title}
          description={category.description}
          actions={
            <ErrorActionRows
              main={[
                <ErrorButton key="retry" onClick={() => reset()} variant="primary" label="Try again"
                  icon={<RefreshCcw size={15} />} />,
                // On an org host /home is that org's own page, which may be what failed.
                <ErrorButton key="home" onClick={() => window.location.assign(getPlatformHomeUri())} label="Go home" icon={<Home size={15} />} />,
              ]}
              quiet={[
                <ErrorButton key="signout" onClick={doSignOut} disabled={signingOut} variant="subtle"
                  label={signingOut ? 'Signing out…' : 'Sign out'} icon={<LogOut size={14} />} />,
                reportable && (
                  <ErrorButton key="report" onClick={report} variant="subtle" label="Report this problem"
                    icon={<MessageSquareWarning size={14} />} />
                ),
              ]}
            />
          }
          details={
            <ErrorDetails
              rows={[
                ['cause', detail],
                ['status', status],
                ['digest', error?.digest],
                ['ref', eventId],
              ]}
            />
          }
        />
      </body>
    </html>
  );
}
