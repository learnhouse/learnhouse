'use client'
import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { toast } from 'react-hot-toast'
import { Button } from '@components/ui/button'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@components/ui/dialog'
import { Input } from '@components/ui/input'
import { Label } from '@components/ui/label'
import { Badge } from '@components/ui/badge'
import {
  Globe,
  Plus,
  Copy,
  Trash2,
  RefreshCw,
  Check,
  AlertTriangle,
  ExternalLink,
  CheckCircle2,
  Clock,
  XCircle,
  ShieldCheck,
  ShieldAlert,
  Shield,
  Loader2,
} from 'lucide-react'
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
import FeatureGate from '@components/Dashboard/Shared/FeatureGate/FeatureGate'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'

const OrgEditDomains: React.FC = () => {
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const org = useOrg() as any
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { track } = useLHAnalytics('dashboard')
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
  const [isVerifyDialogOpen, setIsVerifyDialogOpen] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [selectedDomain, setSelectedDomain] = useState<CustomDomain | null>(null)
  const [verificationInfo, setVerificationInfo] = useState<CustomDomainVerificationInfo | null>(null)
  const [newDomain, setNewDomain] = useState('')
  const [copiedField, setCopiedField] = useState<string | null>(null)
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
        toast.error(response.data?.detail || t('dashboard.organization.domains.failed_add'), { id: loadingToast })
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

  const copyToClipboard = async (text: string, field: string) => {
    await navigator.clipboard.writeText(text)
    setCopiedField(field)
    toast.success(t('dashboard.organization.domains.copied_to_clipboard'))
    setTimeout(() => setCopiedField(null), 2000)
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
          message: 'Could not check SSL status.',
        },
      }))
    } finally {
      setSslLoading((prev) => ({ ...prev, [domain.domain_uuid]: false }))
    }
  }, [org?.id, access_token])

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

  const getSSLBadge = (domain: CustomDomain) => {
    if (domain.status !== 'verified') {
      return (
        <Badge variant="outline" className="border-transparent bg-gray-100 text-gray-500">
          <Shield size={12} className="mr-1" />
          N/A
        </Badge>
      )
    }

    const sslStatus = sslStatuses[domain.domain_uuid]
    const loading = sslLoading[domain.domain_uuid]

    if (loading && !sslStatus) {
      return (
        <Badge variant="outline" className="border-transparent bg-gray-100 text-gray-600">
          <Loader2 size={12} className="mr-1 animate-spin" />
          Checking...
        </Badge>
      )
    }

    if (!sslStatus) {
      return (
        <Badge variant="outline" className="border-transparent bg-gray-100 text-gray-500">
          <Shield size={12} className="mr-1" />
          Checking...
        </Badge>
      )
    }

    switch (sslStatus.status) {
      case 'active':
        return (
          <Badge variant="outline" className="border-transparent bg-green-100 text-green-800" title={`Issuer: ${sslStatus.issuer || 'Unknown'}\nExpires: ${sslStatus.expires || 'Unknown'}`}>
            <ShieldCheck size={12} className="mr-1" />
            {t('dashboard.organization.domains.ssl_active')}
          </Badge>
        )
      case 'provisioning':
        return (
          <Badge variant="outline" className="border-transparent bg-yellow-100 text-yellow-800" title={sslStatus.message}>
            <Loader2 size={12} className="mr-1 animate-spin" />
            Provisioning
          </Badge>
        )
      case 'invalid':
        return (
          <Badge variant="outline" className="border-transparent bg-red-100 text-red-800" title={sslStatus.message}>
            <ShieldAlert size={12} className="mr-1" />
            Invalid
          </Badge>
        )
      default:
        return (
          <Badge variant="outline" className="border-transparent bg-gray-100 text-gray-600" title={sslStatus.message}>
            <ShieldAlert size={12} className="mr-1" />
            Unknown
          </Badge>
        )
    }
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'verified':
        return (
          <Badge variant="outline" className="border-transparent bg-green-100 text-green-800">
            <CheckCircle2 size={12} className="mr-1" />
            Verified
          </Badge>
        )
      case 'pending':
        return (
          <Badge variant="outline" className="border-transparent bg-yellow-100 text-yellow-800">
            <Clock size={12} className="mr-1" />
            Pending
          </Badge>
        )
      case 'failed':
        return (
          <Badge variant="outline" className="border-transparent bg-red-100 text-red-800">
            <XCircle size={12} className="mr-1" />
            Failed
          </Badge>
        )
      default:
        return (
          <Badge variant="secondary">
            {status}
          </Badge>
        )
    }
  }

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'Never'
    try {
      return new Date(dateStr).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    } catch {
      return dateStr
    }
  }

  return (
    <FeatureGate feature="custom_domains">
      <>
        <div className="sm:mx-10 mx-0 bg-white rounded-xl nice-shadow pt-3">
          <div className="flex flex-col gap-0">
            <div className="flex flex-col bg-gray-50 -space-y-1 px-5 py-3 mx-3 mb-3 rounded-md">
              <h1 className="font-bold text-xl text-gray-800">{t('dashboard.organization.domains.title')}</h1>
              <h2 className="text-gray-500 text-md">
                {t('dashboard.organization.domains.subtitle')}
              </h2>
            </div>

            <div className="px-5 pb-4">
              <div className="flex justify-between items-center mb-4">
                <p className="text-sm text-gray-600">
                  {t('dashboard.organization.domains.empty_description')}
                </p>
                <Button
                  onClick={() => setIsAddDialogOpen(true)}
                  className="bg-black text-white hover:bg-black/90"
                >
                  <Plus size={16} className="mr-2" />
                  {t('dashboard.organization.domains.add_domain')}
                </Button>
              </div>

              {isLoading ? (
                <div className="animate-pulse space-y-2">
                  <div className="h-9 bg-gray-100 rounded w-full" />
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="flex gap-4 px-4 py-3 border-b border-gray-100">
                      <div className="h-4 bg-gray-100 rounded w-40" />
                      <div className="h-4 bg-gray-100 rounded w-20" />
                      <div className="h-4 bg-gray-100 rounded w-20" />
                      <div className="h-4 bg-gray-100 rounded w-28" />
                      <div className="h-4 bg-gray-100 rounded w-28" />
                      <div className="h-4 bg-gray-100 rounded w-24" />
                    </div>
                  ))}
                </div>
              ) : domains && domains.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('dashboard.organization.domains.table_domain')}</TableHead>
                      <TableHead>{t('dashboard.organization.domains.table_status')}</TableHead>
                      <TableHead>{t('dashboard.organization.domains.table_ssl')}</TableHead>
                      <TableHead>{t('dashboard.organization.domains.table_added')}</TableHead>
                      <TableHead>{t('dashboard.organization.domains.table_verified')}</TableHead>
                      <TableHead>{t('dashboard.organization.domains.table_actions')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {domains.map((domain) => (
                      <TableRow key={domain.domain_uuid}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Globe size={16} className="text-gray-400" />
                            <span className="font-medium">{domain.domain}</span>
                            {domain.status === 'verified' && (
                              <a
                                href={`https://${domain.domain}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-gray-400 hover:text-gray-600"
                              >
                                <ExternalLink size={14} />
                              </a>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>{getStatusBadge(domain.status)}</TableCell>
                        <TableCell>{getSSLBadge(domain)}</TableCell>
                        <TableCell className="text-sm text-gray-600">
                          {formatDate(domain.creation_date)}
                        </TableCell>
                        <TableCell className="text-sm text-gray-600">
                          {domain.verified_at ? formatDate(domain.verified_at) : '-'}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-2">
                            {domain.status === 'pending' && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={async () => {
                                  setSelectedDomain(domain)
                                  await loadVerificationInfo(domain.domain_uuid)
                                  setIsVerifyDialogOpen(true)
                                }}
                              >
                                <RefreshCw size={14} className="mr-1" />
                                Verify
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-red-600 hover:text-red-700"
                              onClick={() => {
                                setSelectedDomain(domain)
                                setIsDeleteDialogOpen(true)
                              }}
                            >
                              <Trash2 size={16} />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="text-center py-12 text-gray-500">
                  <Globe size={48} className="mx-auto mb-4 opacity-50" />
                  <p>{t('dashboard.organization.domains.no_domains_yet')}</p>
                  <p className="text-sm">{t('dashboard.organization.domains.add_first_domain')}</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Add Domain Dialog */}
        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogContent>
            <DialogHeader className="px-6 pt-6">
              <DialogTitle>{t('dashboard.organization.domains.add_custom_domain')}</DialogTitle>
              <DialogDescription>
                {t('dashboard.organization.domains.add_custom_domain_desc')}
              </DialogDescription>
            </DialogHeader>
            <div className="px-6 pb-6 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="domain">{t('dashboard.organization.domains.domain_label')}</Label>
                <Input
                  id="domain"
                  value={newDomain}
                  onChange={(e) => setNewDomain(e.target.value)}
                  placeholder="learn.mycompany.com"
                />
                <p className="text-xs text-gray-500">
                  {t('dashboard.organization.domains.domain_hint')}
                </p>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
                  {t('common.cancel')}
                </Button>
                <Button onClick={handleAddDomain}>{t('dashboard.organization.domains.add_domain')}</Button>
              </DialogFooter>
            </div>
          </DialogContent>
        </Dialog>

        {/* Verify Domain Dialog */}
        <Dialog open={isVerifyDialogOpen} onOpenChange={setIsVerifyDialogOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader className="px-6 pt-6">
              <DialogTitle>{t('dashboard.organization.domains.verify_domain')}</DialogTitle>
              <DialogDescription>
                {t('dashboard.organization.domains.verify_domain_desc')}
              </DialogDescription>
            </DialogHeader>
            <div className="px-6 pb-6 space-y-4">
              {verificationInfo && (
                <>
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="text-blue-600 flex-shrink-0 mt-0.5" size={20} />
                      <div>
                        <p className="font-medium text-blue-800">{t('dashboard.organization.domains.dns_config_required')}</p>
                        <p className="text-sm text-blue-700">
                          {t('dashboard.organization.domains.dns_config_description')}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* TXT Record */}
                  <div className="border rounded-lg p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{t('dashboard.organization.domains.txt_record')}</Badge>
                      <span className="text-sm text-gray-500">{t('dashboard.organization.domains.for_verification')}</span>
                    </div>
                    <div className="space-y-2">
                      <div>
                        <Label className="text-xs text-gray-500">{t('dashboard.organization.domains.host_name')}</Label>
                        <div className="flex gap-2 mt-1">
                          <code className="flex-1 bg-gray-100 px-3 py-2 rounded text-sm break-all">
                            {verificationInfo.txt_record_host}
                          </code>
                          <Button
                            variant="outline"
                            size="icon"
                            onClick={() => copyToClipboard(verificationInfo.txt_record_host, 'txt_host')}
                          >
                            {copiedField === 'txt_host' ? <Check size={16} className="text-green-600" /> : <Copy size={16} />}
                          </Button>
                        </div>
                      </div>
                      <div>
                        <Label className="text-xs text-gray-500">{t('dashboard.organization.domains.value')}</Label>
                        <div className="flex gap-2 mt-1">
                          <code className="flex-1 bg-gray-100 px-3 py-2 rounded text-sm break-all">
                            {verificationInfo.txt_record_value}
                          </code>
                          <Button
                            variant="outline"
                            size="icon"
                            onClick={() => copyToClipboard(verificationInfo.txt_record_value, 'txt_value')}
                          >
                            {copiedField === 'txt_value' ? <Check size={16} className="text-green-600" /> : <Copy size={16} />}
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* CNAME Record */}
                  <div className="border rounded-lg p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{t('dashboard.organization.domains.cname_record')}</Badge>
                      <span className="text-sm text-gray-500">{t('dashboard.organization.domains.for_routing')}</span>
                    </div>
                    <div className="space-y-2">
                      <div>
                        <Label className="text-xs text-gray-500">{t('dashboard.organization.domains.host_name')}</Label>
                        <div className="flex gap-2 mt-1">
                          <code className="flex-1 bg-gray-100 px-3 py-2 rounded text-sm break-all">
                            {verificationInfo.cname_record_host}
                          </code>
                          <Button
                            variant="outline"
                            size="icon"
                            onClick={() => copyToClipboard(verificationInfo.cname_record_host, 'cname_host')}
                          >
                            {copiedField === 'cname_host' ? <Check size={16} className="text-green-600" /> : <Copy size={16} />}
                          </Button>
                        </div>
                      </div>
                      <div>
                        <Label className="text-xs text-gray-500">{t('dashboard.organization.domains.value_target')}</Label>
                        <div className="flex gap-2 mt-1">
                          <code className="flex-1 bg-gray-100 px-3 py-2 rounded text-sm break-all">
                            {verificationInfo.cname_record_value}
                          </code>
                          <Button
                            variant="outline"
                            size="icon"
                            onClick={() => copyToClipboard(verificationInfo.cname_record_value, 'cname_value')}
                          >
                            {copiedField === 'cname_value' ? <Check size={16} className="text-green-600" /> : <Copy size={16} />}
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* SSL Certificate Status */}
                  {selectedDomain && selectedDomain.status === 'verified' && (
                    <div className="border rounded-lg p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">{t('dashboard.organization.domains.ssl_certificate')}</Badge>
                          <span className="text-sm text-gray-500">{t('dashboard.organization.domains.https_status')}</span>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleCheckSSL(selectedDomain)}
                          disabled={sslLoading[selectedDomain.domain_uuid]}
                        >
                          {sslLoading[selectedDomain.domain_uuid] ? (
                            <Loader2 size={14} className="mr-1 animate-spin" />
                          ) : (
                            <RefreshCw size={14} className="mr-1" />
                          )}
                          Check
                        </Button>
                      </div>
                      {sslStatuses[selectedDomain.domain_uuid] ? (
                        <div className={`rounded-lg p-3 ${
                          sslStatuses[selectedDomain.domain_uuid].has_ssl
                            ? 'bg-green-50 border border-green-200'
                            : sslStatuses[selectedDomain.domain_uuid].status === 'provisioning'
                            ? 'bg-yellow-50 border border-yellow-200'
                            : 'bg-red-50 border border-red-200'
                        }`}>
                          <div className="flex items-start gap-2">
                            {sslStatuses[selectedDomain.domain_uuid].has_ssl ? (
                              <ShieldCheck size={18} className="text-green-600 flex-shrink-0 mt-0.5" />
                            ) : sslStatuses[selectedDomain.domain_uuid].status === 'provisioning' ? (
                              <Loader2 size={18} className="text-yellow-600 flex-shrink-0 mt-0.5 animate-spin" />
                            ) : (
                              <ShieldAlert size={18} className="text-red-600 flex-shrink-0 mt-0.5" />
                            )}
                            <div>
                              <p className={`text-sm font-medium ${
                                sslStatuses[selectedDomain.domain_uuid].has_ssl
                                  ? 'text-green-800'
                                  : sslStatuses[selectedDomain.domain_uuid].status === 'provisioning'
                                  ? 'text-yellow-800'
                                  : 'text-red-800'
                              }`}>
                                {sslStatuses[selectedDomain.domain_uuid].message}
                              </p>
                              {sslStatuses[selectedDomain.domain_uuid].has_ssl && (
                                <div className="text-xs text-green-700 mt-1 space-y-0.5">
                                  {sslStatuses[selectedDomain.domain_uuid].issuer && (
                                    <p>{t('dashboard.organization.domains.issuer')}: {sslStatuses[selectedDomain.domain_uuid].issuer}</p>
                                  )}
                                  {sslStatuses[selectedDomain.domain_uuid].expires && (
                                    <p>{t('dashboard.organization.domains.expires')}: {sslStatuses[selectedDomain.domain_uuid].expires}</p>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 text-sm text-gray-500">
                          <Loader2 size={14} className="animate-spin" />
                          {t('dashboard.organization.domains.checking_ssl')}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}

              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => {
                    setIsVerifyDialogOpen(false)
                    setSelectedDomain(null)
                    setVerificationInfo(null)
                  }}
                >
                  Close
                </Button>
                <Button onClick={handleVerifyDomain} disabled={isVerifying}>
                  {isVerifying ? (
                    <>
                      <RefreshCw size={16} className="mr-2 animate-spin" />
                      {t('dashboard.organization.domains.verifying')}
                    </>
                  ) : (
                    <>
                      <Check size={16} className="mr-2" />
                      {t('dashboard.organization.domains.verify_dns')}
                    </>
                  )}
                </Button>
              </DialogFooter>
            </div>
          </DialogContent>
        </Dialog>

        {/* Delete Domain Dialog */}
        <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
          <DialogContent>
            <DialogHeader className="px-6 pt-6">
              <DialogTitle className="flex items-center gap-2 text-red-600">
                <AlertTriangle size={20} />
                {t('dashboard.organization.domains.delete_domain_title')}
              </DialogTitle>
              <DialogDescription>
                {t('dashboard.organization.domains.delete_domain_confirm')}
              </DialogDescription>
            </DialogHeader>
            <div className="px-6 pb-6">
              {selectedDomain && (
                <div className="bg-gray-50 rounded-lg p-3 mb-4">
                  <div className="flex items-center gap-2">
                    <Globe size={16} className="text-gray-400" />
                    <span className="font-medium">{selectedDomain.domain}</span>
                  </div>
                </div>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsDeleteDialogOpen(false)}>
                  Cancel
                </Button>
                <Button variant="destructive" onClick={handleDeleteDomain}>
                  {t('dashboard.organization.domains.delete_domain')}
                </Button>
              </DialogFooter>
            </div>
          </DialogContent>
        </Dialog>
      </>
    </FeatureGate>
  )
}

export default OrgEditDomains
