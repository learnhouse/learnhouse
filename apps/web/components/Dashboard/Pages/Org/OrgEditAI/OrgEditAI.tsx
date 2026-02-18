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
import { ShieldAlert, BrainCircuit, MessageCircle, Pencil, Sparkles } from 'lucide-react'
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
  const [copilotEnabled, setCopilotEnabled] = React.useState<boolean>(true)
  const [isUpdating, setIsUpdating] = React.useState<boolean>(false)

  React.useEffect(() => {
    if (org?.config?.config?.features?.ai?.enabled !== undefined) {
      setAiEnabled(org.config.config.features.ai.enabled)
    }
    if (org?.config?.config?.features?.ai?.copilot_enabled !== undefined) {
      setCopilotEnabled(org.config.config.features.ai.copilot_enabled)
    }
  }, [org])

  const updateAIConfig = async (params: { ai_enabled?: boolean; copilot_enabled?: boolean }) => {
    setIsUpdating(true)
    const loadingToast = toast.loading(t('dashboard.organization.settings.updating'))

    try {
      const queryParts: string[] = []
      if (params.ai_enabled !== undefined) queryParts.push(`ai_enabled=${params.ai_enabled}`)
      if (params.copilot_enabled !== undefined) queryParts.push(`copilot_enabled=${params.copilot_enabled}`)

      const response = await fetch(`${getAPIUrl()}orgs/${org.id}/config/ai?${queryParts.join('&')}`, {
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
      if (params.ai_enabled !== undefined) setAiEnabled(params.ai_enabled)
      if (params.copilot_enabled !== undefined) setCopilotEnabled(params.copilot_enabled)
      toast.success(t('dashboard.organization.ai.toasts.save_success'), { id: loadingToast })
    } catch (err) {
      console.error('Error updating AI configuration:', err)
      toast.error(t('dashboard.organization.ai.toasts.save_error'), { id: loadingToast })
      if (params.ai_enabled !== undefined) setAiEnabled(!params.ai_enabled)
      if (params.copilot_enabled !== undefined) setCopilotEnabled(!params.copilot_enabled)
    } finally {
      setIsUpdating(false)
    }
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
      <div className="sm:mx-10 mx-0 space-y-4">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Image
            src="/learnhouse_ai_simple_colored.png"
            alt="LearnHouse AI"
            width={28}
            height={28}
          />
          <div>
            <h1 className="font-bold text-lg text-gray-800">
              {t('dashboard.organization.ai.title')}
            </h1>
            <p className="text-sm text-gray-500">
              {t('dashboard.organization.ai.subtitle')}
            </p>
          </div>
        </div>

        {/* Admin-only warning */}
        {!canEditOrgSettings && (
          <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-amber-50 border border-amber-200/80">
            <ShieldAlert className="w-4 h-4 text-amber-600 flex-shrink-0" />
            <p className="text-sm text-amber-800">
              {t('dashboard.organization.ai.admin_only')}
            </p>
          </div>
        )}

        {/* Main AI toggle */}
        <SettingRow
          icon={<BrainCircuit className="w-4 h-4" />}
          title={t('dashboard.organization.ai.enable_ai')}
          description={t('dashboard.organization.ai.enable_ai_description')}
          checked={aiEnabled}
          onToggle={(checked) => {
            setAiEnabled(checked)
            updateAIConfig({ ai_enabled: checked })
          }}
          disabled={isUpdating || !canEditOrgSettings}
        />

        {/* Sub-features (only when AI is enabled) */}
        {aiEnabled && (
          <div className="space-y-3 pl-4 border-l-2 border-gray-100 ml-2">
            <SettingRow
              icon={<MessageCircle className="w-4 h-4" />}
              title="AI Copilot"
              description="Let learners ask questions about course content. Uses indexed material to provide grounded answers with source citations."
              checked={copilotEnabled}
              onToggle={(checked) => {
                setCopilotEnabled(checked)
                updateAIConfig({ copilot_enabled: checked })
              }}
              disabled={isUpdating || !canEditOrgSettings}
            />

            <SettingRow
              icon={<Pencil className="w-4 h-4" />}
              title={t('dashboard.organization.ai.feature_editor')}
              description="AI-powered content editing assistance for course creators."
              checked={true}
              disabled={true}
              alwaysOn
            />

            <SettingRow
              icon={<Sparkles className="w-4 h-4" />}
              title={t('dashboard.organization.ai.feature_activity')}
              description="AI assistant available within activities to help learners."
              checked={true}
              disabled={true}
              alwaysOn
            />
          </div>
        )}
      </div>
    </PlanRestrictedFeature>
  )
}

function SettingRow({ icon, title, description, checked, onToggle, disabled, alwaysOn }: {
  icon: React.ReactNode
  title: string
  description: string
  checked: boolean
  onToggle?: (checked: boolean) => void
  disabled?: boolean
  alwaysOn?: boolean
}) {
  return (
    <div className="flex items-start justify-between gap-4 p-4 rounded-xl bg-white nice-shadow">
      <div className="flex gap-3 min-w-0">
        <div className="flex-shrink-0 mt-0.5 text-gray-400">{icon}</div>
        <div className="space-y-0.5 min-w-0">
          <h4 className="text-sm font-medium text-gray-800">{title}</h4>
          <p className="text-xs text-gray-500 leading-relaxed">{description}</p>
        </div>
      </div>
      {alwaysOn ? (
        <span className="flex-shrink-0 text-[11px] font-medium text-gray-400 bg-gray-100 px-2 py-1 rounded-md mt-0.5">
          Always on
        </span>
      ) : (
        <Switch
          checked={checked}
          onCheckedChange={onToggle}
          disabled={disabled}
          className="flex-shrink-0 mt-0.5"
        />
      )}
    </div>
  )
}

export default OrgEditAI
