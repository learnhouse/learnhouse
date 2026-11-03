'use client'
import { CreditCard, Settings, ShoppingBag, Users } from 'lucide-react'
import React from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'

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
  return (
    <div className="ms-10 me-10 mx-auto bg-white rounded-xl nice-shadow px-4 py-4">
      {/* Empty state */}
      <div className="flex flex-col items-center py-12 px-6 text-center">
        {/* Icon cluster */}
        <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-gray-100 mb-5">
          <CreditCard className="text-gray-400" size={26} />
        </div>

        <h3 className="font-semibold text-gray-800 text-base mb-1">
          {t('payments.unconfigured.title')}
        </h3>
        <p className="text-sm text-gray-500 max-w-xs mb-8">
          {t('payments.unconfigured.description')}
        </p>

        {/* Steps */}
        <div className="w-full max-w-md space-y-2 mb-8 text-start">
          {STEPS.map(({ icon: Icon, titleKey, descriptionKey }, i) => (
            <div
              key={i}
              className="flex items-start space-x-3 border border-gray-100 rounded-xl px-4 py-3 bg-gray-50"
            >
              <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-white border border-gray-200 shrink-0 mt-0.5">
                <Icon size={14} className="text-gray-500" />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-700">{t(titleKey)}</p>
                <p className="text-xs text-gray-400 mt-0.5">{t(descriptionKey)}</p>
              </div>
            </div>
          ))}
        </div>

        {/* CTA */}
        <Link
          href="./configuration"
          className="inline-flex items-center space-x-1.5 bg-gray-900 hover:bg-gray-800 text-white text-xs font-medium px-4 py-2 rounded-lg transition-colors duration-150"
        >
          <Settings size={13} />
          <span>{t('payments.unconfigured.cta')}</span>
        </Link>
      </div>
    </div>
  )
}

export default UnconfiguredPaymentsDisclaimer
