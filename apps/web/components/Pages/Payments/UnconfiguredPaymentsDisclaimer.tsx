'use client'
import { CreditCard, Gear, ShoppingBag, Users } from '@phosphor-icons/react'
import React from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { useOrg } from '@components/Contexts/OrgContext'
import { buttonClass } from '@components/Dashboard/Shared/DashKit/DashKit'
import { getUriWithOrg } from '@services/config/config'

const STEPS = [
  {
    icon: CreditCard,
    titleKey: 'payments.unconfigured.step_connect_title',
    descriptionKey: 'payments.unconfigured.step_connect_desc',
  },
  {
    icon: ShoppingBag,
    titleKey: 'payments.unconfigured.step_offers_title',
    descriptionKey: 'payments.unconfigured.step_offers_desc',
  },
  {
    icon: Users,
    titleKey: 'payments.unconfigured.step_sell_title',
    descriptionKey: 'payments.unconfigured.step_sell_desc',
  },
]

function UnconfiguredPaymentsDisclaimer() {
  const { t } = useTranslation()
  const org = useOrg() as any
  const settingsHref = org?.slug ? getUriWithOrg(org.slug, '/dash/payments/settings') : './settings'
  return (
    <div className="bg-white rounded-2xl nice-shadow">
      <div className="flex flex-col items-center py-12 px-6 text-center">
        <div className="flex items-center justify-center w-12 h-12 rounded-2xl bg-neutral-100 text-neutral-400 mb-4">
          <CreditCard size={22} />
        </div>

        <h3 className="text-base font-semibold text-neutral-900">{t('payments.unconfigured.title')}</h3>
        <p className="text-sm text-neutral-500 max-w-sm mt-1 mb-6">{t('payments.unconfigured.description')}</p>

        <ol className="w-full max-w-md divide-y divide-neutral-100 rounded-xl ring-1 ring-inset ring-neutral-200 mb-6 text-start">
          {STEPS.map(({ icon: Icon, titleKey, descriptionKey }, i) => (
            <li key={i} className="flex items-start gap-3 px-4 py-3">
              <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-neutral-100 text-neutral-600 shrink-0 mt-0.5">
                <Icon size={14} />
              </span>
              <div>
                <p className="text-sm font-semibold text-neutral-800">{t(titleKey)}</p>
                <p className="text-xs text-neutral-500 mt-0.5">{t(descriptionKey)}</p>
              </div>
            </li>
          ))}
        </ol>

        <Link href={settingsHref} className={buttonClass('primary', 'md')}>
          <Gear size={14} />
          {t('payments.unconfigured.cta')}
        </Link>
      </div>
    </div>
  )
}

export default UnconfiguredPaymentsDisclaimer
