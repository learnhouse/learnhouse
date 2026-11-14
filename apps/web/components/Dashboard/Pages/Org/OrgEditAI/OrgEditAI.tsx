'use client'
import React from 'react'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { toast } from 'react-hot-toast'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { getAPIUrl } from '@services/config/config'
import { revalidateTags } from '@services/utils/ts/requests'
import { useTranslation } from 'react-i18next'
import FeatureGate from '@components/Dashboard/Shared/FeatureGate/FeatureGate'
import useAdminStatus from '@components/Hooks/useAdminStatus'
import { Switch } from '@components/ui/switch'
import { ShieldWarning, ChatCircleDots, PencilSimple, Student, Info } from '@phosphor-icons/react'
import { AIMark } from '@components/Objects/AI/AIBrand'
import { Chip, SectionCard, SettingRow } from '@components/Dashboard/Shared/DashKit/DashKit'
import { Notice } from '@components/Dashboard/Pages/Org/OrgSettingsShared/orgSettingsUi'

const OrgEditAI: React.FC = () => {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const org = useOrg() as any
  const queryClient = useQueryClient()
  const { rights } = useAdminStatus()
  const canEditOrgSettings = rights?.organizations?.action_update === true

  const [aiEnabled, setAiEnabled] = React.useState<boolean>(false)
  const [copilotEnabled, setCopilotEnabled] = React.useState<boolean>(true)
  const [isUpdating, setIsUpdating] = React.useState<boolean>(false)

  React.useEffect(() => {
    const config = org?.config?.config
    if (!config) return

    const isV2 = config.config_version?.startsWith('2')

    // Read AI enabled state
    if (config.resolved_features?.ai) {
      setAiEnabled(config.resolved_features.ai.enabled)
    } else if (isV2 && config.admin_toggles?.ai) {
      setAiEnabled(!config.admin_toggles.ai.disabled)
    } else if (config.features?.ai?.enabled !== undefined) {
      setAiEnabled(config.features.ai.enabled)
    }

    // Read copilot enabled state
    if (isV2 && config.admin_toggles?.ai?.copilot_enabled !== undefined) {
      setCopilotEnabled(config.admin_toggles.ai.copilot_enabled)
    } else if (config.features?.ai?.copilot_enabled !== undefined) {
      setCopilotEnabled(config.features.ai.copilot_enabled)
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
      queryClient.invalidateQueries({ queryKey: queryKeys.org.detail(org.slug) })
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

  const disabled = isUpdating || !canEditOrgSettings

  return (
    <FeatureGate feature="ai" allowWhenDisabled>
      <div className="flex flex-col gap-5">
        {/* Admin-only warning */}
        {!canEditOrgSettings && (
          <Notice tone="amber" icon={<ShieldWarning size={16} />}>
            {t('dashboard.organization.ai.admin_only')}
          </Notice>
        )}

        {/* Off-state notice, only once the org has loaded so it never flashes */}
        {org && !aiEnabled && (
          <Notice tone="neutral" icon={<Info size={16} />}>
            {t('dashboard.organization.ai.currently_disabled')}
          </Notice>
        )}

        <SectionCard
          icon={<AIMark variant="app" size={20} alt="" />}
          title={t('dashboard.organization.ai.title')}
          description={t('dashboard.organization.ai.subtitle')}
          actions={
            org ? (
              <Chip tone={aiEnabled ? 'emerald' : 'neutral'}>
                {aiEnabled
                  ? t('dashboard.organization.settings_ui.status_on')
                  : t('dashboard.organization.settings_ui.status_off')}
              </Chip>
            ) : undefined
          }
        >
          <div className="divide-y divide-neutral-100">
            <SettingRow
              icon={<AIMark size={18} alt="" />}
              title={<label htmlFor="ai-enabled" className="cursor-pointer">{t('dashboard.organization.ai.enable_ai')}</label>}
              description={t('dashboard.organization.ai.enable_ai_description')}
              control={
                <Switch
                  id="ai-enabled"
                  checked={aiEnabled}
                  onCheckedChange={(checked) => {
                    setAiEnabled(checked)
                    updateAIConfig({ ai_enabled: checked })
                  }}
                  disabled={disabled}
                />
              }
            />

            {/* Sub-features (only when AI is enabled) */}
            {aiEnabled && (
              <>
                <SettingRow
                  icon={<ChatCircleDots size={18} />}
                  title={<label htmlFor="ai-copilot" className="cursor-pointer">{t('dashboard.organization.ai.ai_copilot')}</label>}
                  description={t('dashboard.organization.ai.ai_copilot_description')}
                  control={
                    <Switch
                      id="ai-copilot"
                      checked={copilotEnabled}
                      onCheckedChange={(checked) => {
                        setCopilotEnabled(checked)
                        updateAIConfig({ copilot_enabled: checked })
                      }}
                      disabled={disabled}
                    />
                  }
                />
                <SettingRow
                  icon={<PencilSimple size={18} />}
                  title={t('dashboard.organization.ai.feature_editor')}
                  description={t('dashboard.organization.ai.feature_editor_description')}
                  control={<Chip>{t('dashboard.organization.ai.always_on')}</Chip>}
                />
                <SettingRow
                  icon={<Student size={18} />}
                  title={t('dashboard.organization.ai.feature_activity')}
                  description={t('dashboard.organization.ai.feature_activity_description')}
                  control={<Chip>{t('dashboard.organization.ai.always_on')}</Chip>}
                />
              </>
            )}
          </div>
        </SectionCard>
      </div>
    </FeatureGate>
  )
}

export default OrgEditAI
