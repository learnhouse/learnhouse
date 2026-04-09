'use client'
import React from 'react'
import { Lock } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import PlanBadge from '@components/Dashboard/Shared/PlanRestricted/PlanBadge'
import { getUpgradeUrl } from '@services/config/config'
import { useOrg } from '@components/Contexts/OrgContext'

export function AdvancedGate({
  isAdvanced,
  currentPlan = 'free',
  children,
}: {
  isAdvanced: boolean
  currentPlan?: string
  children: React.ReactNode
}) {
  const { t } = useTranslation()
  const org = useOrg() as any
  const upgradeUrl = getUpgradeUrl(org?.slug || 'default')

  return (
    <div className="relative min-h-[300px] min-w-0 overflow-hidden">
      {isAdvanced ? (
        children
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-50 rounded-xl border border-gray-100">
          <Lock className="text-gray-300 mb-3" size={28} weight="bold" />
          <div className="flex items-center gap-1.5 mb-1">
            <p className="text-sm font-semibold text-gray-600">{t('analytics.advanced_gate.requires')}</p>
            <PlanBadge currentPlan={currentPlan as any} requiredPlan="enterprise" alwaysShow noMargin size="md" />
          </div>
          <p className="text-xs text-gray-400 mt-1">{t('analytics.advanced_gate.upgrade_description')}</p>
          {upgradeUrl && (
            <a
              href={upgradeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 text-xs font-semibold text-gray-600 bg-white px-4 py-2 rounded-lg nice-shadow hover:bg-gray-50 transition-colors"
            >
              {t('common.plans.upgrade_to')} Enterprise
            </a>
          )}
        </div>
      )}
    </div>
  )
}
