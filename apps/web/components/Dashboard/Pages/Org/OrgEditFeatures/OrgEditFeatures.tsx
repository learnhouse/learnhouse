'use client'
import React, { useState, useEffect } from 'react'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { toast } from 'react-hot-toast'
import { mutate } from 'swr'
import { getAPIUrl } from '@services/config/config'
import { revalidateTags } from '@services/utils/ts/requests'
import { useTranslation } from 'react-i18next'
import { PlanLevel, planMeetsRequirement } from '@services/plans/plans'
import PlanBadge from '@components/Dashboard/Shared/PlanRestricted/PlanBadge'
import useAdminStatus from '@components/Hooks/useAdminStatus'
import { Switch } from '@components/ui/switch'
import { ShieldAlert, Users, CreditCard, FolderOpen, Lock, Headphones } from 'lucide-react'
import { ChalkboardSimple, Cube } from '@phosphor-icons/react'
import { usePlan } from '@components/Hooks/usePlan'

interface FeatureToggleProps {
  id: string
  title: string
  description: string
  enabled: boolean
  isUpdating: boolean
  canEdit: boolean
  requiredPlan?: string | null
  currentPlan: PlanLevel
  icon: React.ReactNode
  onToggle: (enabled: boolean) => void
}

const FeatureToggle: React.FC<FeatureToggleProps> = ({
  id,
  title,
  description,
  enabled,
  isUpdating,
  canEdit,
  requiredPlan,
  currentPlan,
  icon,
  onToggle,
}) => {
  const { t } = useTranslation()
  const planAllowed = !requiredPlan || planMeetsRequirement(currentPlan, requiredPlan as PlanLevel)
  const isDisabled = isUpdating || !canEdit || !planAllowed

  return (
    <div className={`flex items-center justify-between space-x-2 bg-gray-50/50 p-4 rounded-lg nice-shadow ${!planAllowed ? 'opacity-60' : ''}`}>
      <div className="flex items-center space-x-4">
        <div className="p-2 bg-white rounded-lg nice-shadow">
          {icon}
        </div>
        <div className="space-y-0.5">
          <div className="flex items-center">
            <h4 className="text-base font-medium text-gray-800">{title}</h4>
            {requiredPlan && (
              <PlanBadge
                currentPlan={currentPlan}
                requiredPlan={requiredPlan as PlanLevel}
              />
            )}
          </div>
          <p className="text-sm text-gray-500">{description}</p>
          {!planAllowed && requiredPlan && (
            <p className="text-xs text-amber-600 flex items-center gap-1 mt-1">
              <Lock size={10} />
              {t('dashboard.organization.features.upgrade_notice', { plan: requiredPlan })}
            </p>
          )}
        </div>
      </div>
      <Switch
        checked={enabled && planAllowed}
        onCheckedChange={onToggle}
        disabled={isDisabled}
      />
    </div>
  )
}

