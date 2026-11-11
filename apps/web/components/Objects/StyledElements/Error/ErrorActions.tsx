'use client'
import { getPlatformHomeUri, getPlatformUrl } from '@services/config/config'
import { signOut } from '@components/Contexts/AuthContext'
import { openFeedbackDialog, isReportingAvailable } from '@lib/errors/report'
import type { ResolutionKind } from '@lib/errors/types'
import { ArrowLeft, HomeIcon, LifeBuoy, LogIn, LogOut, MessageSquareWarning, RefreshCcw } from 'lucide-react'
import { useRouter } from 'next/navigation'
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ErrorActionRows, ErrorButton } from './ErrorShell'

export interface ErrorActionsProps {
  /** Ordered resolution actions to render. */
  resolutions: ResolutionKind[]
  /** Next error-boundary reset(), used by "retry" when available. */
  reset?: () => void
  /** Sentry event id to associate a feedback report with. */
  eventId?: string
  /** Where "login" should land back after auth. */
  loginNext?: string
}

// Actions that move the user forward get real buttons; the rest are escape
// hatches and sit in the quiet row.
const QUIET: ResolutionKind[] = ['signout', 'report', 'contact_support']

/**
 * The recovery actions shown under an error. Each `ResolutionKind` maps to a
 * concrete button. Lives inside the app providers (router + AuthContext), so it
 * can sign the user out and navigate. The standalone `app/global-error`
 * boundary (which renders outside providers) builds its own from ErrorShell.
 */
export default function ErrorActions({ resolutions, reset, eventId, loginNext }: ErrorActionsProps) {
  const { t } = useTranslation()
  const router = useRouter()
  const [signingOut, setSigningOut] = useState(false)
  // The org-less home URL depends on window.location, so resolving it during
  // render made the server and client hrefs disagree (hydration mismatch).
  const [homeHref, setHomeHref] = useState('/home')
  useEffect(() => setHomeHref(getPlatformHomeUri()), [])

  // Dedupe while preserving order.
  const kinds = Array.from(new Set(resolutions))
  // 'wait' has no button; drop it here so the first real action gets the
  // primary style.
  const mainKinds = kinds.filter((k) => !QUIET.includes(k) && k !== 'wait')
  const quietKinds = kinds.filter((k) => QUIET.includes(k))

  const retry = () => {
    if (reset) {
      reset()
    } else {
      router.refresh()
      window.location.reload()
    }
  }

  const doSignOut = async () => {
    setSigningOut(true)
    try {
      await signOut({ callbackUrl: '/login', redirect: true })
    } catch {
      window.location.href = '/login'
    }
  }

  const loginHref = loginNext ? `/login?next=${encodeURIComponent(loginNext)}` : '/login'
  const supportHref = getPlatformUrl('/contact') || 'mailto:support@learnhouse.io'

  const renderMain = (kind: ResolutionKind, index: number) => {
    const variant = index === 0 ? 'primary' : 'secondary'
    switch (kind) {
      case 'retry':
        return <ErrorButton key={kind} onClick={retry} variant={variant} label={t('common.retry')} icon={<RefreshCcw size={15} />} />
      case 'reload':
        return (
          <ErrorButton key={kind} onClick={() => window.location.reload()} variant={variant} label={t('errors.actions.reload')}
            icon={<RefreshCcw size={15} />} />
        )
      case 'login':
        return <ErrorButton key={kind} href={loginHref} variant={variant} label={t('errors.actions.log_back_in')} icon={<LogIn size={15} />} />
      case 'home':
        return (
          <ErrorButton key={kind} href={homeHref} variant={variant} label={t('common.home')}
            icon={<HomeIcon size={15} />} />
        )
      default:
        return null
    }
  }

  const renderQuiet = (kind: ResolutionKind) => {
    switch (kind) {
      case 'signout':
        return (
          <ErrorButton key={kind} onClick={doSignOut} disabled={signingOut} variant="subtle"
            label={signingOut ? t('errors.actions.signing_out') : t('common.sign_out')} icon={<LogOut size={14} />} />
        )
      case 'report':
        if (!isReportingAvailable()) return null
        return (
          <ErrorButton key={kind} onClick={() => openFeedbackDialog({ eventId })} variant="subtle"
            label={t('errors.actions.report')} icon={<MessageSquareWarning size={14} />} />
        )
      case 'contact_support':
        return <ErrorButton key={kind} href={supportHref} variant="subtle" label={t('errors.actions.contact_support')} icon={<LifeBuoy size={14} />} />
      default:
        return null
    }
  }

  const main = mainKinds.map(renderMain).filter(Boolean)
  // A category with only escape hatches (or only "wait") still needs a way
  // out of the dead end.
  if (main.length === 0) {
    main.push(
      <ErrorButton key="back" onClick={() => window.history.back()} variant="secondary" label={t('common.back')}
        icon={<ArrowLeft size={15} className="rtl:rotate-180" />} />
    )
  }

  return <ErrorActionRows main={main} quiet={quietKinds.map(renderQuiet)} />
}
