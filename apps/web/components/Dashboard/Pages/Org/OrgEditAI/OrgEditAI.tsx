'use client'
import React from 'react'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { toast } from 'react-hot-toast'
import { mutate } from 'swr'
import { getAPIUrl } from '@services/config/config'
import { revalidateTags } from '@services/utils/ts/requests'
import { useTranslation } from 'react-i18next'
import { PlanLevel } from '@services/plans/plans'
import PlanRestrictedFeature from '@components/Dashboard/Shared/PlanRestricted/PlanRestrictedFeature'
import useAdminStatus from '@components/Hooks/useAdminStatus'
import { Switch } from '@components/ui/switch'
import { ShieldAlert } from 'lucide-react'
import Image from 'next/image'

const OrgEditAI: React.FC = () => {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const org = useOrg() as any
  const currentPlan: PlanLevel = org?.config?.config?.cloud?.plan || 'free'
  const { rights } = useAdminStatus()
  const canEditOrgSettings = rights?.organizations?.action_update === true

  const [aiEnabled, setAiEnabled] = React.useState<boolean>(false)
  const [isUpdating, setIsUpdating] = React.useState<boolean>(false)

  // Initialize AI enabled state from org config
  React.useEffect(() => {
    if (org?.config?.config?.features?.ai?.enabled !== undefined) {
      setAiEnabled(org.config.config.features.ai.enabled)
    }
  }, [org])

  const updateAIConfig = async (enabled: boolean) => {
    setIsUpdating(true)
    const loadingToast = toast.loading(t('dashboard.organization.settings.updating'))

    try {
      const response = await fetch(`${getAPIUrl()}orgs/${org.id}/config/ai?ai_enabled=${enabled}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${access_token}`
        }
      })

      if (!response.ok) {
        throw new Error('Failed to update AI configuration')
      }

      await revalidateTags(['organizations'], org.slug)
      mutate(`${getAPIUrl()}orgs/slug/${org.slug}`)
      setAiEnabled(enabled)
      toast.success(t('dashboard.organization.ai.toasts.save_success'), { id: loadingToast })
    } catch (err) {
      console.error('Error updating AI configuration:', err)
      toast.error(t('dashboard.organization.ai.toasts.save_error'), { id: loadingToast })
      // Revert the switch state on error
      setAiEnabled(!enabled)
    } finally {
      setIsUpdating(false)
    }
  }

  const handleToggle = (checked: boolean) => {
    setAiEnabled(checked)
    updateAIConfig(checked)
  }

  return (
    <PlanRestrictedFeature
      currentPlan={currentPlan}
      requiredPlan="standard"
      customIcon={
        <Image
          src="/learnhouse_ai_simple_colored.png"
          alt="LearnHouse AI"
          width={32}
          height={32}
        />
      }
      titleKey="common.plans.feature_restricted.ai.title"
      descriptionKey="common.plans.feature_restricted.ai.description"
    >
      <div className="sm:mx-10 mx-0 bg-white rounded-xl nice-shadow">
        <div className="pt-0.5">
          <div className="flex flex-col bg-gray-50 -space-y-1 px-5 py-3 mx-3 my-3 rounded-md">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <Image
                  src="/learnhouse_ai_simple_colored.png"
                  alt="LearnHouse AI"
                  width={24}
                  height={24}
                />
                <div>
                  <h1 className="font-bold text-xl text-gray-800">
                    {t('dashboard.organization.ai.title')}
                  </h1>
                  <h2 className="text-gray-500 text-md">
                    {t('dashboard.organization.ai.subtitle')}
                  </h2>
                </div>
              </div>
            </div>
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
                    {t('dashboard.organization.ai.admin_only')}
                  </p>
                </div>
              </div>
            )}

            {/* AI Enable/Disable Toggle */}
            <div className={`p-4 rounded-lg border ${canEditOrgSettings ? 'bg-gray-50/50 border-gray-200' : 'bg-gray-100 border-gray-200 opacity-60'}`}>
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <h4 className="text-sm font-medium text-gray-800">
                    {t('dashboard.organization.ai.enable_ai')}
                  </h4>
                  <p className="text-xs text-gray-500">
                    {t('dashboard.organization.ai.enable_ai_description')}
                  </p>
                </div>
                <Switch
                  checked={aiEnabled}
                  onCheckedChange={handleToggle}
                  disabled={isUpdating || !canEditOrgSettings}
                />
              </div>
            </div>

            {/* AI Features Info */}
            {aiEnabled && (
              <div className="p-4 rounded-lg bg-gradient-to-br from-indigo-50/50 to-purple-50/50 border border-indigo-100">
                <h4 className="text-sm font-medium text-gray-800 mb-2">
                  {t('dashboard.organization.ai.features_enabled')}
                </h4>
                <ul className="text-xs text-gray-600 space-y-1.5">
                  <li className="flex items-center space-x-2">
                    <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full"></span>
                    <span>{t('dashboard.organization.ai.feature_editor')}</span>
                  </li>
                  <li className="flex items-center space-x-2">
                    <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full"></span>
                    <span>{t('dashboard.organization.ai.feature_activity')}</span>
                  </li>
                  <li className="flex items-center space-x-2">
                    <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full"></span>
                    <span>{t('dashboard.organization.ai.feature_canvas')}</span>
                  </li>
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>
    </PlanRestrictedFeature>
  )
}

export default OrgEditAI
