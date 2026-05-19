'use client'

import React from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { GearSix } from '@phosphor-icons/react'

import { useOrg } from '@components/Contexts/OrgContext'
import { useResolvedFeature } from '@components/Hooks/useResolvedFeature'
import { getUpgradeUrl, getUriWithOrg } from '@services/config/config'
import {
  FEATURE_METADATA,
  FeatureKey,
  getFeatureMeta,
} from '@services/features/featureMetadata'
import PlanBadge from '@components/Dashboard/Shared/PlanRestricted/PlanBadge'

export interface FeatureGateProps {
  /** Feature key (drives icon, copy, upsell tier — see featureMetadata.ts). */
  feature: FeatureKey
  /**
   * Org slug for the "Go to settings" link in admin-disabled state. Optional;
   * falls back to the current org context when omitted.
   */
  orgslug?: string
  /**
   * - 'dashboard': admin context. When the feature is admin-disabled the card
   *   offers a link to /dash/org/settings/features.
   * - 'public': learner-facing context. Admin-disabled renders a plain "not
   *   available" message — no settings link.
   */
  context?: 'dashboard' | 'public'
  /** Content rendered when the feature is granted. */
  children: React.ReactNode
}

const PLAN_GRADIENT: Record<string, string> = {
  personal: 'from-gray-50/80',
  family: 'from-gray-50/80',
  standard: 'from-blue-50/80',
  pro: 'from-purple-50/80',
  enterprise: 'from-amber-50/80',
}

/**
 * Unified feature gate. Reads resolved_features for the given feature, then:
 *   - renders children when granted
 *   - shows the upgrade card when plan is below the requirement
 *   - shows the admin-disabled card when plan is OK but the feature is toggled off
 *
 * Replaces the previous PlanRestrictedFeature + FeatureDisabledView nesting.
 */
export default function FeatureGate({
  feature,
  orgslug,
  context = 'dashboard',
  children,
}: FeatureGateProps) {
  const { t } = useTranslation()
  const org = useOrg() as any
  const state = useResolvedFeature(feature)
  const resolvedSlug = orgslug ?? org?.slug ?? 'default'

  if (!state.reason) {
    return <>{children}</>
  }

  if (state.reason === 'disabled') {
    return (
      <DisabledCard
        feature={feature}
        orgslug={resolvedSlug}
        context={context}
        t={t}
      />
    )
  }

  return (
    <UpgradeCard
      feature={feature}
      currentPlan={state.currentPlan}
      orgSlug={org?.slug || 'default'}
      t={t}
    />
  )
}

function UpgradeCard({
  feature,
  currentPlan,
  orgSlug,
  t,
}: {
  feature: FeatureKey
  currentPlan: ReturnType<typeof useResolvedFeature>['currentPlan']
  orgSlug: string
  t: ReturnType<typeof useTranslation>['t']
}) {
  const meta = getFeatureMeta(feature)
  const Icon = meta.Icon
  const upgradeUrl = getUpgradeUrl(orgSlug)
  const gradient = PLAN_GRADIENT[meta.upsellPlan] ?? 'from-gray-50/80'

  const badge = (
    <PlanBadge
      currentPlan={currentPlan}
      requiredPlan={meta.upsellPlan}
      size="md"
      alwaysShow
      noMargin
    />
  )

  return (
    <GateShell>
      <GateCard gradient={gradient}>
        <IconBubble>
          <Icon size={32} weight="duotone" className="text-gray-500" />
        </IconBubble>

        <p className="text-gray-500 max-w-md mx-auto mb-8 leading-relaxed text-sm">
          {t(meta.descriptionKey)}
        </p>

        {upgradeUrl ? (
          <a
            href={upgradeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="bg-white text-gray-700 px-6 py-2.5 rounded-lg font-semibold hover:bg-gray-50 transition-colors nice-shadow flex items-center gap-2"
          >
            <span>{t('common.plans.upgrade_to')}</span>
            {badge}
          </a>
        ) : (
          <div className="bg-white text-gray-700 px-6 py-2.5 rounded-lg font-semibold nice-shadow flex items-center gap-2">
            <span>{t('common.plans.upgrade_to')}</span>
            {badge}
          </div>
        )}

        <p className="mt-6 text-xs text-gray-400">
          {t('common.plans.current_plan')}:{' '}
          <span className="font-medium text-gray-500 capitalize">{currentPlan}</span>
        </p>
      </GateCard>
    </GateShell>
  )
}

function DisabledCard({
  feature,
  orgslug,
  context,
  t,
}: {
  feature: FeatureKey
  orgslug: string
  context: 'dashboard' | 'public'
  t: ReturnType<typeof useTranslation>['t']
}) {
  const meta = getFeatureMeta(feature)
  const Icon = meta.Icon
  const featureDisplayName = t(
    `common.features.disabled.names.${feature}`,
    t(meta.titleKey)
  )

  return (
    <GateShell>
      <GateCard gradient="from-gray-50/80">
        <IconBubble>
          <Icon size={32} weight="duotone" className="text-gray-500" />
        </IconBubble>

        <h2 className="text-lg font-semibold text-gray-800 mb-2">
          {context === 'public'
            ? t('common.features.disabled.public.title', { feature: featureDisplayName })
            : t('common.features.disabled.dashboard.title', { feature: featureDisplayName })}
        </h2>

        <p className="text-gray-500 text-sm mb-6 max-w-sm leading-relaxed">
          {context === 'public'
            ? t('common.features.disabled.public.description')
            : t('common.features.disabled.dashboard.description')}
        </p>

        {context === 'dashboard' ? (
          <Link
            href={getUriWithOrg(orgslug, '/dash/org/settings/features')}
            className="flex items-center gap-2 px-4 py-2 bg-black text-white rounded-lg text-sm font-medium hover:bg-gray-800 transition-colors"
          >
            <GearSix size={16} weight="bold" />
            {t('common.features.disabled.enable_feature')}
          </Link>
        ) : (
          <div className="bg-gray-100 text-gray-600 px-4 py-2 rounded-lg text-sm font-medium">
            {t('common.features.disabled.status')}
          </div>
        )}
      </GateCard>
    </GateShell>
  )
}

function GateShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-center min-h-[60vh] w-full p-6 bg-[#f8f8f8]">
      <div className="w-full max-w-lg">{children}</div>
    </div>
  )
}

function GateCard({
  gradient,
  children,
}: {
  gradient: string
  children: React.ReactNode
}) {
  return (
    <div className="bg-white rounded-xl nice-shadow overflow-hidden">
      <div className={`flex flex-col items-center justify-center py-14 px-6 text-center bg-gradient-to-b ${gradient} via-white to-white`}>
        {children}
      </div>
    </div>
  )
}

function IconBubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-white p-4 rounded-xl nice-shadow mb-6 inline-flex">
      {children}
    </div>
  )
}

// Re-export so callers can type-check the feature prop.
export type { FeatureKey }
export { FEATURE_METADATA }
