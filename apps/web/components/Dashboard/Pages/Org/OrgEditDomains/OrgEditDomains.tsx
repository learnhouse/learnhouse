'use client'
import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { toast } from 'react-hot-toast'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowSquareOut,
  ArrowsClockwise,
  Check,
  CheckCircle,
  CircleNotch,
  Clock,
  Globe,
  Info,
  ListBullets,
  Plus,
  Shield,
  ShieldCheck,
  ShieldWarning,
  Trash,
  XCircle,
} from '@phosphor-icons/react'
import {
  CustomDomain,
  addCustomDomain,
  listCustomDomains,
  verifyCustomDomain,
  deleteCustomDomain,
  getVerificationInfo,
  checkSSLStatus,
  CustomDomainVerificationInfo,
  CustomDomainSSLStatus,
} from '@services/custom_domains/custom_domains'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import {
  Button,
  Chip,
  ConfirmDialog,
  EmptyState,
  FieldLabel,
  INPUT,
  formatRelative,
} from '@components/Dashboard/Shared/DashKit/DashKit'
import { CopyButton } from '@components/Dashboard/Pages/Org/Developers/devKit'
import FeatureGate from '@components/Dashboard/Shared/FeatureGate/FeatureGate'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'
import { useUpgradeModal } from '@components/Dashboard/Shared/PlanRestricted/UpgradeModalContext'
import { getErrorMessage } from '@services/utils/ts/errorMessage'

// Desktop table: header and rows are subgrids of the card grid.
const TABLE_GRID =
  'lg:grid lg:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,0.9fr)_auto] lg:gap-x-4'
const ROW_GRID = 'lg:col-span-full lg:grid lg:grid-cols-subgrid lg:items-center lg:gap-x-4'

