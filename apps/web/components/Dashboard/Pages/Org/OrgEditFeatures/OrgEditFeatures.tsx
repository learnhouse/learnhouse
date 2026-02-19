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
import { ShieldAlert, Users, CreditCard, FolderOpen, Lock, Headphones, BookCopy, FileText } from 'lucide-react'
import { ChalkboardSimple } from '@phosphor-icons/react'

interface FeatureToggleProps {
  id: string
  title: string
  description: string
  enabled: boolean
  isUpdating: boolean
  canEdit: boolean
  requiredPlan: PlanLevel
  currentPlan: PlanLevel
  icon: React.ReactNode
  onToggle: (enabled: boolean) => void
  upgradeMessage?: string
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
  upgradeMessage,
}) => {
  const planAllowed = planMeetsRequirement(currentPlan, requiredPlan)
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
            <PlanBadge
              currentPlan={currentPlan}
              requiredPlan={requiredPlan}
            />
          </div>
          <p className="text-sm text-gray-500">{description}</p>
          {!planAllowed && upgradeMessage && (
            <p className="text-xs text-amber-600 flex items-center gap-1 mt-1">
              <Lock size={10} />
              {upgradeMessage}
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
  const currentPlan: PlanLevel = org?.config?.config?.cloud?.plan || 'free'
  const { rights } = useAdminStatus()
  const canEditOrgSettings = rights?.organizations?.action_update === true

  // Feature states
  const [coursesEnabled, setCoursesEnabled] = useState<boolean>(true)
  const [communitiesEnabled, setCommunitiesEnabled] = useState<boolean>(true)
  const [paymentsEnabled, setPaymentsEnabled] = useState<boolean>(false)
  const [collectionsEnabled, setCollectionsEnabled] = useState<boolean>(true)
  const [podcastsEnabled, setPodcastsEnabled] = useState<boolean>(false)
  const [docsEnabled, setDocsEnabled] = useState<boolean>(false)
  const [boardsEnabled, setBoardsEnabled] = useState<boolean>(false)

  // Loading states
  const [updatingFeature, setUpdatingFeature] = useState<string | null>(null)

  // Initialize feature states from org config
  useEffect(() => {
    if (org?.config?.config?.features) {
      const features = org.config.config.features

      // Courses - default to true for backward compatibility
      const coursEnabled = features.courses?.enabled
      setCoursesEnabled(coursEnabled !== undefined ? coursEnabled : true)

      // Communities - default to true for backward compatibility
      const commEnabled = features.communities?.enabled
      setCommunitiesEnabled(commEnabled !== undefined ? commEnabled : true)

      // Payments
      const payEnabled = features.payments?.enabled
      setPaymentsEnabled(payEnabled !== undefined ? payEnabled : false)

      // Collections - default to true
      const collEnabled = features.collections?.enabled
      setCollectionsEnabled(collEnabled !== undefined ? collEnabled : true)

      // Podcasts - default to false (disabled by default)
      const podEnabled = features.podcasts?.enabled
      setPodcastsEnabled(podEnabled !== undefined ? podEnabled : false)

      // Docs - default to false (disabled by default)
      const docEnabled = features.docs?.enabled
      setDocsEnabled(docEnabled !== undefined ? docEnabled : false)

      // Boards - default to false (disabled by default)
      const brdEnabled = features.boards?.enabled
      setBoardsEnabled(brdEnabled !== undefined ? brdEnabled : false)
    }
  }, [org])

  const updateFeatureConfig = async (feature: string, enabled: boolean) => {
    // Early check for admin status
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

  const handleCoursesToggle = async (enabled: boolean) => {
    const success = await updateFeatureConfig('courses', enabled)
    if (success) {
      setCoursesEnabled(enabled)
    }
  }

  const handleCommunitiesToggle = async (enabled: boolean) => {
    const success = await updateFeatureConfig('communities', enabled)
    if (success) {
      setCommunitiesEnabled(enabled)
    }
  }

  const handlePaymentsToggle = async (enabled: boolean) => {
    const success = await updateFeatureConfig('payments', enabled)
    if (success) {
      setPaymentsEnabled(enabled)
    }
  }

  const handleCollectionsToggle = async (enabled: boolean) => {
    const success = await updateFeatureConfig('collections', enabled)
    if (success) {
      setCollectionsEnabled(enabled)
    }
  }

  const handlePodcastsToggle = async (enabled: boolean) => {
    const success = await updateFeatureConfig('podcasts', enabled)
    if (success) {
      setPodcastsEnabled(enabled)
    }
  }

  const handleDocsToggle = async (enabled: boolean) => {
    const success = await updateFeatureConfig('docs', enabled)
    if (success) {
      setDocsEnabled(enabled)
    }
  }

  const handleBoardsToggle = async (enabled: boolean) => {
    const success = await updateFeatureConfig('boards', enabled)
    if (success) {
      setBoardsEnabled(enabled)
    }
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

          {/* Courses Toggle */}
          <FeatureToggle
            id="courses"
            title={t('dashboard.organization.features.toggles.courses.title')}
            description={t('dashboard.organization.features.toggles.courses.description')}
            enabled={coursesEnabled}
            isUpdating={updatingFeature === 'courses'}
            canEdit={canEditOrgSettings}
            requiredPlan="free"
            currentPlan={currentPlan}
            icon={<BookCopy size={20} className="text-gray-600" />}
            onToggle={handleCoursesToggle}
            upgradeMessage={t('dashboard.organization.features.upgrade_notice', { plan: 'free' })}
          />

          {/* Communities Toggle */}
          <FeatureToggle
            id="communities"
            title={t('dashboard.organization.features.toggles.communities.title')}
            description={t('dashboard.organization.features.toggles.communities.description')}
            enabled={communitiesEnabled}
            isUpdating={updatingFeature === 'communities'}
            canEdit={canEditOrgSettings}
            requiredPlan="standard"
            currentPlan={currentPlan}
            icon={<Users size={20} className="text-gray-600" />}
            onToggle={handleCommunitiesToggle}
            upgradeMessage={t('dashboard.organization.features.upgrade_notice', { plan: 'standard' })}
          />

          {/* Payments Toggle */}
          <FeatureToggle
            id="payments"
            title={t('dashboard.organization.features.toggles.payments.title')}
            description={t('dashboard.organization.features.toggles.payments.description')}
            enabled={paymentsEnabled}
            isUpdating={updatingFeature === 'payments'}
            canEdit={canEditOrgSettings}
            requiredPlan="standard"
            currentPlan={currentPlan}
            icon={<CreditCard size={20} className="text-gray-600" />}
            onToggle={handlePaymentsToggle}
            upgradeMessage={t('dashboard.organization.features.upgrade_notice', { plan: 'standard' })}
          />

          {/* Collections Toggle */}
          <FeatureToggle
            id="collections"
            title={t('dashboard.organization.features.toggles.collections.title')}
            description={t('dashboard.organization.features.toggles.collections.description')}
            enabled={collectionsEnabled}
            isUpdating={updatingFeature === 'collections'}
            canEdit={canEditOrgSettings}
            requiredPlan="free"
            currentPlan={currentPlan}
            icon={<FolderOpen size={20} className="text-gray-600" />}
            onToggle={handleCollectionsToggle}
            upgradeMessage={t('dashboard.organization.features.upgrade_notice', { plan: 'free' })}
          />

          {/* Podcasts Toggle */}
          <FeatureToggle
            id="podcasts"
            title={t('dashboard.organization.features.toggles.podcasts.title')}
            description={t('dashboard.organization.features.toggles.podcasts.description')}
            enabled={podcastsEnabled}
            isUpdating={updatingFeature === 'podcasts'}
            canEdit={canEditOrgSettings}
            requiredPlan="standard"
            currentPlan={currentPlan}
            icon={<Headphones size={20} className="text-gray-600" />}
            onToggle={handlePodcastsToggle}
            upgradeMessage={t('dashboard.organization.features.upgrade_notice', { plan: 'standard' })}
          />

          {/* Documentation Toggle */}
          <FeatureToggle
            id="docs"
            title="Documentation"
            description="Create documentation spaces with sections, groups, and pages"
            enabled={docsEnabled}
            isUpdating={updatingFeature === 'docs'}
            canEdit={canEditOrgSettings}
            requiredPlan="pro"
            currentPlan={currentPlan}
            icon={<FileText size={20} className="text-gray-600" />}
            onToggle={handleDocsToggle}
            upgradeMessage={t('dashboard.organization.features.upgrade_notice', { plan: 'pro' })}
          />

          {/* Boards Toggle */}
          <FeatureToggle
            id="boards"
            title="Boards"
            description="Create collaborative boards with lists and cards for project management"
            enabled={boardsEnabled}
            isUpdating={updatingFeature === 'boards'}
            canEdit={canEditOrgSettings}
            requiredPlan="pro"
            currentPlan={currentPlan}
            icon={<ChalkboardSimple size={20} className="text-gray-600" />}
            onToggle={handleBoardsToggle}
            upgradeMessage={t('dashboard.organization.features.upgrade_notice', { plan: 'pro' })}
          />
        </div>
      </div>
    </div>
  )
}

export default OrgEditFeatures
