'use client'
import React from 'react'
import { Lock } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import PlanBadge from '@components/Dashboard/Shared/PlanRestricted/PlanBadge'

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

  return (
    <div className="relative min-h-[300px] min-w-0 overflow-hidden">
      {isAdvanced ? (
        children
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-50 rounded-xl border border-gray-100">
          <Lock className="text-gray-300 mb-3" size={28} weight="bold" />
          <div className="flex items-center gap-1.5 mb-1">
            <p className="text-sm font-semibold text-gray-600">{t('analytics.advanced_gate.requires')}</p>
            <PlanBadge currentPlan={currentPlan as any} requiredPlan="pro" alwaysShow noMargin size="md" />
          </div>
          <p className="text-xs text-gray-400 mt-1">{t('analytics.advanced_gate.upgrade_description')}</p>
        </div>
      )}
    </div>
  )
}