const OrgEditFeatures: React.FC = () => {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const org = useOrg() as any
  const currentPlan = usePlan()
  const { rights } = useAdminStatus()
  const canEditOrgSettings = rights?.organizations?.action_update === true

  // resolved_features from the API (source of truth for enabled state + required_plan)
  const rf = org?.config?.config?.resolved_features

  // Feature states
  const [collectionsEnabled, setCollectionsEnabled] = useState<boolean>(true)
  const [communitiesEnabled, setCommunitiesEnabled] = useState<boolean>(true)
  const [paymentsEnabled, setPaymentsEnabled] = useState<boolean>(false)
  const [podcastsEnabled, setPodcastsEnabled] = useState<boolean>(false)
  const [boardsEnabled, setBoardsEnabled] = useState<boolean>(false)
  const [playgroundsEnabled, setPlaygroundsEnabled] = useState<boolean>(false)

  // Loading states
  const [updatingFeature, setUpdatingFeature] = useState<string | null>(null)

  // Initialize feature states from resolved_features
  useEffect(() => {
    if (!rf) return
    setCollectionsEnabled(rf.collections?.enabled ?? true)
    setCommunitiesEnabled(rf.communities?.enabled ?? false)
    setPaymentsEnabled(rf.payments?.enabled ?? false)
    setPodcastsEnabled(rf.podcasts?.enabled ?? false)
    setBoardsEnabled(rf.boards?.enabled ?? false)
    setPlaygroundsEnabled(rf.playgrounds?.enabled ?? false)
  }, [rf])

  const updateFeatureConfig = async (feature: string, enabled: boolean) => {
    if (!canEditOrgSettings) {
      toast.error(t('dashboard.organization.features.toasts.admin_only'))
      return false
    }

    setUpdatingFeature(feature)
    const loadingToast = toast.loading(
      enabled
        ? t('dashboard.organization.features.toasts.enabling', { feature })
        : t('dashboard.organization.features.toasts.disabling', { feature })
    )

    try {
      const response = await fetch(`${getAPIUrl()}orgs/${org.id}/config/${feature}?${feature}_enabled=${enabled}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${access_token}`
        }
      })

      if (!response.ok) {
        if (response.status === 403) {
          throw new Error('admin_only')
        }
        throw new Error(`Failed to update ${feature} configuration`)
      }

      await revalidateTags(['organizations'], org.slug)
      mutate(`${getAPIUrl()}orgs/slug/${org.slug}`)

      toast.success(
        enabled
          ? t('dashboard.organization.features.toasts.enabled', { feature })
          : t('dashboard.organization.features.toasts.disabled', { feature }),
        { id: loadingToast }
      )
      return true
    } catch (err: any) {
      console.error(`Error updating ${feature} configuration:`, err)
      const errorMessage = err?.message === 'admin_only'
        ? t('dashboard.organization.features.toasts.admin_only')
        : t('dashboard.organization.features.toasts.error', { feature })
      toast.error(errorMessage, { id: loadingToast })
      return false
    } finally {
      setUpdatingFeature(null)
    }
  }

  const handleCollectionsToggle = async (enabled: boolean) => {
    const success = await updateFeatureConfig('collections', enabled)
    if (success) setCollectionsEnabled(enabled)
  }

  const handleCommunitiesToggle = async (enabled: boolean) => {
    const success = await updateFeatureConfig('communities', enabled)
    if (success) setCommunitiesEnabled(enabled)
  }

  const handlePaymentsToggle = async (enabled: boolean) => {
    const success = await updateFeatureConfig('payments', enabled)
    if (success) setPaymentsEnabled(enabled)
  }

  const handlePodcastsToggle = async (enabled: boolean) => {
    const success = await updateFeatureConfig('podcasts', enabled)
    if (success) setPodcastsEnabled(enabled)
  }

  const handleBoardsToggle = async (enabled: boolean) => {
    const success = await updateFeatureConfig('boards', enabled)
    if (success) setBoardsEnabled(enabled)
  }

  const handlePlaygroundsToggle = async (enabled: boolean) => {
    const success = await updateFeatureConfig('playgrounds', enabled)
    if (success) setPlaygroundsEnabled(enabled)
  }

  return (
    <div className="sm:mx-10 mx-0 bg-white rounded-xl nice-shadow">
      <div className="pt-0.5">
        <div className="flex flex-col bg-gray-50 -space-y-1 px-5 py-3 mx-3 my-3 rounded-md">
          <h1 className="font-bold text-xl text-gray-800">
            {t('dashboard.organization.features.title')}
          </h1>
          <h2 className="text-gray-500 text-md">
            {t('dashboard.organization.features.subtitle')}
          </h2>
        </div>
      </div>

      <div className="p-4 pt-1">
        <div className="space-y-4">
          {/* Admin-only warning */}
          {!canEditOrgSettings && (
            <div className="p-4 rounded-lg bg-amber-50 border border-amber-200">
              <div className="flex items-center space-x-3">
                <ShieldAlert className="w-5 h-5 text-amber-600 flex-shrink-0" />
                <p className="text-sm text-amber-800">
                  {t('dashboard.organization.features.admin_only')}
                </p>
              </div>
            </div>
          )}

          {/* Collections Toggle */}
          <FeatureToggle
            id="collections"
            title={t('dashboard.organization.features.toggles.collections.title')}
            description={t('dashboard.organization.features.toggles.collections.description')}
            enabled={collectionsEnabled}
            isUpdating={updatingFeature === 'collections'}
            canEdit={canEditOrgSettings}
            requiredPlan={rf?.collections?.required_plan}
            currentPlan={currentPlan}
            icon={<FolderOpen size={20} className="text-gray-600" />}
            onToggle={handleCollectionsToggle}
          />

          {/* Communities Toggle */}
          <FeatureToggle
            id="communities"
            title={t('dashboard.organization.features.toggles.communities.title')}
            description={t('dashboard.organization.features.toggles.communities.description')}
            enabled={communitiesEnabled}
            isUpdating={updatingFeature === 'communities'}
            canEdit={canEditOrgSettings}
            requiredPlan={rf?.communities?.required_plan}
            currentPlan={currentPlan}
            icon={<Users size={20} className="text-gray-600" />}
            onToggle={handleCommunitiesToggle}
          />

          {/* Payments Toggle */}
          <FeatureToggle
            id="payments"
            title={t('dashboard.organization.features.toggles.payments.title')}
            description={t('dashboard.organization.features.toggles.payments.description')}
            enabled={paymentsEnabled}
            isUpdating={updatingFeature === 'payments'}
            canEdit={canEditOrgSettings}
            requiredPlan={rf?.payments?.required_plan}
            currentPlan={currentPlan}
            icon={<CreditCard size={20} className="text-gray-600" />}
            onToggle={handlePaymentsToggle}
          />

          {/* Podcasts Toggle */}
          <FeatureToggle
            id="podcasts"
            title={t('dashboard.organization.features.toggles.podcasts.title')}
            description={t('dashboard.organization.features.toggles.podcasts.description')}
            enabled={podcastsEnabled}
            isUpdating={updatingFeature === 'podcasts'}
            canEdit={canEditOrgSettings}
            requiredPlan={rf?.podcasts?.required_plan}
            currentPlan={currentPlan}
            icon={<Headphones size={20} className="text-gray-600" />}
            onToggle={handlePodcastsToggle}
          />

          {/* Boards Toggle */}
          <FeatureToggle
            id="boards"
            title="Boards"
            description="Create collaborative boards with lists and cards for project management"
            enabled={boardsEnabled}
            isUpdating={updatingFeature === 'boards'}
            canEdit={canEditOrgSettings}
            requiredPlan={rf?.boards?.required_plan}
            currentPlan={currentPlan}
            icon={<ChalkboardSimple size={20} className="text-gray-600" />}
            onToggle={handleBoardsToggle}
          />

          {/* Playgrounds Toggle */}
          <FeatureToggle
            id="playgrounds"
            title="Playgrounds"
            description="Create interactive AI-generated experiences for your learners"
            enabled={playgroundsEnabled}
            isUpdating={updatingFeature === 'playgrounds'}
            canEdit={canEditOrgSettings}
            requiredPlan={rf?.playgrounds?.required_plan}
            currentPlan={currentPlan}
            icon={<Cube size={20} className="text-gray-600" />}
            onToggle={handlePlaygroundsToggle}
          />
        </div>
      </div>
    </div>
  )
}

export default OrgEditFeatures