const OrgEditDomains: React.FC = () => {
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const org = useOrg() as any
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const { track } = useLHAnalytics('dashboard')
  const { handlePlanLimit } = useUpgradeModal()
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
  const [isVerifyDialogOpen, setIsVerifyDialogOpen] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [selectedDomain, setSelectedDomain] = useState<CustomDomain | null>(null)
  const [verificationInfo, setVerificationInfo] = useState<CustomDomainVerificationInfo | null>(null)
  const [newDomain, setNewDomain] = useState('')
  const [isVerifying, setIsVerifying] = useState(false)
  const [sslStatuses, setSslStatuses] = useState<Record<string, CustomDomainSSLStatus>>({})
  const [sslLoading, setSslLoading] = useState<Record<string, boolean>>({})

  // Fetch domains
  const { data: domains, isLoading } = useQuery<CustomDomain[]>({
    queryKey: org?.id ? ['org', org.id, 'domains'] : ['domains-disabled'],
    queryFn: () => listCustomDomains(org.id, access_token),
    enabled: !!(org?.id && access_token),
    staleTime: 60_000,
  })

  const handleAddDomain = async () => {
    if (!newDomain.trim()) {
      toast.error(t('dashboard.organization.domains.domain_required'))
      return
    }

    const loadingToast = toast.loading(t('dashboard.organization.domains.adding_domain'))
    try {
      const response = await addCustomDomain(org.id, { domain: newDomain.trim() }, access_token)

      if (response.success) {
        track(AnalyticsEvent.CustomDomainAdded, { domain: newDomain.trim() })
        queryClient.invalidateQueries({ queryKey: ['org', org.id, 'domains'] })
        toast.success(t('dashboard.organization.domains.domain_added_success'), { id: loadingToast })
        setNewDomain('')
        setIsAddDialogOpen(false)
        // Open verification dialog
        setSelectedDomain(response.data)
        await loadVerificationInfo(response.data.domain_uuid)
        setIsVerifyDialogOpen(true)
      } else {
        // Custom domains are a paid/age-gated feature → offer an upgrade
        // instead of a dead-end error when the org can't add one yet.
        if (handlePlanLimit(response, { source: 'custom_domain_add', feature: 'custom_domains', requiredPlan: 'pro' })) {
          toast.dismiss(loadingToast)
          setIsAddDialogOpen(false)
        } else {
          toast.error(getErrorMessage(response.data?.detail, t('dashboard.organization.domains.failed_add')), { id: loadingToast })
        }
      }
    } catch (error: any) {
      toast.error(error.message || t('dashboard.organization.domains.failed_add'), { id: loadingToast })
    }
  }

  const loadVerificationInfo = async (domainUuid: string) => {
    try {
      const info = await getVerificationInfo(org.id, domainUuid, access_token)
      setVerificationInfo(info)
    } catch (error) {
      console.error('Failed to load verification info:', error)
    }
  }

  const handleVerifyDomain = async () => {
    if (!selectedDomain) return

    setIsVerifying(true)
    const loadingToast = toast.loading(t('dashboard.organization.domains.verifying_domain'))
    try {
      const response = await verifyCustomDomain(org.id, selectedDomain.domain_uuid, access_token)

      if (response.success) {
        track(AnalyticsEvent.CustomDomainVerified, { domain: selectedDomain.domain })
        queryClient.invalidateQueries({ queryKey: ['org', org.id, 'domains'] })
        toast.success(t('dashboard.organization.domains.domain_verified'), { id: loadingToast })
        setIsVerifyDialogOpen(false)
        setSelectedDomain(null)
        setVerificationInfo(null)
      } else {
        toast.error(response.data?.detail || t('dashboard.organization.domains.failed_verify'), { id: loadingToast })
      }
    } catch (error: any) {
      toast.error(error.message || t('dashboard.organization.domains.failed_verify'), { id: loadingToast })
    } finally {
      setIsVerifying(false)
    }
  }

  const handleDeleteDomain = async () => {
    if (!selectedDomain) return

    const loadingToast = toast.loading(t('dashboard.organization.domains.deleting_domain'))
    try {
      const response = await deleteCustomDomain(org.id, selectedDomain.domain_uuid, access_token)

      if (response.success) {
        queryClient.invalidateQueries({ queryKey: ['org', org.id, 'domains'] })
        toast.success(t('dashboard.organization.domains.domain_deleted_success'), { id: loadingToast })
        setIsDeleteDialogOpen(false)
        setSelectedDomain(null)
      } else {
        toast.error(response.data?.detail || t('dashboard.organization.domains.failed_delete'), { id: loadingToast })
      }
    } catch (error: any) {
      toast.error(error.message || t('dashboard.organization.domains.failed_delete'), { id: loadingToast })
    }
  }

  const handleCheckSSL = useCallback(async (domain: CustomDomain) => {
    setSslLoading((prev) => ({ ...prev, [domain.domain_uuid]: true }))
    try {
      const result = await checkSSLStatus(org.id, domain.domain_uuid, access_token)
      setSslStatuses((prev) => ({ ...prev, [domain.domain_uuid]: result }))
    } catch {
      setSslStatuses((prev) => ({
        ...prev,
        [domain.domain_uuid]: {
          has_ssl: false,
          status: 'unknown',
          message: t('dashboard.organization.domains.ssl_check_failed'),
        },
      }))
    } finally {
      setSslLoading((prev) => ({ ...prev, [domain.domain_uuid]: false }))
    }
  }, [org?.id, access_token, t])

  // Auto-check SSL for all verified domains on load and every 30s
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!domains || !access_token || !org?.id) return

    const verifiedDomains = domains.filter((d) => d.status === 'verified')
    if (verifiedDomains.length === 0) return

    const checkAll = () => {
      verifiedDomains.forEach((domain) => handleCheckSSL(domain))
    }

    // Initial check
    checkAll()

    // Poll every 30s
    intervalRef.current = setInterval(checkAll, 30000)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [domains, access_token, org?.id, handleCheckSSL])

  const [adding, setAdding] = useState(false)
  const [opening, setOpening] = useState<string | null>(null)

  const openRecords = async (domain: CustomDomain) => {
    setOpening(domain.domain_uuid)
    setSelectedDomain(domain)
    await loadVerificationInfo(domain.domain_uuid)
    setOpening(null)
    setIsVerifyDialogOpen(true)
  }

  const closeVerify = () => {
    setIsVerifyDialogOpen(false)
    setSelectedDomain(null)
    setVerificationInfo(null)
  }

  const getSSLBadge = (domain: CustomDomain) => {
    if (domain.status !== 'verified') {
      return <Chip icon={<Shield size={12} />}>{t('dashboard.organization.domains.not_available')}</Chip>
    }

    const sslStatus = sslStatuses[domain.domain_uuid]
    const loading = sslLoading[domain.domain_uuid]

    if (!sslStatus) {
      return (
        <Chip icon={loading ? <CircleNotch size={12} className="animate-spin" /> : <Shield size={12} />}>
          {t('dashboard.organization.domains.checking')}
        </Chip>
      )
    }

    switch (sslStatus.status) {
      case 'active':
        return (
          <Chip
            tone="emerald"
            icon={<ShieldCheck size={12} weight="fill" />}
            title={`${t('dashboard.organization.domains.issuer')}: ${sslStatus.issuer || t('common.unknown')}\n${t('dashboard.organization.domains.expires')}: ${sslStatus.expires || t('common.unknown')}`}
          >
            {t('dashboard.organization.domains.ssl_active')}
          </Chip>
        )
      case 'provisioning':
        return (
          <Chip tone="amber" icon={<CircleNotch size={12} className="animate-spin" />} title={sslStatus.message}>
            {t('dashboard.organization.domains.provisioning')}
          </Chip>
        )
      case 'invalid':
        return (
          <Chip tone="rose" icon={<ShieldWarning size={12} weight="fill" />} title={sslStatus.message}>
            {t('dashboard.organization.domains.invalid')}
          </Chip>
        )
      default:
        return (
          <Chip icon={<ShieldWarning size={12} />} title={sslStatus.message}>
            {t('common.unknown')}
          </Chip>
        )
    }
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'verified':
      case 'active':
        return (
          <Chip tone="emerald" icon={<CheckCircle size={12} weight="fill" />}>
            {t('dashboard.organization.domains.verified')}
          </Chip>
        )
      case 'pending':
        return (
          <Chip tone="amber" icon={<Clock size={12} weight="bold" />}>
            {t('dashboard.organization.domains.pending')}
          </Chip>
        )
      case 'failed':
        return (
          <Chip tone="rose" icon={<XCircle size={12} weight="fill" />}>
            {t('dashboard.organization.domains.failed')}
          </Chip>
        )
      default:
        return <Chip>{status}</Chip>
    }
  }

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return t('dashboard.organization.domains.never')
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return dateStr
    return new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(d)
  }

  const domainList = Array.isArray(domains) ? domains : []
  const selectedSsl = selectedDomain ? sslStatuses[selectedDomain.domain_uuid] : undefined

  return (
    <FeatureGate feature="custom_domains">
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-white nice-shadow text-neutral-600 flex items-center justify-center shrink-0">
              <Globe size={18} />
            </div>
            <p className="min-w-0 text-sm text-neutral-500">{t('dashboard.organization.domains.empty_description')}</p>
          </div>
          <Button variant="primary" icon={<Plus size={14} weight="bold" />} onClick={() => setIsAddDialogOpen(true)}>
            {t('dashboard.organization.domains.add_domain')}
          </Button>
        </div>

        <div className={`bg-white rounded-2xl nice-shadow overflow-hidden ${TABLE_GRID}`}>
          {(isLoading || domainList.length > 0) && (
            <div className={`hidden ${ROW_GRID} px-5 py-3 border-b border-neutral-100 text-xs font-medium text-neutral-500`}>
              <span>{t('dashboard.organization.domains.table_domain')}</span>
              <span>{t('dashboard.organization.domains.table_status')}</span>
              <span>{t('dashboard.organization.domains.table_ssl')}</span>
              <span>{t('dashboard.organization.domains.table_added')}</span>
              <span>{t('dashboard.organization.domains.table_verified')}</span>
              <span className="sr-only">{t('dashboard.organization.domains.table_actions')}</span>
            </div>
          )}

          {isLoading ? (
            <div className="animate-pulse divide-y divide-neutral-100 lg:col-span-full">
              {[1, 2].map((i) => (
                <div key={i} className="flex items-center gap-4 px-5 py-4">
                  <div className="h-4 bg-neutral-100 rounded w-48" />
                  <div className="h-6 w-20 bg-neutral-100 rounded-full" />
                  <div className="h-6 w-20 bg-neutral-100 rounded-full" />
                </div>
              ))}
            </div>
          ) : domainList.length === 0 ? (
            <div className="lg:col-span-full">
              <EmptyState
                icon={<Globe size={22} />}
                title={t('dashboard.organization.domains.no_domains_yet')}
                description={t('dashboard.organization.domains.add_first_domain')}
                action={
                  <Button variant="primary" icon={<Plus size={14} weight="bold" />} onClick={() => setIsAddDialogOpen(true)}>
                    {t('dashboard.organization.domains.add_domain')}
                  </Button>
                }
              />
            </div>
          ) : (
            <ul className={`divide-y divide-neutral-100 ${ROW_GRID}`}>
              {domainList.map((domain) => (
                <li key={domain.domain_uuid} className={`${ROW_GRID} px-5 py-3.5 flex flex-col gap-2 hover:bg-neutral-50/60 transition-colors`}>
                  <div className="flex items-center gap-2 min-w-0">
                    <Globe size={16} className="text-neutral-400 shrink-0" />
                    <code dir="ltr" className="font-mono text-[13px] font-medium text-neutral-900 truncate">{domain.domain}</code>
                    {domain.status === 'verified' && (
                      <a
                        href={`https://${domain.domain}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-neutral-400 hover:text-neutral-700 shrink-0"
                        aria-label={domain.domain}
                      >
                        <ArrowSquareOut size={14} />
                      </a>
                    )}
                    <CopyButton value={domain.domain} label={false} variant="ghost" />
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {getStatusBadge(domain.status)}
                    <span className="lg:hidden">{getSSLBadge(domain)}</span>
                  </div>
                  <div className="hidden lg:block">{getSSLBadge(domain)}</div>
                  <div className="text-xs text-neutral-600" title={formatDate(domain.creation_date)}>
                    <span className="lg:hidden text-neutral-400">{t('dashboard.organization.domains.table_added')}: </span>
                    {formatRelative(domain.creation_date, i18n.language) ?? '—'}
                  </div>
                  <div className="text-xs text-neutral-600">
                    <span className="lg:hidden text-neutral-400">{t('dashboard.organization.domains.table_verified')}: </span>
                    {domain.verified_at ? formatDate(domain.verified_at) : <span className="text-neutral-400">—</span>}
                  </div>
                  <div className="flex items-center gap-1 lg:justify-end">
                    {domain.status === 'pending' ? (
                      <Button
                        size="sm"
                        onClick={() => openRecords(domain)}
                        loading={opening === domain.domain_uuid}
                        icon={<ArrowsClockwise size={13} />}
                      >
                        {t('dashboard.organization.domains.verify')}
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openRecords(domain)}
                        loading={opening === domain.domain_uuid}
                        aria-label={t('dashboard.developers.domains.dns_records')}
                        title={t('dashboard.developers.domains.dns_records')}
                        icon={<ListBullets size={15} />}
                      />
                    )}
                    <Button
                      variant="danger-ghost"
                      size="icon"
                      onClick={() => {
                        setSelectedDomain(domain)
                        setIsDeleteDialogOpen(true)
                      }}
                      aria-label={t('dashboard.organization.domains.delete_domain')}
                      title={t('dashboard.organization.domains.delete_domain')}
                      icon={<Trash size={15} />}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Add domain */}
      <Modal
        isDialogOpen={isAddDialogOpen}
        onOpenChange={setIsAddDialogOpen}
        size="md"
        preventClose={adding}
        icon={<Globe size={16} />}
        dialogTitle={t('dashboard.organization.domains.add_custom_domain')}
        dialogDescription={t('dashboard.organization.domains.add_custom_domain_desc')}
        footer={
          <div className="flex justify-end gap-2">
            <Button onClick={() => setIsAddDialogOpen(false)} disabled={adding}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              loading={adding}
              onClick={async () => {
                setAdding(true)
                await handleAddDomain()
                setAdding(false)
              }}
            >
              {t('dashboard.organization.domains.add_domain')}
            </Button>
          </div>
        }
        dialogContent={
          <form
            onSubmit={async (e) => {
              e.preventDefault()
              setAdding(true)
              await handleAddDomain()
              setAdding(false)
            }}
          >
            <label className="block">
              <FieldLabel>{t('dashboard.organization.domains.domain_label')}</FieldLabel>
              <input
                autoFocus
                dir="ltr"
                className={`${INPUT} font-mono text-[13px]`}
                value={newDomain}
                onChange={(e) => setNewDomain(e.target.value)}
                placeholder={t('dashboard.organization.domains.domain_placeholder')}
              />
            </label>
            <p className="mt-2 text-xs text-neutral-500">{t('dashboard.organization.domains.domain_hint')}</p>
          </form>
        }
      />

      {/* DNS records / verification */}
      <Modal
        isDialogOpen={isVerifyDialogOpen}
        onOpenChange={(open) => (open ? setIsVerifyDialogOpen(true) : closeVerify())}
        size="lg"
        preventClose={isVerifying}
        icon={<ListBullets size={16} />}
        dialogTitle={
          selectedDomain?.status === 'pending'
            ? t('dashboard.organization.domains.verify_domain')
            : t('dashboard.developers.domains.dns_records')
        }
        dialogDescription={
          selectedDomain ? (
            <span className="font-mono" dir="ltr">
              {selectedDomain.domain}
            </span>
          ) : (
            t('dashboard.organization.domains.verify_domain_desc')
          )
        }
        footer={
          <div className="flex justify-end gap-2">
            <Button onClick={closeVerify} disabled={isVerifying}>
              {t('common.close')}
            </Button>
            {selectedDomain?.status !== 'verified' && (
              <Button variant="primary" onClick={handleVerifyDomain} loading={isVerifying} icon={<Check size={14} weight="bold" />}>
                {isVerifying ? t('dashboard.organization.domains.verifying') : t('dashboard.organization.domains.verify_dns')}
              </Button>
            )}
          </div>
        }
        dialogContent={
          <div className="flex flex-col gap-5">
            <div className="flex items-start gap-3 rounded-xl bg-sky-50 ring-1 ring-inset ring-sky-600/15 px-3.5 py-3">
              <Info size={18} weight="fill" className="text-sky-500 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-sky-900">{t('dashboard.organization.domains.dns_config_required')}</p>
                <p className="mt-0.5 text-xs text-sky-800/80">{t('dashboard.organization.domains.dns_config_description')}</p>
              </div>
            </div>

            {verificationInfo ? (
              <div className="rounded-xl ring-1 ring-inset ring-neutral-200/80 overflow-hidden">
                <div className="hidden sm:grid grid-cols-[5.5rem_minmax(0,1fr)_minmax(0,1.4fr)] gap-x-4 px-4 py-2.5 border-b border-neutral-100 text-xs font-medium text-neutral-500">
                  <span>{t('dashboard.developers.domains.type')}</span>
                  <span>{t('dashboard.organization.domains.host_name')}</span>
                  <span>{t('dashboard.organization.domains.value_target')}</span>
                </div>
                <div className="divide-y divide-neutral-100">
                  <DnsRecord
                    type="TXT"
                    purpose={t('dashboard.organization.domains.for_verification')}
                    host={verificationInfo.txt_record_host}
                    value={verificationInfo.txt_record_value}
                  />
                  <DnsRecord
                    type="CNAME"
                    purpose={t('dashboard.organization.domains.for_routing')}
                    host={verificationInfo.cname_record_host}
                    value={verificationInfo.cname_record_value}
                  />
                </div>
              </div>
            ) : (
              <div className="rounded-xl ring-1 ring-inset ring-neutral-200/80 p-4 animate-pulse space-y-3">
                <div className="h-4 bg-neutral-100 rounded w-2/3" />
                <div className="h-4 bg-neutral-100 rounded w-1/2" />
              </div>
            )}

            {/* SSL certificate status */}
            {selectedDomain && selectedDomain.status === 'verified' && (
              <div className="rounded-xl ring-1 ring-inset ring-neutral-200/80 px-4 py-3.5 flex flex-col gap-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <ShieldCheck size={16} className="text-neutral-500 shrink-0" />
                    <span className="text-sm font-semibold text-neutral-900">{t('dashboard.organization.domains.ssl_certificate')}</span>
                    <span className="text-xs text-neutral-400">{t('dashboard.organization.domains.https_status')}</span>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => handleCheckSSL(selectedDomain)}
                    loading={sslLoading[selectedDomain.domain_uuid]}
                    icon={<ArrowsClockwise size={13} />}
                  >
                    {t('dashboard.organization.domains.check')}
                  </Button>
                </div>
                {selectedSsl ? (
                  <div className="flex items-start gap-2.5">
                    {selectedSsl.has_ssl ? (
                      <ShieldCheck size={18} weight="fill" className="text-emerald-500 shrink-0" />
                    ) : selectedSsl.status === 'provisioning' ? (
                      <CircleNotch size={18} className="text-amber-500 shrink-0 animate-spin" />
                    ) : (
                      <ShieldWarning size={18} weight="fill" className="text-rose-500 shrink-0" />
                    )}
                    <div className="min-w-0">
                      <p className="text-sm text-neutral-800">{selectedSsl.message}</p>
                      {selectedSsl.has_ssl && (
                        <div className="mt-1 flex flex-wrap gap-x-4 text-xs text-neutral-500">
                          {selectedSsl.issuer && (
                            <span>
                              {t('dashboard.organization.domains.issuer')}: {selectedSsl.issuer}
                            </span>
                          )}
                          {selectedSsl.expires && (
                            <span>
                              {t('dashboard.organization.domains.expires')}: {selectedSsl.expires}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-sm text-neutral-500">
                    <CircleNotch size={14} className="animate-spin" />
                    {t('dashboard.organization.domains.checking_ssl')}
                  </div>
                )}
              </div>
            )}
          </div>
        }
      />

      <ConfirmDialog
        open={isDeleteDialogOpen}
        onOpenChange={(open) => {
          setIsDeleteDialogOpen(open)
          if (!open) setSelectedDomain(null)
        }}
        title={t('dashboard.organization.domains.delete_domain_title')}
        message={
          <>
            {t('dashboard.organization.domains.delete_domain_confirm')}
            {selectedDomain && (
              <span className="mt-3 flex items-center gap-2 rounded-lg bg-neutral-50 ring-1 ring-inset ring-neutral-200/70 px-3 py-2">
                <Globe size={14} className="text-neutral-400 shrink-0" />
                <code dir="ltr" className="font-mono text-xs text-neutral-800 truncate">{selectedDomain.domain}</code>
              </span>
            )}
          </>
        }
        confirmLabel={t('dashboard.organization.domains.delete_domain')}
        onConfirm={handleDeleteDomain}
      />
    </FeatureGate>
  )
}

// One DNS record: type, host and value, each copyable in mono.
function DnsRecord({ type, purpose, host, value }: { type: string; purpose: string; host: string; value: string }) {
  const { t } = useTranslation()
  return (
    <div className="grid grid-cols-1 sm:grid-cols-[5.5rem_minmax(0,1fr)_minmax(0,1.4fr)] gap-x-4 gap-y-2 px-4 py-3 sm:items-center">
      <div>
        <span className="inline-flex items-center h-5 px-1.5 rounded-md bg-neutral-900 text-white font-mono text-[10.5px] font-bold tracking-wide">
          {type}
        </span>
        <p className="mt-1 text-[11px] text-neutral-400">{purpose}</p>
      </div>
      <DnsValue label={t('dashboard.organization.domains.host_name')} value={host} />
      <DnsValue label={t('dashboard.organization.domains.value_target')} value={value} />
    </div>
  )
}

function DnsValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <span className="sm:hidden block mb-1 text-[11px] font-medium text-neutral-400">{label}</span>
      <div className="flex items-center gap-1 rounded-lg bg-neutral-50 ring-1 ring-inset ring-neutral-200/80 ps-2.5 pe-1 py-1 min-w-0">
        <code dir="ltr" className="flex-1 min-w-0 font-mono text-[12px] text-neutral-800 break-all">
          {value}
        </code>
        <CopyButton value={value} label={false} variant="ghost" />
      </div>
    </div>
  )
}

export default OrgEditDomains
