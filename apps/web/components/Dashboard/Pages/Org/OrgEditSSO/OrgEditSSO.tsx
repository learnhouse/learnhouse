'use client'

import React, { useState, useEffect } from 'react'
import { safeExternalUrl } from '@services/security/url'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { toast } from 'react-hot-toast'
import { Switch } from '@components/ui/switch'
import { useTranslation } from 'react-i18next'
import FeatureGate from '@components/Dashboard/Shared/FeatureGate/FeatureGate'
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
import {
  ArrowSquareOut,
  CaretDown,
  CheckCircle,
  Fingerprint,
  GearSix,
  Info,
  ShieldCheck,
  Trash,
  XCircle,
} from '@phosphor-icons/react'
import {
  Button,
  Chip,
  ConfirmDialog,
  FieldLabel,
  INPUT,
  SectionCard,
  SettingRow,
} from '@components/Dashboard/Shared/DashKit/DashKit'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'

const OrgEditSSO: React.FC = () => {
  const { t } = useTranslation()
  const { track } = useLHAnalytics('dashboard')
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
  const [confirmDelete, setConfirmDelete] = useState(false)
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

      const isNewConfig = !config
      if (config) {
        // Update existing config
        const updated = await updateSSOConfig(org.id, data, access_token)
        setConfig(updated)
      } else {
        // Create new config
        const created = await createSSOConfig(org.id, data, access_token)
        setConfig(created)
      }

      track(AnalyticsEvent.SsoConfigSaved, {
        provider: selectedProvider,
        is_new_config: isNewConfig,
      })

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

      const safeSetupUrl = safeExternalUrl(setupUrl)
      if (safeSetupUrl) {
        window.open(safeSetupUrl, '_blank', 'noopener,noreferrer')
      } else {
        toast.error(t('dashboard.organization.sso.setup_not_available'))
      }
    } catch (_error) {
      toast.error(t('dashboard.organization.sso.setup_error'))
    }
  }

  const getProviderInfo = (providerId: SSOProvider): SSOProviderInfo | undefined => {
    return providers.find((p) => p.id === providerId)
  }

  const selectedProviderInfo = getProviderInfo(selectedProvider)

  if (isLoading && ssoEnabled) {
    return (
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 animate-pulse" aria-busy>
        {[1, 2].map((i) => (
          <div key={i} className="bg-white rounded-2xl nice-shadow p-5 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-neutral-100" />
              <div className="flex-1 space-y-2">
                <div className="h-4 bg-neutral-100 rounded w-1/3" />
                <div className="h-3 bg-neutral-100 rounded w-2/3" />
              </div>
            </div>
            <div className="h-9 bg-neutral-100 rounded-lg" />
            <div className="h-9 bg-neutral-100 rounded-lg" />
          </div>
        ))}
      </div>
    )
  }

  const statusChip = config ? (
    config.enabled ? (
      <Chip tone="emerald" icon={<CheckCircle size={12} weight="fill" />}>
        {t('dashboard.organization.sso.status_enabled')}
      </Chip>
    ) : (
      <Chip icon={<XCircle size={12} weight="fill" />}>{t('dashboard.organization.sso.status_disabled')}</Chip>
    )
  ) : undefined

  return (
    <FeatureGate feature="sso">
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 items-start">
          {/* Provider */}
          <SectionCard
            icon={<Fingerprint size={18} />}
            title={t('dashboard.organization.sso.title')}
            description={t('dashboard.organization.sso.subtitle')}
            actions={statusChip}
          >
            <div className="flex flex-col gap-4">
              <div>
                <FieldLabel>{t('dashboard.organization.sso.provider')}</FieldLabel>
                <div className="relative">
                  <select
                    className={`${INPUT} appearance-none pe-9 disabled:bg-neutral-50 disabled:text-neutral-500`}
                    value={selectedProvider}
                    onChange={(e) => setSelectedProvider(e.target.value as SSOProvider)}
                    disabled={!!config}
                    aria-label={t('dashboard.organization.sso.provider')}
                  >
                    {!providers.some((p) => p.id === selectedProvider) && (
                      <option value={selectedProvider} disabled>
                        {t('dashboard.organization.sso.select_provider')}
                      </option>
                    )}
                    {providers.map((provider) => (
                      <option key={provider.id} value={provider.id} disabled={!provider.available}>
                        {provider.name}
                        {!provider.available ? ` (${t('dashboard.organization.sso.not_configured')})` : ''}
                      </option>
                    ))}
                  </select>
                  <CaretDown size={14} className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                </div>
                {selectedProviderInfo && (
                  <p className="mt-1.5 text-xs text-neutral-500">{selectedProviderInfo.description}</p>
                )}
              </div>

              {/* WorkOS */}
              {selectedProvider === 'workos' && (
                <div className="flex flex-col gap-4 rounded-xl ring-1 ring-inset ring-neutral-200/80 p-4">
                  <InfoLine>{t('dashboard.organization.sso.workos_info')}</InfoLine>
                  <label className="block">
                    <FieldLabel>{t('dashboard.organization.sso.workos_org_id')}</FieldLabel>
                    <input
                      id="organizationId"
                      dir="ltr"
                      className={`${INPUT} font-mono text-[13px]`}
                      value={organizationId}
                      onChange={(e) => setOrganizationId(e.target.value)}
                      placeholder="org_..."
                    />
                    <p className="mt-1.5 text-xs text-neutral-500">{t('dashboard.organization.sso.workos_org_id_help')}</p>
                  </label>
                  {config && selectedProviderInfo?.has_setup_portal && (
                    <div>
                      <Button onClick={handleOpenSetupPortal} icon={<GearSix size={14} />}>
                        {t('dashboard.organization.sso.open_setup_portal')}
                        <ArrowSquareOut size={12} className="text-neutral-400" />
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {/* Custom OIDC */}
              {selectedProvider === 'custom_oidc' && (
                <div className="flex flex-col gap-4 rounded-xl ring-1 ring-inset ring-neutral-200/80 p-4">
                  <InfoLine>{t('dashboard.organization.sso.oidc_info')}</InfoLine>
                  <label className="block">
                    <FieldLabel>{t('dashboard.organization.sso.oidc_issuer_url')}</FieldLabel>
                    <input
                      id="issuerUrl"
                      dir="ltr"
                      className={`${INPUT} font-mono text-[13px]`}
                      value={issuerUrl}
                      onChange={(e) => setIssuerUrl(e.target.value)}
                      placeholder="https://login.microsoftonline.com/{tenant}/v2.0"
                    />
                    <p className="mt-1.5 text-xs text-neutral-500">{t('dashboard.organization.sso.oidc_issuer_url_help')}</p>
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <label className="block">
                      <FieldLabel>{t('dashboard.organization.sso.oidc_client_id')}</FieldLabel>
                      <input
                        id="clientId"
                        dir="ltr"
                        className={`${INPUT} font-mono text-[13px]`}
                        value={clientId}
                        onChange={(e) => setClientId(e.target.value)}
                        placeholder="your-client-id"
                      />
                    </label>
                    <label className="block">
                      <FieldLabel>{t('dashboard.organization.sso.oidc_client_secret')}</FieldLabel>
                      <input
                        id="clientSecret"
                        type="password"
                        dir="ltr"
                        autoComplete="off"
                        className={`${INPUT} font-mono text-[13px]`}
                        value={clientSecret}
                        onChange={(e) => setClientSecret(e.target.value)}
                        placeholder="your-client-secret"
                      />
                    </label>
                  </div>
                  <p className="-mt-2 text-xs text-neutral-500">{t('dashboard.organization.sso.oidc_client_secret_help')}</p>
                  <label className="block">
                    <FieldLabel>{t('dashboard.organization.sso.oidc_scopes')}</FieldLabel>
                    <input
                      id="scopes"
                      dir="ltr"
                      className={`${INPUT} font-mono text-[13px]`}
                      value={scopes}
                      onChange={(e) => setScopes(e.target.value)}
                      placeholder="openid email profile"
                    />
                    <p className="mt-1.5 text-xs text-neutral-500">{t('dashboard.organization.sso.oidc_scopes_help')}</p>
                  </label>
                </div>
              )}
            </div>
          </SectionCard>

          {/* Sign-in rules */}
          <SectionCard
            icon={<ShieldCheck size={18} />}
            title={t('dashboard.developers.sso.rules_title')}
            description={t('dashboard.developers.sso.rules_description')}
          >
            <div className="flex flex-col divide-y divide-neutral-100">
              <SettingRow
                title={t('dashboard.organization.sso.enable_sso')}
                description={t('dashboard.organization.sso.enable_sso_desc')}
                control={
                  <Switch
                    checked={enabled}
                    onCheckedChange={setEnabled}
                    disabled={!selectedProviderInfo?.available}
                    aria-label={t('dashboard.organization.sso.enable_sso')}
                  />
                }
              />
              <div className="py-4">
                <label className="block">
                  <FieldLabel>{t('dashboard.organization.sso.allowed_domains')}</FieldLabel>
                  <input
                    id="domains"
                    dir="ltr"
                    className={`${INPUT} font-mono text-[13px]`}
                    value={domains}
                    onChange={(e) => setDomains(e.target.value)}
                    placeholder="example.com, company.org"
                  />
                  <p className="mt-1.5 text-xs text-neutral-500">{t('dashboard.organization.sso.allowed_domains_help')}</p>
                </label>
              </div>
              <SettingRow
                title={t('dashboard.organization.sso.auto_provision')}
                description={t('dashboard.organization.sso.auto_provision_desc')}
                control={
                  <Switch
                    checked={autoProvision}
                    onCheckedChange={setAutoProvision}
                    aria-label={t('dashboard.organization.sso.auto_provision')}
                  />
                }
              />
            </div>
          </SectionCard>
        </div>

        {/* One save for the whole page */}
        <div className="flex flex-wrap items-center justify-between gap-3 bg-white rounded-2xl nice-shadow px-5 py-3">
          <div>
            {config && (
              <Button variant="danger-ghost" onClick={() => setConfirmDelete(true)} icon={<Trash size={14} />}>
                {t('dashboard.organization.sso.delete')}
              </Button>
            )}
          </div>
          <Button
            variant="primary"
            onClick={handleSave}
            loading={isSaving}
            disabled={!selectedProviderInfo?.available}
          >
            {isSaving ? t('dashboard.organization.sso.saving') : t('dashboard.organization.sso.save')}
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t('dashboard.organization.sso.delete')}
        message={t('dashboard.organization.sso.delete_confirm')}
        confirmLabel={t('dashboard.organization.sso.delete')}
        onConfirm={handleDelete}
      />
    </FeatureGate>
  )
}

function InfoLine({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 text-xs text-neutral-500">
      <Info size={14} className="mt-px shrink-0 text-neutral-400" />
      {children}
    </p>
  )
}

export default OrgEditSSO
