'use client'
import React, { useState } from 'react'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { toast } from 'react-hot-toast'
import { Button } from '@components/ui/button'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
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
import { Textarea } from '@components/ui/textarea'
import { Label } from '@components/ui/label'
import { Switch } from '@components/ui/switch'
import { Badge } from '@components/ui/badge'
import {
  Key,
  Plus,
  Copy,
  Trash2,
  RefreshCw,
  Eye,
  EyeOff,
  AlertTriangle,
  Check,
  BookOpen,
  LifeBuoy,
} from 'lucide-react'
import {
  APIToken,
  APITokenCreateRequest,
  APITokenRights,
  createAPIToken,
  getDefaultRights,
  getFullRights,
  getReadOnlyRights,
  listAPITokens,
  regenerateAPIToken,
  revokeAPIToken,
} from '@services/api_tokens/api_tokens'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@components/ui/tabs'
import APIDocumentation from './APIDocumentation'
import FeatureGate from '@components/Dashboard/Shared/FeatureGate/FeatureGate'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'

const OrgEditAPIAccess: React.FC = () => {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const org = useOrg() as any
  const queryClient = useQueryClient()
  const { track } = useLHAnalytics('dashboard')
  const [activeTab, setActiveTab] = useState('tokens')
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false)
  const [isRevokeDialogOpen, setIsRevokeDialogOpen] = useState(false)
  const [isRegenerateDialogOpen, setIsRegenerateDialogOpen] = useState(false)
  const [selectedToken, setSelectedToken] = useState<APIToken | null>(null)
  const [newTokenValue, setNewTokenValue] = useState<string | null>(null)
  const [showTokenValue, setShowTokenValue] = useState(false)
  const [copiedToken, setCopiedToken] = useState(false)

  // Create token form state
  const [tokenName, setTokenName] = useState('')
  const [tokenDescription, setTokenDescription] = useState('')
  const [tokenExpiry, setTokenExpiry] = useState('')
  const [tokenRights, setTokenRights] = useState<APITokenRights>(getDefaultRights())
  const [rightsPreset, setRightsPreset] = useState<'custom' | 'readonly' | 'full'>('readonly')

  // Fetch tokens
  const { data: tokens, isLoading } = useQuery<APIToken[]>({
    queryKey: org?.id ? ['org', org.id, 'api-tokens'] : ['api-tokens-disabled'],
    queryFn: () => listAPITokens(org.id, access_token),
    enabled: !!(org?.id && access_token),
    staleTime: 60_000,
  })

  const handleCreateToken = async () => {
    if (!tokenName.trim()) {
      toast.error(t('dashboard.organization.api_access.toasts.name_required'))
      return
    }

    const loadingToast = toast.loading(t('dashboard.organization.api_access.toasts.creating'))
    try {
      const data: APITokenCreateRequest = {
        name: tokenName.trim(),
        description: tokenDescription.trim() || null,
        rights: tokenRights,
        expires_at: tokenExpiry || null,
      }

      const response = await createAPIToken(org.id, data, access_token)

      if (response.success) {
        setNewTokenValue(response.data.token)
        setShowTokenValue(true)
        track(AnalyticsEvent.ApiTokenCreated, {
          rights_preset: rightsPreset,
          has_expiry: !!tokenExpiry,
        })
        queryClient.invalidateQueries({ queryKey: ['org', org.id, 'api-tokens'] })
        toast.success(t('dashboard.organization.api_access.toasts.created'), { id: loadingToast })
        // Reset form
        setTokenName('')
        setTokenDescription('')
        setTokenExpiry('')
        setTokenRights(getDefaultRights())
        setRightsPreset('readonly')
      } else {
        toast.error(response.data?.detail || t('dashboard.organization.api_access.toasts.create_failed'), { id: loadingToast })
      }
    } catch (error: any) {
      toast.error(error.message || t('dashboard.organization.api_access.toasts.create_failed'), { id: loadingToast })
    }
  }

  const handleRevokeToken = async () => {
    if (!selectedToken) return

    const loadingToast = toast.loading(t('dashboard.organization.api_access.toasts.revoking'))
    try {
      const response = await revokeAPIToken(org.id, selectedToken.token_uuid, access_token)

      if (response.success) {
        queryClient.invalidateQueries({ queryKey: ['org', org.id, 'api-tokens'] })
        toast.success(t('dashboard.organization.api_access.toasts.revoked'), { id: loadingToast })
        setIsRevokeDialogOpen(false)
        setSelectedToken(null)
      } else {
        toast.error(response.data?.detail || t('dashboard.organization.api_access.toasts.revoke_failed'), { id: loadingToast })
      }
    } catch (error: any) {
      toast.error(error.message || t('dashboard.organization.api_access.toasts.revoke_failed'), { id: loadingToast })
    }
  }

  const handleRegenerateToken = async () => {
    if (!selectedToken) return

    const loadingToast = toast.loading(t('dashboard.organization.api_access.toasts.regenerating'))
    try {
      const response = await regenerateAPIToken(org.id, selectedToken.token_uuid, access_token)

      if (response.success) {
        setNewTokenValue(response.data.token)
        setShowTokenValue(true)
        queryClient.invalidateQueries({ queryKey: ['org', org.id, 'api-tokens'] })
        toast.success(t('dashboard.organization.api_access.toasts.regenerated'), { id: loadingToast })
        // Don't close the dialog here - keep it open to show the new token
      } else {
        toast.error(response.data?.detail || t('dashboard.organization.api_access.toasts.regenerate_failed'), { id: loadingToast })
      }
    } catch (error: any) {
      toast.error(error.message || t('dashboard.organization.api_access.toasts.regenerate_failed'), { id: loadingToast })
    }
  }

  const copyToClipboard = async (text: string) => {
    await navigator.clipboard.writeText(text)
    setCopiedToken(true)
    toast.success(t('dashboard.organization.api_access.toasts.copied'))
    setTimeout(() => setCopiedToken(false), 2000)
  }

  const handlePresetChange = (preset: 'custom' | 'readonly' | 'full') => {
    setRightsPreset(preset)
    if (preset === 'readonly') {
      setTokenRights(getReadOnlyRights())
    } else if (preset === 'full') {
      setTokenRights(getFullRights())
    }
  }

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return t('dashboard.organization.api_access.never')
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
    <FeatureGate feature="api_access">
    <>
    <div className="sm:mx-10 mx-0 bg-white rounded-xl nice-shadow pt-3">
      <div className="flex flex-col gap-0">
        <div className="flex flex-col bg-gray-50 -space-y-1 px-5 py-3 mx-3 mb-3 rounded-md">
          <h1 className="font-bold text-xl text-gray-800">
            {activeTab === 'tokens' ? t('dashboard.organization.api_access.title') : t('dashboard.organization.api_access.api_docs_title')}
          </h1>
          <h2 className="text-gray-500 text-md">
            {activeTab === 'tokens'
              ? t('dashboard.organization.settings.pages.api.subtitle')
              : t('dashboard.organization.api_access.docs_subtitle')}
          </h2>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full px-5">
        <div className="flex items-center justify-between mb-6">
          <TabsList>
            <TabsTrigger value="tokens" className="flex items-center gap-2">
              <Key size={16} />
              {t('dashboard.organization.api_access.api_tokens')}
            </TabsTrigger>
            <TabsTrigger value="documentation" className="flex items-center gap-2">
              <BookOpen size={16} />
              {t('dashboard.organization.api_access.docs_playground')}
            </TabsTrigger>
          </TabsList>
          <a
            href="mailto:hello@learnhouse.app"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition-colors border border-gray-200"
            title={t('dashboard.organization.api_access.contact_support')}
          >
            <LifeBuoy size={14} />
            {t('dashboard.organization.api_access.something_not_working')}
          </a>
        </div>

        <TabsContent value="tokens">
          <div className="pb-4">
            <div className="flex justify-between items-center mb-4">
              <p className="text-sm text-gray-600">
                {t('dashboard.organization.api_access.tokens_description')}
              </p>
              <Button
                onClick={() => setIsCreateDialogOpen(true)}
                className="bg-black text-white hover:bg-black/90"
              >
                <Plus size={16} className="me-2" />
                {t('dashboard.organization.api_access.create_token')}
              </Button>
            </div>

            {isLoading ? (
              <div className="animate-pulse space-y-2">
                <div className="h-9 bg-gray-100 rounded w-full" />
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex gap-4 px-4 py-3 border-b border-gray-100">
                    <div className="h-4 bg-gray-100 rounded w-32" />
                    <div className="h-4 bg-gray-100 rounded w-24" />
                    <div className="h-4 bg-gray-100 rounded w-16" />
                    <div className="h-4 bg-gray-100 rounded w-28" />
                    <div className="h-4 bg-gray-100 rounded w-28" />
                    <div className="h-4 bg-gray-100 rounded w-20" />
                  </div>
                ))}
              </div>
            ) : tokens && tokens.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('dashboard.organization.api_access.name')}</TableHead>
                    <TableHead>{t('dashboard.organization.api_access.token_prefix')}</TableHead>
                    <TableHead>{t('common.status')}</TableHead>
                    <TableHead>{t('dashboard.organization.api_access.last_used')}</TableHead>
                    <TableHead>{t('dashboard.organization.api_access.expires')}</TableHead>
                    <TableHead>{t('dashboard.organization.api_access.actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tokens.map((token) => (
                    <TableRow key={token.token_uuid}>
                      <TableCell>
                        <div>
                          <div className="font-medium">{token.name}</div>
                          {token.description && (
                            <div className="text-sm text-gray-500 truncate max-w-[200px]">
                              {token.description}
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <code className="bg-gray-100 px-2 py-1 rounded text-sm">
                          {token.token_prefix}...
                        </code>
                      </TableCell>
                      <TableCell>
                        {token.is_active ? (
                          <Badge variant="default" className="bg-green-100 text-green-800">
                            {t('dashboard.organization.api_access.active')}
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="bg-red-100 text-red-800">
                            {t('dashboard.organization.api_access.revoked')}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-gray-600">
                        {token.last_used_at ? formatDate(token.last_used_at) : t('dashboard.organization.api_access.never')}
                      </TableCell>
                      <TableCell className="text-sm text-gray-600">
                        {token.expires_at ? formatDate(token.expires_at) : t('dashboard.organization.api_access.never')}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setSelectedToken(token)
                              setIsViewDialogOpen(true)
                            }}
                          >
                            <Eye size={16} />
                          </Button>
                          {token.is_active && (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setSelectedToken(token)
                                  setIsRegenerateDialogOpen(true)
                                }}
                              >
                                <RefreshCw size={16} />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-red-600 hover:text-red-700"
                                onClick={() => {
                                  setSelectedToken(token)
                                  setIsRevokeDialogOpen(true)
                                }}
                              >
                                <Trash2 size={16} />
                              </Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="text-center py-12 text-gray-500">
                <Key size={48} className="mx-auto mb-4 opacity-50" />
                <p>{t('dashboard.organization.api_access.no_tokens_yet')}</p>
                <p className="text-sm">{t('dashboard.organization.api_access.create_first_token')}</p>
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="documentation" className="pb-4">
          <APIDocumentation />
        </TabsContent>
        </Tabs>
      </div>
    </div>

      {/* Create Token Dialog */}
      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader className="px-6 pt-6">
            <DialogTitle>{t('dashboard.organization.api_access.create_api_token')}</DialogTitle>
            <DialogDescription>
              {t('dashboard.organization.api_access.create_token_desc')}
            </DialogDescription>
          </DialogHeader>

          {newTokenValue ? (
            <div className="px-6 pb-6 space-y-4">
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="text-yellow-600 flex-shrink-0 mt-0.5" size={20} />
                  <div>
                    <p className="font-medium text-yellow-800">{t('dashboard.organization.api_access.save_token_warning')}</p>
                    <p className="text-sm text-yellow-700">
                      {t('dashboard.organization.api_access.save_token_hint')}
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label>{t('dashboard.organization.api_access.your_api_token')}</Label>
                <div className="flex gap-2">
                  <Input
                    type={showTokenValue ? 'text' : 'password'}
                    value={newTokenValue}
                    readOnly
                    className="font-mono text-sm"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setShowTokenValue(!showTokenValue)}
                  >
                    {showTokenValue ? <EyeOff size={16} /> : <Eye size={16} />}
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => copyToClipboard(newTokenValue)}
                  >
                    {copiedToken ? <Check size={16} className="text-green-600" /> : <Copy size={16} />}
                  </Button>
                </div>
              </div>

              <DialogFooter>
                <Button
                  onClick={() => {
                    setIsCreateDialogOpen(false)
                    setNewTokenValue(null)
                    setShowTokenValue(false)
                  }}
                >
                  {t('dashboard.organization.api_access.done')}
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="px-6 pb-6 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="tokenName">{t('dashboard.organization.api_access.token_name_label')}</Label>
                <Input
                  id="tokenName"
                  value={tokenName}
                  onChange={(e) => setTokenName(e.target.value)}
                  placeholder={t('dashboard.organization.api_access.token_name_placeholder')}
                  maxLength={100}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="tokenDescription">{t('dashboard.organization.api_access.description_label')}</Label>
                <Textarea
                  id="tokenDescription"
                  value={tokenDescription}
                  onChange={(e) => setTokenDescription(e.target.value)}
                  placeholder={t('dashboard.organization.api_access.description_placeholder')}
                  maxLength={500}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="tokenExpiry">{t('dashboard.organization.api_access.expiration_label')}</Label>
                <Input
                  id="tokenExpiry"
                  type="datetime-local"
                  value={tokenExpiry}
                  onChange={(e) => setTokenExpiry(e.target.value)}
                />
                <p className="text-xs text-gray-500">{t('dashboard.organization.api_access.expiration_hint')}</p>
              </div>

              <div className="space-y-3">
                <Label>{t('dashboard.organization.api_access.permissions_label')}</Label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={rightsPreset === 'readonly' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => handlePresetChange('readonly')}
                  >
                    {t('dashboard.organization.api_access.read_only')}
                  </Button>
                  <Button
                    type="button"
                    variant={rightsPreset === 'full' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => handlePresetChange('full')}
                  >
                    {t('dashboard.organization.api_access.full_access')}
                  </Button>
                  <Button
                    type="button"
                    variant={rightsPreset === 'custom' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => handlePresetChange('custom')}
                  >
                    {t('dashboard.organization.api_access.custom')}
                  </Button>
                </div>

                {rightsPreset === 'custom' && (
                  <PermissionsEditor rights={tokenRights} onChange={setTokenRights} />
                )}
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
                  {t('dashboard.organization.api_access.cancel')}
                </Button>
                <Button onClick={handleCreateToken}>{t('dashboard.organization.api_access.create_token')}</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* View Token Dialog */}
      <Dialog open={isViewDialogOpen} onOpenChange={setIsViewDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader className="px-6 pt-6">
            <DialogTitle>{t('dashboard.organization.api_access.token_details')}</DialogTitle>
          </DialogHeader>
          {selectedToken && (
            <div className="px-6 pb-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-gray-500">{t('dashboard.organization.api_access.name')}</Label>
                  <p className="font-medium">{selectedToken.name}</p>
                </div>
                <div>
                  <Label className="text-gray-500">{t('common.status')}</Label>
                  <p>
                    {selectedToken.is_active ? (
                      <Badge className="bg-green-100 text-green-800">{t('dashboard.organization.api_access.active')}</Badge>
                    ) : (
                      <Badge className="bg-red-100 text-red-800">{t('dashboard.organization.api_access.revoked')}</Badge>
                    )}
                  </p>
                </div>
                <div>
                  <Label className="text-gray-500">{t('dashboard.organization.api_access.token_prefix')}</Label>
                  <code className="bg-gray-100 px-2 py-1 rounded text-sm">
                    {selectedToken.token_prefix}...
                  </code>
                </div>
                <div>
                  <Label className="text-gray-500">{t('dashboard.organization.api_access.created')}</Label>
                  <p className="text-sm">{formatDate(selectedToken.creation_date)}</p>
                </div>
                <div>
                  <Label className="text-gray-500">{t('dashboard.organization.api_access.last_used')}</Label>
                  <p className="text-sm">
                    {selectedToken.last_used_at ? formatDate(selectedToken.last_used_at) : t('dashboard.organization.api_access.never')}
                  </p>
                </div>
                <div>
                  <Label className="text-gray-500">{t('dashboard.organization.api_access.expires')}</Label>
                  <p className="text-sm">
                    {selectedToken.expires_at ? formatDate(selectedToken.expires_at) : t('dashboard.organization.api_access.never')}
                  </p>
                </div>
              </div>
              {selectedToken.description && (
                <div>
                  <Label className="text-gray-500">{t('dashboard.organization.api_access.description_label')}</Label>
                  <p className="text-sm">{selectedToken.description}</p>
                </div>
              )}
              {selectedToken.rights && (
                <div>
                  <Label className="text-gray-500">{t('dashboard.organization.api_access.permissions_label')}</Label>
                  <div className="mt-2 bg-gray-50 rounded-lg p-3 text-xs">
                    <PermissionsViewer rights={selectedToken.rights} />
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Revoke Token Dialog */}
      <Dialog open={isRevokeDialogOpen} onOpenChange={setIsRevokeDialogOpen}>
        <DialogContent>
          <DialogHeader className="px-6 pt-6">
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle size={20} />
              {t('dashboard.organization.api_access.revoke_title')}
            </DialogTitle>
            <DialogDescription>
              {t('dashboard.organization.api_access.revoke_confirm')}
            </DialogDescription>
          </DialogHeader>
          <div className="px-6 pb-6">
            {selectedToken && (
              <div className="bg-gray-50 rounded-lg p-3 mb-4">
                <p className="font-medium">{selectedToken.name}</p>
                <code className="text-sm text-gray-600">{selectedToken.token_prefix}...</code>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsRevokeDialogOpen(false)}>
                {t('dashboard.organization.api_access.cancel')}
              </Button>
              <Button variant="destructive" onClick={handleRevokeToken}>
                {t('dashboard.organization.api_access.revoke_token')}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* Regenerate Token Dialog */}
      <Dialog open={isRegenerateDialogOpen} onOpenChange={setIsRegenerateDialogOpen}>
        <DialogContent>
          <DialogHeader className="px-6 pt-6">
            <DialogTitle className="flex items-center gap-2">
              <RefreshCw size={20} />
              {t('dashboard.organization.api_access.regenerate_title')}
            </DialogTitle>
            <DialogDescription>
              {t('dashboard.organization.api_access.regenerate_desc')}
            </DialogDescription>
          </DialogHeader>
          <div className="px-6 pb-6">
            {newTokenValue ? (
              <div className="space-y-4">
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="text-yellow-600 flex-shrink-0 mt-0.5" size={20} />
                    <div>
                      <p className="font-medium text-yellow-800">{t('dashboard.organization.api_access.save_new_token')}</p>
                      <p className="text-sm text-yellow-700">
                        {t('dashboard.organization.api_access.save_new_token_hint')}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Input
                    type={showTokenValue ? 'text' : 'password'}
                    value={newTokenValue}
                    readOnly
                    className="font-mono text-sm"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setShowTokenValue(!showTokenValue)}
                  >
                    {showTokenValue ? <EyeOff size={16} /> : <Eye size={16} />}
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => copyToClipboard(newTokenValue)}
                  >
                    {copiedToken ? <Check size={16} className="text-green-600" /> : <Copy size={16} />}
                  </Button>
                </div>
                <DialogFooter>
                  <Button
                    onClick={() => {
                      setIsRegenerateDialogOpen(false)
                      setNewTokenValue(null)
                      setShowTokenValue(false)
                      setSelectedToken(null)
                    }}
                  >
                    {t('dashboard.organization.api_access.done')}
                  </Button>
                </DialogFooter>
              </div>
            ) : (
              <>
                {selectedToken && (
                  <div className="bg-gray-50 rounded-lg p-3 mb-4">
                    <p className="font-medium">{selectedToken.name}</p>
                    <code className="text-sm text-gray-600">{selectedToken.token_prefix}...</code>
                  </div>
                )}
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsRegenerateDialogOpen(false)}>
                    {t('dashboard.organization.api_access.cancel')}
                  </Button>
                  <Button onClick={handleRegenerateToken}>{t('dashboard.organization.api_access.regenerate')}</Button>
                </DialogFooter>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
    </FeatureGate>
  )
}

// Permissions Editor Component
const PermissionsEditor: React.FC<{
  rights: APITokenRights
  onChange: (_rights: APITokenRights) => void
}> = ({ rights, onChange }) => {
  const { t } = useTranslation()
  // API Token access is restricted to specific resources
  const resources = [
    { key: 'courses', label: t('dashboard.organization.api_access.resources.courses'), hasCrud: true },
    { key: 'activities', label: t('dashboard.organization.api_access.resources.activities'), hasCrud: true },
    { key: 'assignments', label: t('dashboard.organization.api_access.resources.assignments'), hasCrud: true },
    { key: 'coursechapters', label: t('dashboard.organization.api_access.resources.chapters'), hasCrud: true },
    { key: 'folders', label: t('dashboard.organization.api_access.resources.folders'), hasCrud: true },
    { key: 'media', label: t('dashboard.organization.api_access.resources.media'), hasCrud: true },
    { key: 'certifications', label: t('dashboard.organization.api_access.resources.certifications'), hasCrud: true },
    { key: 'usergroups', label: t('dashboard.organization.api_access.resources.user_groups'), hasCrud: true },
    { key: 'payments', label: t('dashboard.organization.api_access.resources.payments'), hasCrud: true },
    { key: 'users', label: t('dashboard.organization.api_access.resources.users_admin'), hasCrud: true },
    { key: 'roles', label: t('dashboard.organization.api_access.resources.roles_admin'), hasCrud: true },
  ]

  const togglePermission = (resource: string, permission: string) => {
    const newRights = { ...rights }
    const resourceRights = { ...(newRights as any)[resource] }
    resourceRights[permission] = !resourceRights[permission]
    ;(newRights as any)[resource] = resourceRights
    onChange(newRights)
  }

  return (
    <div className="border rounded-lg overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('dashboard.organization.api_access.resource')}</TableHead>
            <TableHead className="text-center">{t('dashboard.organization.api_access.perm_create')}</TableHead>
            <TableHead className="text-center">{t('dashboard.organization.api_access.perm_read')}</TableHead>
            <TableHead className="text-center">{t('dashboard.organization.api_access.perm_update')}</TableHead>
            <TableHead className="text-center">{t('common.delete')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {resources.map((resource) => (
            <TableRow key={resource.key}>
              <TableCell className="font-medium">{resource.label}</TableCell>
              <TableCell className="text-center">
                <Switch
                  checked={(rights as any)[resource.key]?.action_create || false}
                  onCheckedChange={() => togglePermission(resource.key, 'action_create')}
                />
              </TableCell>
              <TableCell className="text-center">
                <Switch
                  checked={(rights as any)[resource.key]?.action_read || false}
                  onCheckedChange={() => togglePermission(resource.key, 'action_read')}
                />
              </TableCell>
              <TableCell className="text-center">
                <Switch
                  checked={(rights as any)[resource.key]?.action_update || false}
                  onCheckedChange={() => togglePermission(resource.key, 'action_update')}
                />
              </TableCell>
              <TableCell className="text-center">
                <Switch
                  checked={(rights as any)[resource.key]?.action_delete || false}
                  onCheckedChange={() => togglePermission(resource.key, 'action_delete')}
                />
              </TableCell>
            </TableRow>
          ))}
          <TableRow>
            <TableCell className="font-medium">{t('common.search')}</TableCell>
            <TableCell className="text-center">-</TableCell>
            <TableCell className="text-center">
              <Switch
                checked={rights.search?.action_read || false}
                onCheckedChange={() => togglePermission('search', 'action_read')}
              />
            </TableCell>
            <TableCell className="text-center">-</TableCell>
            <TableCell className="text-center">-</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  )
}

// Permissions Viewer Component
const PermissionsViewer: React.FC<{ rights: APITokenRights }> = ({ rights }) => {
  const { t } = useTranslation()
  const getPermissionSummary = (resourceRights: any) => {
    const perms = []
    if (resourceRights?.action_create) perms.push('C')
    if (resourceRights?.action_read) perms.push('R')
    if (resourceRights?.action_update) perms.push('U')
    if (resourceRights?.action_delete) perms.push('D')
    return perms.length > 0 ? perms.join('') : '-'
  }

  return (
    <div className="grid grid-cols-3 gap-2">
      <div>{t('dashboard.organization.api_access.resources.courses')}: {getPermissionSummary(rights.courses)}</div>
      <div>{t('dashboard.organization.api_access.resources.activities')}: {getPermissionSummary(rights.activities)}</div>
      <div>{t('dashboard.organization.api_access.resources.assignments')}: {getPermissionSummary(rights.assignments)}</div>
      <div>{t('dashboard.organization.api_access.resources.chapters')}: {getPermissionSummary(rights.coursechapters)}</div>
      <div>{t('dashboard.organization.api_access.resources.folders')}: {getPermissionSummary(rights.folders)}</div>
      <div>{t('dashboard.organization.api_access.resources.media')}: {getPermissionSummary(rights.media)}</div>
      <div>{t('dashboard.organization.api_access.perm_summary.certs')}: {getPermissionSummary(rights.certifications)}</div>
      <div>{t('dashboard.organization.api_access.perm_summary.groups')}: {getPermissionSummary(rights.usergroups)}</div>
      <div>{t('dashboard.organization.api_access.resources.payments')}: {getPermissionSummary(rights.payments)}</div>
      <div>{t('common.search')}: {rights.search?.action_read ? 'R' : '-'}</div>
    </div>
  )
}

export default OrgEditAPIAccess
