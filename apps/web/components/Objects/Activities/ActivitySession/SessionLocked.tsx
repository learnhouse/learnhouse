'use client'

// What a viewer sees instead of the activity when they can't take it: one
// colored tile, a sentence-case title, one line on why, and the way through
// (the course page, where they can enrol, buy or ask for access). Links open
// in a new tab so the host (a board) stays where it was.

import React from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowSquareOut, Clock, EyeSlash, LockSimple, SignIn, WarningCircle } from '@phosphor-icons/react'
import { Button, buttonClass } from '@components/Dashboard/Shared/DashKit/DashKit'
import { getUriWithOrg } from '@services/config/config'
import { formatDate } from '@/lib/format'
import type { SessionAccess } from './useActivitySession'

const LOOK: Record<Exclude<SessionAccess, 'ok' | 'loading'>, { icon: typeof LockSimple; tile: string }> = {
  forbidden: { icon: LockSimple, tile: 'bg-rose-50 text-rose-600' },
  paid: { icon: LockSimple, tile: 'bg-amber-50 text-amber-600' },
  restricted: { icon: LockSimple, tile: 'bg-rose-50 text-rose-600' },
  drip: { icon: Clock, tile: 'bg-sky-50 text-sky-600' },
  draft: { icon: EyeSlash, tile: 'bg-neutral-100 text-neutral-500' },
  missing: { icon: WarningCircle, tile: 'bg-neutral-100 text-neutral-500' },
  signin: { icon: SignIn, tile: 'bg-sky-50 text-sky-600' },
  error: { icon: WarningCircle, tile: 'bg-rose-50 text-rose-600' },
}

export default function SessionLocked({
  access,
  orgslug,
  courseHref,
  unlockAt,
  onRetry,
  compact = false,
  extra,
}: {
  access: Exclude<SessionAccess, 'ok' | 'loading'>
  orgslug: string
  courseHref: string
  /** Drip release date, when known. */
  unlockAt?: string | null
  onRetry?: () => void
  /** Small card on a canvas: tighter spacing, one line of text. */
  compact?: boolean
  /** Extra action after the main one (e.g. "Change activity" for editors). */
  extra?: React.ReactNode
}) {
  const { t, i18n } = useTranslation()
  const { icon: Icon, tile } = LOOK[access]
  const k = `activity_session.locked.${access}`
  const description =
    access === 'drip' && unlockAt
      ? t('activity_session.locked.drip_on', { date: formatDate(unlockAt, i18n.language) })
      : t(`${k}_description`)

  const link = (href: string, label: string, primary: boolean) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={buttonClass(primary ? 'primary' : 'secondary', compact ? 'sm' : 'md')}
      onClick={(e) => e.stopPropagation()}
    >
      {label}
      <ArrowSquareOut size={compact ? 12 : 13} className="rtl:-scale-x-100" />
    </a>
  )

  let action: React.ReactNode = null
  if (access === 'signin') {
    const back = typeof window !== 'undefined' ? window.location.pathname : '/'
    action = (
      <a href={getUriWithOrg(orgslug, `/login?redirect=${encodeURIComponent(back)}`)} className={buttonClass('primary', compact ? 'sm' : 'md')}>
        {t('activity_session.locked.sign_in')}
      </a>
    )
  } else if (access === 'error') {
    action = onRetry ? (
      <Button size={compact ? 'sm' : 'md'} onClick={onRetry}>
        {t('activity_session.locked.retry')}
      </Button>
    ) : null
  } else if (access === 'forbidden') {
    action = link(courseHref, t('activity_session.locked.request_access'), true)
  } else if (access === 'paid') {
    action = link(courseHref, t('activity_session.locked.see_offer'), true)
  } else if (access !== 'missing') {
    action = link(courseHref, t('activity_session.locked.open_course'), false)
  }

  return (
    <div
      role="status"
      className={`flex flex-col items-center justify-center text-center ${compact ? 'gap-2 px-4 py-3' : 'gap-3 px-6 py-10'}`}
      data-session-locked={access}
    >
      <span className={`flex shrink-0 items-center justify-center ${compact ? 'h-9 w-9 rounded-lg' : 'h-11 w-11 rounded-xl'} ${tile}`}>
        <Icon size={compact ? 18 : 22} weight="duotone" />
      </span>
      <div className="space-y-1">
        <p className={`${compact ? 'text-[13px]' : 'text-[15px]'} font-semibold text-neutral-900`}>{t(`${k}_title`)}</p>
        <p className={`mx-auto max-w-[320px] ${compact ? 'text-xs' : 'text-[13px]'} leading-snug text-neutral-500`}>{description}</p>
      </div>
      {(action || extra) && (
        <div className="flex flex-wrap items-center justify-center gap-2" data-interactive>
          {action}
          {extra}
        </div>
      )}
    </div>
  )
}
