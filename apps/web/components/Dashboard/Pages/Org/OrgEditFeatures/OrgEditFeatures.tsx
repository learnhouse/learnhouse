'use client'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'react-hot-toast'
import { useQueryClient } from '@tanstack/react-query'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { usePlan } from '@components/Hooks/usePlan'
import useAdminStatus from '@components/Hooks/useAdminStatus'
import PlanBadge from '@components/Dashboard/Shared/PlanRestricted/PlanBadge'
import { Switch } from '@components/ui/switch'
import { queryKeys } from '@/lib/query/keys'
import { getUpgradeUrl } from '@services/config/config'
import { updateOrgFeatureToggle } from '@services/settings/org'
import { revalidateTags } from '@services/utils/ts/requests'
import {
  OPTIONAL_FEATURES,
  OptionalFeature,
  OptionalFeatureState,
  getOptionalFeatureState,
} from '@services/features/optionalFeatures'

type Row = { feature: OptionalFeature } & OptionalFeatureState

/**
 * One switch per optional feature. A feature the plan does not include has no
 * switch, only the plan that unlocks it.
 */
const OrgEditFeatures: React.FC = () => {
  const { t } = useTranslation()
  const org = useOrg() as any
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token
  const queryClient = useQueryClient()
  const plan = usePlan()
  const { canManageOrg } = useAdminStatus()
  const [updating, setUpdating] = useState<string | null>(null)

  const rf = org?.config?.config?.resolved_features
  const rows: Row[] = OPTIONAL_FEATURES.map((feature) => ({
    feature,
    ...getOptionalFeatureState(rf?.[feature.key]),
  }))
  const inPlan = rows.filter((r) => r.status !== 'locked')
  const locked = rows.filter((r) => r.status === 'locked')

  const toggle = async (row: Row, enabled: boolean) => {
    const name = t(row.feature.labelKey)
    setUpdating(row.feature.key)
    const toastId = toast.loading(
      t(enabled ? 'dashboard.organization.features.toasts.enabling' : 'dashboard.organization.features.toasts.disabling', { feature: name })
    )
    try {
      await updateOrgFeatureToggle(org.id, row.feature.key, enabled, accessToken)
      await revalidateTags(['organizations'], org.slug)
      await queryClient.invalidateQueries({ queryKey: queryKeys.org.detail(org.slug) })
      toast.success(
        t(enabled ? 'dashboard.organization.features.toasts.enabled' : 'dashboard.organization.features.toasts.disabled', { feature: name }),
        { id: toastId }
      )
    } catch {
      toast.error(t('dashboard.organization.features.toasts.error', { feature: name }), { id: toastId })
    } finally {
      setUpdating(null)
    }
  }

  return (
    <div className="sm:mx-10 mx-0 space-y-6 pb-10">
      <section className="bg-white rounded-xl nice-shadow divide-y divide-gray-100">
        {inPlan.map((row) => {
          const byPlatform = row.status === 'off' && row.disabledBy === 'platform'
          return (
            <div key={row.feature.key} className="flex items-center gap-4 p-4">
              <FeatureIcon row={row} />
              <div className="flex-1 min-w-0 space-y-0.5">
                <h4 className="text-sm font-semibold text-gray-800">{t(row.feature.labelKey)}</h4>
                <p className="text-sm text-gray-500">{t(row.feature.descriptionKey)}</p>
                {byPlatform && (
                  <p className="text-xs text-amber-700">{t('dashboard.organization.features.platform_disabled')}</p>
                )}
              </div>
              <Switch
                checked={row.status === 'on'}
                onCheckedChange={(checked) => toggle(row, checked)}
                disabled={!canManageOrg || byPlatform || updating !== null}
                aria-label={t(row.feature.labelKey)}
              />
            </div>
          )
        })}
      </section>

      {locked.length > 0 && (
        <section className="space-y-2">
          <h3 className="px-1 text-sm font-semibold text-gray-500">
            {t('dashboard.organization.features.sections.locked')}
          </h3>
          <div className="bg-white rounded-xl nice-shadow divide-y divide-gray-100">
            {locked.map((row) => {
              const upgradeUrl = canManageOrg ? getUpgradeUrl(org?.slug, row.upgradePlan) : null
              return (
                <div key={row.feature.key} className="flex items-center gap-4 p-4">
                  <FeatureIcon row={row} />
                  <div className="flex-1 min-w-0 space-y-0.5">
                    <h4 className="text-sm font-semibold text-gray-500 flex items-center">
                      {t(row.feature.labelKey)}
                      {row.upgradePlan && <PlanBadge currentPlan={plan} requiredPlan={row.upgradePlan} alwaysShow />}
                    </h4>
                    <p className="text-sm text-gray-400">{t(row.feature.descriptionKey)}</p>
                  </div>
                  {upgradeUrl && (
                    <a
                      href={upgradeUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 text-sm font-semibold text-gray-700 bg-white px-3 py-1.5 rounded-lg nice-shadow hover:bg-gray-50 transition-colors"
                    >
                      {t('dashboard.organization.features.upgrade')}
                    </a>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}

function FeatureIcon({ row }: { row: Row }) {
  const Icon = row.feature.Icon
  return (
    <div
      className={`shrink-0 p-2 rounded-lg nice-shadow ${row.status === 'on' ? 'bg-white text-gray-700' : 'bg-gray-50 text-gray-400'}`}
    >
      <Icon size={18} weight="fill" />
    </div>
  )
}

export default OrgEditFeatures
