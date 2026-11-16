'use client'
import React from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { ChartBar, LockSimple } from '@phosphor-icons/react'
import { buttonClass } from '@components/Dashboard/Shared/DashKit/buttons'
import UserDossierPanel from '@ee/components/Analytics/Users/UserDossierPanel'
import { getUpgradeUrl } from '@services/config/config'
import { P } from '../panelUi'

/**
 * The per-student analytics, merged into the panel. Gated like the rest of
 * per-student audit: Enterprise Edition (or SaaS) and the Pro plan.
 */
export default function AnalyticsTab({ userId, available, editionOnly }: { userId: number; available: boolean; editionOnly: boolean }) {
  const { t } = useTranslation()
  const params = useParams() as any
  if (available) return <UserDossierPanel userId={userId} />

  const upgradeUrl = editionOnly ? null : getUpgradeUrl(params?.orgslug)
  return (
    <div className="bg-white rounded-2xl nice-shadow px-6 py-10 flex flex-col items-center text-center gap-3">
      <span className="relative w-12 h-12 rounded-2xl bg-sky-50 text-sky-600 flex items-center justify-center">
        <ChartBar size={22} weight="duotone" />
        <span className="absolute -bottom-1 -end-1 w-5 h-5 rounded-full bg-white nice-shadow flex items-center justify-center text-neutral-500">
          <LockSimple size={11} weight="bold" />
        </span>
      </span>
      <div>
        <p className="text-base font-semibold text-neutral-900">{t(`${P}.analytics.locked_title`)}</p>
        <p className="mt-1 text-sm text-neutral-500 max-w-sm">
          {editionOnly ? t(`${P}.analytics.locked_edition`) : t(`${P}.analytics.locked_plan`)}
        </p>
      </div>
      <ul className="text-xs text-neutral-500 flex flex-wrap justify-center gap-x-4 gap-y-1">
        <li>{t(`${P}.analytics.feature_time`)}</li>
        <li>{t(`${P}.analytics.feature_connections`)}</li>
        <li>{t(`${P}.analytics.feature_answers`)}</li>
        <li>{t(`${P}.analytics.feature_export`)}</li>
      </ul>
      {upgradeUrl && (
        <Link href={upgradeUrl} className={buttonClass('primary', 'md')}>
          {t(`${P}.analytics.upgrade`)}
        </Link>
      )}
    </div>
  )
}
