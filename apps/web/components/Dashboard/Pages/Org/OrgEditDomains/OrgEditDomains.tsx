'use client'
import React, { useState } from 'react'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { toast } from 'react-hot-toast'
import { Button } from '@components/ui/button'
import { getAPIUrl } from '@services/config/config'
import useSWR, { mutate } from 'swr'
import { swrFetcher } from '@services/utils/ts/requests'
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
} from 'lucide-react'
import {
  CustomDomain,
  addCustomDomain,
  verifyCustomDomain,
  deleteCustomDomain,
  getVerificationInfo,
  CustomDomainVerificationInfo,
} from '@services/custom_domains/custom_domains'
import PlanRestrictedFeature from '@components/Dashboard/Shared/PlanRestricted/PlanRestrictedFeature'
import { PlanLevel } from '@services/plans/plans'

const OrgEditDomains: React.FC = () => {
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const org = useOrg() as any
  const currentPlan: PlanLevel = org?.config?.config?.cloud?.plan || 'free'

  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
  const [isVerifyDialogOpen, setIsVerifyDialogOpen] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [selectedDomain, setSelectedDomain] = useState<CustomDomain | null>(null)
  const [verificationInfo, setVerificationInfo] = useState<CustomDomainVerificationInfo | null>(null)
  const [newDomain, setNewDomain] = useState('')
  const [copiedField, setCopiedField] = useState<string | null>(null)
  const [isVerifying, setIsVerifying] = useState(false)

  // Fetch domains
  const domainsUrl = org?.id ? `${getAPIUrl()}orgs/${org.id}/domains` : null
  const { data: domains, isLoading } = useSWR<CustomDomain[]>(
    domainsUrl,
    (url: string) => swrFetcher(url, access_token)
  )

  const handleAddDomain = async () => {
    if (!newDomain.trim()) {
      toast.error('Domain is required')
      return
    }

    const loadingToast = toast.loading('Adding domain...')
    try {
      const response = await addCustomDomain(org.id, { domain: newDomain.trim() }, access_token)

      if (response.success) {
        mutate(domainsUrl)
        toast.success('Domain added successfully', { id: loadingToast })
        setNewDomain('')
        setIsAddDialogOpen(false)
        // Open verification dialog
        setSelectedDomain(response.data)
        await loadVerificationInfo(response.data.domain_uuid)
        setIsVerifyDialogOpen(true)
      } else {
        toast.error(response.data?.detail || 'Failed to add domain', { id: loadingToast })
      }
    } catch (error: any) {
      toast.error(error.message || 'Failed to add domain', { id: loadingToast })
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
    const loadingToast = toast.loading('Verifying domain...')
    try {
      const response = await verifyCustomDomain(org.id, selectedDomain.domain_uuid, access_token)

      if (response.success) {
        mutate(domainsUrl)
        toast.success('Domain verified successfully!', { id: loadingToast })
        setIsVerifyDialogOpen(false)
        setSelectedDomain(null)
        setVerificationInfo(null)
      } else {
        toast.error(response.data?.detail || 'Verification failed', { id: loadingToast })
      }
    } catch (error: any) {
      toast.error(error.message || 'Verification failed', { id: loadingToast })
    } finally {
      setIsVerifying(false)
    }
  }

  const handleDeleteDomain = async () => {
    if (!selectedDomain) return

    const loadingToast = toast.loading('Deleting domain...')
    try {
      const response = await deleteCustomDomain(org.id, selectedDomain.domain_uuid, access_token)

      if (response.success) {
        mutate(domainsUrl)
        toast.success('Domain deleted successfully', { id: loadingToast })
        setIsDeleteDialogOpen(false)
        setSelectedDomain(null)
      } else {
        toast.error(response.data?.detail || 'Failed to delete domain', { id: loadingToast })
      }
    } catch (error: any) {
      toast.error(error.message || 'Failed to delete domain', { id: loadingToast })
    }
  }

  const copyToClipboard = async (text: string, field: string) => {
    await navigator.clipboard.writeText(text)
    setCopiedField(field)
    toast.success('Copied to clipboard')
    setTimeout(() => setCopiedField(null), 2000)
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'verified':
        return (
          <Badge className="bg-green-100 text-green-800">
            <CheckCircle2 size={12} className="mr-1" />
            Verified
          </Badge>
        )
      case 'pending':
        return (
          <Badge className="bg-yellow-100 text-yellow-800">
            <Clock size={12} className="mr-1" />
            Pending
          </Badge>
        )
      case 'failed':
        return (
          <Badge className="bg-red-100 text-red-800">
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
    <PlanRestrictedFeature
      currentPlan={currentPlan}
      requiredPlan="pro"
      icon={Globe}
      titleKey="common.plans.feature_restricted.custom_domains.title"
      descriptionKey="common.plans.feature_restricted.custom_domains.description"
    >
      <>
        <div className="sm:mx-10 mx-0 bg-white rounded-xl nice-shadow pt-3">
          <div className="flex flex-col gap-0">
            <div className="flex flex-col bg-gray-50 -space-y-1 px-5 py-3 mx-3 mb-3 rounded-md">
              <h1 className="font-bold text-xl text-gray-800">Custom Domains</h1>
              <h2 className="text-gray-500 text-md">
                Configure custom domains to access your organization
              </h2>
            </div>

            <div className="px-5 pb-4">
              <div className="flex justify-between items-center mb-4">
                <p className="text-sm text-gray-600">
                  Add your own domain to provide a branded experience for your learners.
                </p>
                <Button
                  onClick={() => setIsAddDialogOpen(true)}
                  className="bg-black text-white hover:bg-black/90"
                >
                  <Plus size={16} className="mr-2" />
                  Add Domain
                </Button>
              </div>

              {isLoading ? (
                <div className="flex justify-center py-8">
                  <RefreshCw className="animate-spin text-gray-400" size={24} />
                </div>
              ) : domains && domains.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Domain</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Added</TableHead>
                      <TableHead>Verified</TableHead>
                      <TableHead>Actions</TableHead>
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
                  <p>No custom domains yet</p>
                  <p className="text-sm">Add your first domain to get started</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Add Domain Dialog */}
        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogContent>
            <DialogHeader className="px-6 pt-6">
              <DialogTitle>Add Custom Domain</DialogTitle>
              <DialogDescription>
                Enter the domain you want to use for your organization.
              </DialogDescription>
            </DialogHeader>
            <div className="px-6 pb-6 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="domain">Domain</Label>
                <Input
                  id="domain"
                  value={newDomain}
                  onChange={(e) => setNewDomain(e.target.value)}
                  placeholder="learn.mycompany.com"
                />
                <p className="text-xs text-gray-500">
                  Enter a domain or subdomain (e.g., learn.mycompany.com or academy.example.org)
                </p>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleAddDomain}>Add Domain</Button>
              </DialogFooter>
            </div>
          </DialogContent>
        </Dialog>

        {/* Verify Domain Dialog */}
        <Dialog open={isVerifyDialogOpen} onOpenChange={setIsVerifyDialogOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader className="px-6 pt-6">
              <DialogTitle>Verify Domain</DialogTitle>
              <DialogDescription>
                Add the following DNS records at your domain provider to verify ownership.
              </DialogDescription>
            </DialogHeader>
            <div className="px-6 pb-6 space-y-4">
              {verificationInfo && (
                <>
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="text-blue-600 flex-shrink-0 mt-0.5" size={20} />
                      <div>
                        <p className="font-medium text-blue-800">DNS Configuration Required</p>
                        <p className="text-sm text-blue-700">
                          Add these records at your domain registrar (e.g., Cloudflare, GoDaddy, Namecheap).
                          DNS changes may take up to 48 hours to propagate.
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* TXT Record */}
                  <div className="border rounded-lg p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">TXT Record</Badge>
                      <span className="text-sm text-gray-500">For verification</span>
                    </div>
                    <div className="space-y-2">
                      <div>
                        <Label className="text-xs text-gray-500">Host / Name</Label>
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
                        <Label className="text-xs text-gray-500">Value</Label>
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
                      <Badge variant="outline">CNAME Record</Badge>
                      <span className="text-sm text-gray-500">For routing</span>
                    </div>
                    <div className="space-y-2">
                      <div>
                        <Label className="text-xs text-gray-500">Host / Name</Label>
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
                        <Label className="text-xs text-gray-500">Value / Target</Label>
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
                      Verifying...
                    </>
                  ) : (
                    <>
                      <Check size={16} className="mr-2" />
                      Verify DNS
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
                Delete Custom Domain
              </DialogTitle>
              <DialogDescription>
                Are you sure you want to delete this domain? This action cannot be undone.
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
                  Delete Domain
                </Button>
              </DialogFooter>
            </div>
          </DialogContent>
        </Dialog>
      </>
    </PlanRestrictedFeature>
  )
}

export default OrgEditDomains
