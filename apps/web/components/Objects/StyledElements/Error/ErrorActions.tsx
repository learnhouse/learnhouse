'use client'
import { getPlatformUrl, getUriWithoutOrg } from '@services/config/config'
import { signOut } from '@components/Contexts/AuthContext'
import { openFeedbackDialog, isReportingAvailable } from '@lib/errors/report'
import type { ResolutionKind } from '@lib/errors/types'
import {
  HomeIcon,
  LifeBuoy,
  LogIn,
  LogOut,
  MessageSquareWarning,
  RefreshCcw,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import React, { useState } from 'react'

type Variant = 'primary' | 'neutral' | 'danger' | 'ghost'

const VARIANT_CLASSES: Record<Variant, string> = {
  primary: 'text-white bg-rose-700 hover:bg-rose-800',
  neutral: 'text-gray-100 bg-gray-700 hover:bg-gray-800',
  danger: 'text-rose-700 bg-rose-100 hover:bg-rose-200',
  ghost: 'text-gray-600 bg-gray-100 hover:bg-gray-200',
}

function ActionButton({
  onClick,
  href,
  icon,
  label,
  variant = 'neutral',
  disabled,
}: {
  onClick?: () => void
  href?: string
  icon: React.ReactNode
  label: string
  variant?: Variant
  disabled?: boolean
}) {
  const cls = `flex space-x-2 items-center rounded-full px-4 py-1.5 transition-all ease-linear shadow-sm disabled:opacity-50 ${VARIANT_CLASSES[variant]}`
  if (href) {
    return (
      <a href={href} className={cls}>
        {icon}
        <span className="text-sm font-bold">{label}</span>
      </a>
    )
  }
  return (
    <button onClick={onClick} disabled={disabled} className={cls}>
      {icon}
      <span className="text-sm font-bold">{label}</span>
    </button>
  )
}

export interface ErrorActionsProps {
  /** Ordered resolution actions to render. */
  resolutions: ResolutionKind[]
  /** Next error-boundary reset() — used by "retry" when available. */
  reset?: () => void
  /** Sentry event id to associate a feedback report with. */
  eventId?: string
  /** Where "login" should land back after auth. */
  loginNext?: string
}

/**
 * The row of recovery actions shown under an error. Each `ResolutionKind` maps
 * to a concrete button. Lives inside the app providers (router + AuthContext),
 * so it can sign the user out and navigate. The standalone `app/global-error`
 * boundary (which renders outside providers) has its own inlined buttons.
 */
export default function ErrorActions({ resolutions, reset, eventId, loginNext }: ErrorActionsProps) {
  const router = useRouter()
  const [signingOut, setSigningOut] = useState(false)

  // Dedupe while preserving order.
  const kinds = Array.from(new Set(resolutions))

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

  const loginHref = loginNext
    ? `/login?next=${encodeURIComponent(loginNext)}`
    : '/login'
  const supportHref = getPlatformUrl('/contact') || 'mailto:support@learnhouse.io'

  return (
    <div className="flex flex-wrap justify-center gap-3">
      {kinds.map((kind) => {
        switch (kind) {
          case 'retry':
            return (
              <ActionButton key={kind} onClick={retry} variant="primary" label="Retry"
                icon={<RefreshCcw size={16} />} />
            )
          case 'reload':
            return (
              <ActionButton key={kind} onClick={() => window.location.reload()} variant="primary" label="Reload"
                icon={<RefreshCcw size={16} />} />
            )
          case 'login':
            return (
              <ActionButton key={kind} href={loginHref} variant="primary" label="Log back in"
                icon={<LogIn size={16} />} />
            )
          case 'home':
            return (
              <ActionButton key={kind} href={getUriWithoutOrg('/home')} variant="neutral" label="Home"
                icon={<HomeIcon size={16} />} />
            )
          case 'signout':
            return (
              <ActionButton key={kind} onClick={doSignOut} disabled={signingOut} variant="ghost"
                label={signingOut ? 'Signing out…' : 'Sign out'} icon={<LogOut size={16} />} />
            )
          case 'report':
            if (!isReportingAvailable()) return null
            return (
              <ActionButton key={kind} onClick={() => openFeedbackDialog({ eventId })} variant="danger"
                label="Report this problem" icon={<MessageSquareWarning size={16} />} />
            )
          case 'contact_support':
            return (
              <ActionButton key={kind} href={supportHref} variant="ghost" label="Contact support"
                icon={<LifeBuoy size={16} />} />
            )
          case 'wait':
          default:
            return null
        }
      })}
    </div>
  )
}
