'use client'

import React, { useState, useEffect } from 'react'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { toast } from 'react-hot-toast'
import { Input } from '@components/ui/input'
import { Button } from '@components/ui/button'
import { Label } from '@components/ui/label'
import { Switch } from '@components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@components/ui/select'
import { useTranslation } from 'react-i18next'
import PlanRestrictedFeature from '@components/Dashboard/Shared/PlanRestricted/PlanRestrictedFeature'
import { PlanLevel } from '@services/plans/plans'
import {
  getSSOConfig,
  createSSOConfig,
  updateSSOConfig,
  deleteSSOConfig,
  getAvailableProviders,
  getSetupUrl,
  SSOConfig,
  SSOProviderInfo,
  SSOProvider,
} from '@services/auth/sso'
import { usePlan } from '@components/Hooks/usePlan'
import {
  Shield,
  Settings2,
  ExternalLink,
  Trash2,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Info,
} from 'lucide-react'

const OrgEditSSO: React.FC = () => {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const org = useOrg() as any

  // State
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [providers, setProviders] = useState<SSOProviderInfo[]>([])
  const [config, setConfig] = useState<SSOConfig | null>(null)

  // Form state
  const [selectedProvider, setSelectedProvider] = useState<SSOProvider>('workos')
  const [enabled, setEnabled] = useState(false)
  const [domains, setDomains] = useState('')
  const [autoProvision, setAutoProvision] = useState(true)

  // WorkOS-specific
  const [organizationId, setOrganizationId] = useState('')

  // OIDC-specific
  const [issuerUrl, setIssuerUrl] = useState('')
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [scopes, setScopes] = useState('openid email profile')

  const currentPlan = usePlan()
  const rf = org?.config?.config?.resolved_features
  const ssoEnabled = rf?.sso?.enabled === true

  // Load SSO configuration and providers
  useEffect(() => {
    if (org?.id && access_token && ssoEnabled) {
      loadSSOData()
    }
  }, [org?.id, access_token, ssoEnabled])

  const loadSSOData = async () => {
    setIsLoading(true)
    try {
      const [providersData, configData] = await Promise.all([
        getAvailableProviders(org.id, access_token),
        getSSOConfig(org.id, access_token),
      ])

      setProviders(providersData)

      if (configData) {
        setConfig(configData)
        setSelectedProvider(configData.provider as SSOProvider)
        setEnabled(configData.enabled)
        setDomains(configData.domains?.join(', ') || '')
        setAutoProvision(configData.auto_provision_users)

        // WorkOS-specific
        setOrganizationId(configData.provider_config?.organization_id || '')

        // OIDC-specific
        setIssuerUrl(configData.provider_config?.issuer_url || '')
        setClientId(configData.provider_config?.client_id || '')
        setClientSecret(configData.provider_config?.client_secret || '')
        setScopes(configData.provider_config?.scopes || 'openid email profile')
      }
    } catch (error) {
      console.error('Failed to load SSO data:', error)
      toast.error(t('dashboard.organization.sso.load_error'))
    } finally {
      setIsLoading(false)
    }
  }

  const handleSave = async () => {
    if (!org?.id || !access_token) return

    setIsSaving(true)
    const loadingToast = toast.loading(t('dashboard.organization.sso.saving'))

    try {
      const domainList = domains
        .split(',')
        .map((d) => d.trim().toLowerCase())
        .filter((d) => d.length > 0)

      const providerConfig: Record<string, any> = {}

      if (selectedProvider === 'workos') {
        if (organizationId) {
          providerConfig.organization_id = organizationId
        }
      } else if (selectedProvider === 'custom_oidc') {
        providerConfig.issuer_url = issuerUrl
        providerConfig.client_id = clientId
        providerConfig.client_secret = clientSecret
        providerConfig.scopes = scopes
      }

      const data = {
        provider: selectedProvider,
        enabled,
        domains: domainList,
        auto_provision_users: autoProvision,
        provider_config: providerConfig,
      }

      if (config) {
        // Update existing config
        const updated = await updateSSOConfig(org.id, data, access_token)
        setConfig(updated)
      } else {
        // Create new config
        const created = await createSSOConfig(org.id, data, access_token)
        setConfig(created)
      }

      toast.success(t('dashboard.organization.sso.save_success'), {
        id: loadingToast,
      })
    } catch (error: any) {
      console.error('Failed to save SSO config:', error)
      toast.error(error.message || t('dashboard.organization.sso.save_error'), {
        id: loadingToast,
      })
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!org?.id || !access_token || !config) return

    if (!confirm(t('dashboard.organization.sso.delete_confirm'))) {
      return
    }

    const loadingToast = toast.loading(t('dashboard.organization.sso.deleting'))

    try {
      await deleteSSOConfig(org.id, access_token)
      setConfig(null)
      setEnabled(false)
      setDomains('')
      setOrganizationId('')
      toast.success(t('dashboard.organization.sso.delete_success'), {
        id: loadingToast,
      })
    } catch (error: any) {
      console.error('Failed to delete SSO config:', error)
      toast.error(error.message || t('dashboard.organization.sso.delete_error'), {
        id: loadingToast,
      })
    }
  }

  const handleOpenSetupPortal = async () => {
    if (!org?.id || !access_token) return

    try {
      const returnUrl = window.location.href
      const setupUrl = await getSetupUrl(org.id, returnUrl, access_token)

      if (setupUrl) {
        window.open(setupUrl, '_blank')
      } else {
        toast.error(t('dashboard.organization.sso.setup_not_available'))
      }
    } catch (error) {
      toast.error(t('dashboard.organization.sso.setup_error'))
    }
  }

  const getProviderInfo = (providerId: SSOProvider): SSOProviderInfo | undefined => {
    return providers.find((p) => p.id === providerId)
  }

  const selectedProviderInfo = getProviderInfo(selectedProvider)

  if (isLoading && ssoEnabled) {
    return (
      <div className="sm:mx-10 mx-0 bg-white rounded-xl nice-shadow p-8">
        <div className="flex items-center justify-center">
          <RefreshCw className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      </div>
    )
  }

  return (
    <PlanRestrictedFeature
      currentPlan={currentPlan}
      requiredPlan={(rf?.sso?.required_plan || 'enterprise') as PlanLevel}
      icon={Shield}
      titleKey="common.plans.feature_restricted.sso.title"
      descriptionKey="common.plans.feature_restricted.sso.description"
    >
      <div className="sm:mx-10 mx-0 bg-white rounded-xl nice-shadow pt-3">
        <div className="flex flex-col gap-0">
          {/* Header */}
          <div className="flex flex-col bg-gray-50 -space-y-1 px-5 py-3 mx-3 mb-3 rounded-md">
            <div className="flex justify-between items-center">
              <div>
                <h1 className="font-bold text-xl text-gray-800">
                  {t('dashboard.organization.sso.title')}
                </h1>
                <h2 className="text-gray-500 text-md">
                  {t('dashboard.organization.sso.subtitle')}
                </h2>
              </div>
              {config && (
                <div
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm ${
                    config.enabled
                      ? 'bg-green-100 text-green-700'
                      : 'bg-gray-100 text-gray-600'
                  }`}
                >
                  {config.enabled ? (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      {t('dashboard.organization.sso.status_enabled')}
                    </>
                  ) : (
                    <>
                      <AlertCircle className="w-4 h-4" />
                      {t('dashboard.organization.sso.status_disabled')}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Configuration Form */}
          <div className="flex flex-col space-y-6 px-5 pb-4">
            {/* Provider Selection */}
            <div className="space-y-2">
              <Label>
                {t('dashboard.organization.sso.provider')}
              </Label>
              <Select
                value={selectedProvider}
                onValueChange={(val) => setSelectedProvider(val as SSOProvider)}
                disabled={!!config}
              >
                <SelectTrigger className="w-full">
                  <SelectValue
                    placeholder={t('dashboard.organization.sso.select_provider')}
                  />
                </SelectTrigger>
                <SelectContent>
                  {providers.map((provider) => (
                    <SelectItem
                      key={provider.id}
                      value={provider.id}
                      disabled={!provider.available}
                    >
                      <div className="flex items-center gap-2">
                        <span>{provider.name}</span>
                        {!provider.available && (
                          <span className="text-xs text-gray-400">
                            ({t('dashboard.organization.sso.not_configured')})
                          </span>
                        )}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedProviderInfo && (
                <p className="text-sm text-gray-500">
                  {selectedProviderInfo.description}
                </p>
              )}
            </div>

            {/* Provider-specific configuration */}
            {selectedProvider === 'workos' && (
              <div className="space-y-4 p-4 bg-gray-50 rounded-lg">
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <Info className="w-4 h-4" />
                  {t('dashboard.organization.sso.workos_info')}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="organizationId">
                    {t('dashboard.organization.sso.workos_org_id')}
                  </Label>
                  <Input
                    id="organizationId"
                    value={organizationId}
                    onChange={(e) => setOrganizationId(e.target.value)}
                    placeholder="org_..."
                  />
                  <p className="text-xs text-gray-500">
                    {t('dashboard.organization.sso.workos_org_id_help')}
                  </p>
                </div>

                {config && selectedProviderInfo?.has_setup_portal && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleOpenSetupPortal}
                    className="flex items-center gap-2"
                  >
                    <Settings2 className="w-4 h-4" />
                    {t('dashboard.organization.sso.open_setup_portal')}
                    <ExternalLink className="w-3 h-3" />
                  </Button>
                )}
              </div>
            )}

            {/* Custom OIDC configuration */}
            {selectedProvider === 'custom_oidc' && (
              <div className="space-y-4 p-4 bg-gray-50 rounded-lg">
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <Info className="w-4 h-4" />
                  {t('dashboard.organization.sso.oidc_info')}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="issuerUrl">
                    {t('dashboard.organization.sso.oidc_issuer_url')}
                  </Label>
                  <Input
                    id="issuerUrl"
                    value={issuerUrl}
                    onChange={(e) => setIssuerUrl(e.target.value)}
                    placeholder="https://login.microsoftonline.com/{tenant}/v2.0"
                  />
                  <p className="text-xs text-gray-500">
                    {t('dashboard.organization.sso.oidc_issuer_url_help')}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="clientId">
                    {t('dashboard.organization.sso.oidc_client_id')}
                  </Label>
                  <Input
                    id="clientId"
                    value={clientId}
                    onChange={(e) => setClientId(e.target.value)}
                    placeholder="your-client-id"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="clientSecret">
                    {t('dashboard.organization.sso.oidc_client_secret')}
                  </Label>
                  <Input
                    id="clientSecret"
                    type="password"
                    value={clientSecret}
                    onChange={(e) => setClientSecret(e.target.value)}
                    placeholder="your-client-secret"
                  />
                  <p className="text-xs text-gray-500">
                    {t('dashboard.organization.sso.oidc_client_secret_help')}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="scopes">
                    {t('dashboard.organization.sso.oidc_scopes')}
                  </Label>
                  <Input
                    id="scopes"
                    value={scopes}
                    onChange={(e) => setScopes(e.target.value)}
                    placeholder="openid email profile"
                  />
                  <p className="text-xs text-gray-500">
                    {t('dashboard.organization.sso.oidc_scopes_help')}
                  </p>
                </div>
              </div>
            )}

            {/* Enable/Disable Toggle */}
            <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
              <div className="space-y-0.5">
                <Label className="text-base">
                  {t('dashboard.organization.sso.enable_sso')}
                </Label>
                <p className="text-sm text-gray-500">
                  {t('dashboard.organization.sso.enable_sso_desc')}
                </p>
              </div>
              <Switch
                checked={enabled}
                onCheckedChange={setEnabled}
                disabled={!selectedProviderInfo?.available}
              />
            </div>

            {/* Allowed Domains */}
            <div className="space-y-2">
              <Label htmlFor="domains">
                {t('dashboard.organization.sso.allowed_domains')}
              </Label>
              <Input
                id="domains"
                value={domains}
                onChange={(e) => setDomains(e.target.value)}
                placeholder="example.com, company.org"
              />
              <p className="text-sm text-gray-500">
                {t('dashboard.organization.sso.allowed_domains_help')}
              </p>
            </div>

            {/* Auto-provision Users */}
            <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
              <div className="space-y-0.5">
                <Label className="text-base">
                  {t('dashboard.organization.sso.auto_provision')}
                </Label>
                <p className="text-sm text-gray-500">
                  {t('dashboard.organization.sso.auto_provision_desc')}
                </p>
              </div>
              <Switch checked={autoProvision} onCheckedChange={setAutoProvision} />
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-between items-center px-5 pb-5 pt-4 border-t">
            <div>
              {config && (
                <Button
                  variant="outline"
                  onClick={handleDelete}
                  className="text-red-600 hover:text-red-700 hover:bg-red-50"
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  {t('dashboard.organization.sso.delete')}
                </Button>
              )}
            </div>
            <Button
              onClick={handleSave}
              disabled={isSaving || !selectedProviderInfo?.available}
              className="bg-black text-white hover:bg-black/90"
            >
              {isSaving
                ? t('dashboard.organization.sso.saving')
                : t('dashboard.organization.sso.save')}
            </Button>
          </div>
        </div>
      </div>
    </PlanRestrictedFeature>
  )
}

export default OrgEditSSO
