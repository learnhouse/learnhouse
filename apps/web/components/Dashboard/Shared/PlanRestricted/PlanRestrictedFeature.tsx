'use client'

import React from 'react'
import { useTranslation } from 'react-i18next'
import type { LucideIcon } from 'lucide-react'
import { PlanLevel, planMeetsRequirement } from '@services/plans/plans'
import { getUpgradeUrl } from '@services/config/config'
import { useOrg } from '@components/Contexts/OrgContext'
import PlanBadge from './PlanBadge'

interface PlanRestrictedFeatureProps {
  currentPlan: PlanLevel
  requiredPlan: PlanLevel
  icon?: LucideIcon | React.ComponentType<{ className?: string; size?: number }>
  customIcon?: React.ReactNode
  titleKey: string
  descriptionKey: string
  children: React.ReactNode
  fullScreen?: boolean
}

const getPlanGradient = (plan: PlanLevel): string => {
  switch (plan) {
    case 'standard':
      return 'bg-gradient-to-b from-blue-50/80 via-white to-white'
    case 'pro':
      return 'bg-gradient-to-b from-purple-50/80 via-white to-white'
    case 'enterprise':
      return 'bg-gradient-to-b from-amber-50/80 via-white to-white'
    default:
      return 'bg-gradient-to-b from-gray-50/80 via-white to-white'
  }
}

const PlanRestrictedFeature: React.FC<PlanRestrictedFeatureProps> = ({
  currentPlan,
  requiredPlan,
  icon: Icon,
  customIcon,
  titleKey: _titleKey,
  descriptionKey,
  children,
  fullScreen = false,
}) => {
  const { t } = useTranslation()
  const org = useOrg() as any
  const upgradeUrl = getUpgradeUrl(org?.slug || 'default')

  if (planMeetsRequirement(currentPlan, requiredPlan)) {
    return <>{children}</>
  }

  const gradientClass = getPlanGradient(requiredPlan)

  return (
    <div className={fullScreen ? 'flex items-center justify-center h-screen w-full p-6 bg-[#f8f8f8]' : 'sm:mx-10 mx-0'}>
      <div className={`rounded-xl nice-shadow overflow-hidden ${fullScreen ? 'w-full max-w-lg' : ''}`}>
        <div className={`flex flex-col items-center justify-center py-16 px-6 text-center ${gradientClass}`}>
          <div className="bg-white p-4 rounded-xl nice-shadow mb-6">
            {customIcon ? customIcon : Icon && <Icon className="w-8 h-8 text-gray-400" />}
          </div>

          <p className="text-gray-500 max-w-md mx-auto mb-8 leading-relaxed">
            {t(descriptionKey)}
          </p>

          {upgradeUrl ? (
            <a
              href={upgradeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="bg-white text-gray-700 px-6 py-2.5 rounded-lg font-semibold hover:bg-gray-50 transition-colors nice-shadow flex items-center gap-2"
            >
              <span>{t('common.plans.upgrade_to')}</span>
              <PlanBadge
                currentPlan={currentPlan}
                requiredPlan={requiredPlan}
                size="md"
                alwaysShow
                noMargin
              />
            </a>
          ) : (
            <div className="bg-white text-gray-700 px-6 py-2.5 rounded-lg font-semibold nice-shadow flex items-center gap-2">
              <span>{t('common.plans.upgrade_to')}</span>
              <PlanBadge
                currentPlan={currentPlan}
                requiredPlan={requiredPlan}
                size="md"
                alwaysShow
                noMargin
              />
            </div>
          )}

          <p className="mt-6 text-xs text-gray-400">
            {t('common.plans.current_plan')}: <span className="font-medium text-gray-500 capitalize">{currentPlan}</span>
          </p>
        </div>
      </div>
    </div>
  )
}

export default PlanRestrictedFeature
