'use client'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { Info, Warning, WarningOctagon, X } from '@phosphor-icons/react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useEEStatus } from '@components/Hooks/useEEStatus'
import useAdminStatus from '@components/Hooks/useAdminStatus'
import { getInstanceLicense } from '@services/instance/license'
import { queryKeys } from '@/lib/query/keys'
import { intlLocale } from '@/lib/format'
import { licenseBannerItems, licenseBannerText, type LicenseBannerTone } from '@/lib/license/banner'

const DISMISSED_KEY = 'lh:license-notices-dismissed'

const TONE: Record<LicenseBannerTone, { bar: string; icon: React.ReactNode }> = {
  neutral: {
    bar: 'border-neutral-200 bg-neutral-100 text-neutral-700',
    icon: <Info size={16} weight="fill" className="shrink-0 text-neutral-500" />,
  },
  warning: {
    bar: 'border-amber-200 bg-amber-50 text-amber-900',
    icon: <Warning size={16} weight="fill" className="shrink-0 text-amber-600" />,
  },
  critical: {
    bar: 'border-rose-200 bg-rose-50 text-rose-900',
    icon: <WarningOctagon size={16} weight="fill" className="shrink-0 text-rose-600" />,
  },
}

function readDismissed(): string[] {
  try {
    const raw = window.sessionStorage.getItem(DISMISSED_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/**
 * Slim bars at the top of the dashboard for a self-hosted Enterprise license
 * that needs attention: POC or license ending, payment overdue, limits, the
 * offline grace window, Enterprise features switched off. Admins only (the
 * API gives everyone else a reduced status without notices). Informational
 * notices can be hidden for the session; warnings and critical ones stay.
 */
export default function LicenseBanner() {
  const { t, i18n } = useTranslation()
  const { isEE } = useEEStatus()
  const { isAdmin } = useAdminStatus() as { isAdmin: boolean | null }
  const session = useLHSession() as any
  const token: string | undefined = session?.data?.tokens?.access_token
  const [dismissed, setDismissed] = useState<string[]>(() => (typeof window === 'undefined' ? [] : readDismissed()))

  const { data } = useQuery({
    queryKey: queryKeys.instance.license(),
    queryFn: () => getInstanceLicense(token as string),
    enabled: isEE && isAdmin === true && !!token,
    staleTime: 5 * 60_000,
    retry: false,
  })

  const items = licenseBannerItems(data).filter((item) => !item.dismissible || !dismissed.includes(item.id))
  if (!isEE || items.length === 0) return null

  const dismiss = (id: string) => {
    const next = [...dismissed, id]
    setDismissed(next)
    try {
      window.sessionStorage.setItem(DISMISSED_KEY, JSON.stringify(next))
    } catch {
      // Storage blocked: hidden until the next page load.
    }
  }

  const locale = intlLocale(i18n.language)
  return (
    <div role="region" aria-label={t('license.banner.label')} data-testid="license-banner">
      {items.map((item) => {
        const tone = TONE[item.tone]
        return (
          <div
            key={item.id}
            role={item.tone === 'neutral' ? 'status' : 'alert'}
            className={`flex items-center gap-2.5 border-b px-4 py-2 text-[13px] leading-snug sm:px-10 ${tone.bar}`}
          >
            {tone.icon}
            <span className="min-w-0 flex-1">{licenseBannerText(item, t, locale)}</span>
            {item.dismissible && (
              <button
                type="button"
                onClick={() => dismiss(item.id)}
                aria-label={t('license.banner.dismiss')}
                title={t('license.banner.dismiss')}
                className="-me-1.5 shrink-0 rounded-lg p-1 text-neutral-500 transition-colors hover:bg-neutral-200/70 hover:text-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/20"
              >
                <X size={14} weight="bold" />
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
