'use client'
import React, { useState } from 'react'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { toast } from 'react-hot-toast'
import { Button } from '@components/ui/button'
import { getAPIUrl, getPlatformUrl } from '@services/config/config'
import useSWR, { mutate } from 'swr'
import { swrFetcher } from '@services/utils/ts/requests'
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
  Clock,
  Shield,
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
  regenerateAPIToken,
  revokeAPIToken,
} from '@services/api_tokens/api_tokens'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@components/ui/tabs'
import APIDocumentation from './APIDocumentation'
import PlanRestrictedFeature from '@components/Dashboard/Shared/PlanRestricted/PlanRestrictedFeature'
import { PlanLevel } from '@services/plans/plans'
import { usePlan } from '@components/Hooks/usePlan'

const OrgEditAPIAccess: React.FC = () => {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const org = useOrg() as any
  const currentPlan = usePlan()

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
  const tokensUrl = org?.id ? `${getAPIUrl()}orgs/${org.id}/api-tokens` : null
  const { data: tokens, isLoading } = useSWR<APIToken[]>(
    tokensUrl,
    (url: string) => swrFetcher(url, access_token),
    { revalidateOnFocus: false }
  )

  const handleCreateToken = async () => {
    if (!tokenName.trim()) {
      toast.error('Token name is required')
      return
    }

    const loadingToast = toast.loading('Creating API token...')
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
        mutate(tokensUrl)
        toast.success('API token created successfully', { id: loadingToast })
        // Reset form
        setTokenName('')
        setTokenDescription('')
        setTokenExpiry('')
        setTokenRights(getDefaultRights())
        setRightsPreset('readonly')
      } else {
        toast.error(response.data?.detail || 'Failed to create token', { id: loadingToast })
      }
    } catch (error: any) {
      toast.error(error.message || 'Failed to create token', { id: loadingToast })
    }
  }

  const handleRevokeToken = async () => {
    if (!selectedToken) return

    const loadingToast = toast.loading('Revoking API token...')
    try {
      const response = await revokeAPIToken(org.id, selectedToken.token_uuid, access_token)

      if (response.success) {
        mutate(tokensUrl)
        toast.success('API token revoked successfully', { id: loadingToast })
        setIsRevokeDialogOpen(false)
        setSelectedToken(null)
      } else {
        toast.error(response.data?.detail || 'Failed to revoke token', { id: loadingToast })
      }
    } catch (error: any) {
      toast.error(error.message || 'Failed to revoke token', { id: loadingToast })
    }
  }

  const handleRegenerateToken = async () => {
    if (!selectedToken) return

    const loadingToast = toast.loading('Regenerating API token...')
    try {
      const response = await regenerateAPIToken(org.id, selectedToken.token_uuid, access_token)

      if (response.success) {
        setNewTokenValue(response.data.token)
        setShowTokenValue(true)
        mutate(tokensUrl)
        toast.success('API token regenerated successfully', { id: loadingToast })
        // Don't close the dialog here - keep it open to show the new token
      } else {
        toast.error(response.data?.detail || 'Failed to regenerate token', { id: loadingToast })
      }
    } catch (error: any) {
      toast.error(error.message || 'Failed to regenerate token', { id: loadingToast })
    }
  }

  const copyToClipboard = async (text: string) => {
    await navigator.clipboard.writeText(text)
    setCopiedToken(true)
    toast.success('Token copied to clipboard')
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
      icon={Key}
      titleKey="common.plans.feature_restricted.api_access.title"
      descriptionKey="common.plans.feature_restricted.api_access.description"
    >
    <>
    <div className="sm:mx-10 mx-0 bg-white rounded-xl nice-shadow pt-3">
      <div className="flex flex-col gap-0">
        <div className="flex flex-col bg-gray-50 -space-y-1 px-5 py-3 mx-3 mb-3 rounded-md">
          <h1 className="font-bold text-xl text-gray-800">
            {activeTab === 'tokens' ? 'API Access' : 'API Documentation & Playground'}
          </h1>
          <h2 className="text-gray-500 text-md">
            {activeTab === 'tokens'
              ? 'Manage API tokens and programmatic access to your organization'
              : 'Explore and test API endpoints using your API tokens'}
          </h2>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full px-5">
        <div className="flex items-center justify-between mb-6">
          <TabsList>
            <TabsTrigger value="tokens" className="flex items-center gap-2">
              <Key size={16} />
              API Tokens
            </TabsTrigger>
            <TabsTrigger value="documentation" className="flex items-center gap-2">
              <BookOpen size={16} />
              Documentation & Playground
            </TabsTrigger>
          </TabsList>
          <a
            href={getPlatformUrl('/dashboard/support') ?? 'https://www.learnhouse.app/dashboard/support'}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition-colors border border-gray-200"
            title="Contact LearnHouse support"
          >
            <LifeBuoy size={14} />
            Something not working as expected?
          </a>
        </div>

        <TabsContent value="tokens">
          <div className="pb-4">
            <div className="flex justify-between items-center mb-4">
              <p className="text-sm text-gray-600">
                API tokens allow external applications to access your organization&apos;s data securely.
              </p>
              <Button
                onClick={() => setIsCreateDialogOpen(true)}
                className="bg-black text-white hover:bg-black/90"
              >
                <Plus size={16} className="me-2" />
                Create Token
              </Button>
            </div>

            {isLoading ? (
              <div className="flex justify-center py-8">
                <RefreshCw className="animate-spin text-gray-400" size={24} />
              </div>
            ) : tokens && tokens.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Token Prefix</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Last Used</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead>Actions</TableHead>
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
                            Active
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="bg-red-100 text-red-800">
                            Revoked
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-gray-600">
                        {token.last_used_at ? formatDate(token.last_used_at) : 'Never'}
                      </TableCell>
                      <TableCell className="text-sm text-gray-600">
                        {token.expires_at ? formatDate(token.expires_at) : 'Never'}
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
                <p>No API tokens yet</p>
                <p className="text-sm">Create your first token to get started</p>
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
            <DialogTitle>Create API Token</DialogTitle>
            <DialogDescription>
              Create a new API token for programmatic access. The token will only be shown once.
            </DialogDescription>
          </DialogHeader>

          {newTokenValue ? (
            <div className="px-6 pb-6 space-y-4">
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="text-yellow-600 flex-shrink-0 mt-0.5" size={20} />
                  <div>
                    <p className="font-medium text-yellow-800">Save your token now!</p>
                    <p className="text-sm text-yellow-700">
                      This is the only time you&apos;ll see this token. Copy it and store it securely.
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Your API Token</Label>
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
                  Done
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="px-6 pb-6 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="tokenName">Token Name *</Label>
                <Input
                  id="tokenName"
                  value={tokenName}
                  onChange={(e) => setTokenName(e.target.value)}
                  placeholder="e.g., CI/CD Pipeline, Mobile App"
                  maxLength={100}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="tokenDescription">Description</Label>
                <Textarea
                  id="tokenDescription"
                  value={tokenDescription}
                  onChange={(e) => setTokenDescription(e.target.value)}
                  placeholder="What will this token be used for?"
                  maxLength={500}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="tokenExpiry">Expiration Date (optional)</Label>
                <Input
                  id="tokenExpiry"
                  type="datetime-local"
                  value={tokenExpiry}
                  onChange={(e) => setTokenExpiry(e.target.value)}
                />
                <p className="text-xs text-gray-500">Leave empty for a token that never expires</p>
              </div>

              <div className="space-y-3">
                <Label>Permissions</Label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={rightsPreset === 'readonly' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => handlePresetChange('readonly')}
                  >
                    Read Only
                  </Button>
                  <Button
                    type="button"
                    variant={rightsPreset === 'full' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => handlePresetChange('full')}
                  >
                    Full Access
                  </Button>
                  <Button
                    type="button"
                    variant={rightsPreset === 'custom' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => handlePresetChange('custom')}
                  >
                    Custom
                  </Button>
                </div>

                {rightsPreset === 'custom' && (
                  <PermissionsEditor rights={tokenRights} onChange={setTokenRights} />
                )}
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleCreateToken}>Create Token</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* View Token Dialog */}
      <Dialog open={isViewDialogOpen} onOpenChange={setIsViewDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader className="px-6 pt-6">
            <DialogTitle>Token Details</DialogTitle>
          </DialogHeader>
          {selectedToken && (
            <div className="px-6 pb-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-gray-500">Name</Label>
                  <p className="font-medium">{selectedToken.name}</p>
                </div>
                <div>
                  <Label className="text-gray-500">Status</Label>
                  <p>
                    {selectedToken.is_active ? (
                      <Badge className="bg-green-100 text-green-800">Active</Badge>
                    ) : (
                      <Badge className="bg-red-100 text-red-800">Revoked</Badge>
                    )}
                  </p>
                </div>
                <div>
                  <Label className="text-gray-500">Token Prefix</Label>
                  <code className="bg-gray-100 px-2 py-1 rounded text-sm">
                    {selectedToken.token_prefix}...
                  </code>
                </div>
                <div>
                  <Label className="text-gray-500">Created</Label>
                  <p className="text-sm">{formatDate(selectedToken.creation_date)}</p>
                </div>
                <div>
                  <Label className="text-gray-500">Last Used</Label>
                  <p className="text-sm">
                    {selectedToken.last_used_at ? formatDate(selectedToken.last_used_at) : 'Never'}
                  </p>
                </div>
                <div>
                  <Label className="text-gray-500">Expires</Label>
                  <p className="text-sm">
                    {selectedToken.expires_at ? formatDate(selectedToken.expires_at) : 'Never'}
                  </p>
                </div>
              </div>
              {selectedToken.description && (
                <div>
                  <Label className="text-gray-500">Description</Label>
                  <p className="text-sm">{selectedToken.description}</p>
                </div>
              )}
              {selectedToken.rights && (
                <div>
                  <Label className="text-gray-500">Permissions</Label>
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
              Revoke API Token
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to revoke this token? This action cannot be undone.
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
                Cancel
              </Button>
              <Button variant="destructive" onClick={handleRevokeToken}>
                Revoke Token
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
              Regenerate API Token
            </DialogTitle>
            <DialogDescription>
              This will generate a new secret for this token. The old token will immediately stop working.
            </DialogDescription>
          </DialogHeader>
          <div className="px-6 pb-6">
            {newTokenValue ? (
              <div className="space-y-4">
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="text-yellow-600 flex-shrink-0 mt-0.5" size={20} />
                    <div>
                      <p className="font-medium text-yellow-800">Save your new token!</p>
                      <p className="text-sm text-yellow-700">
                        This is the only time you&apos;ll see this token.
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
                    Done
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
                    Cancel
                  </Button>
                  <Button onClick={handleRegenerateToken}>Regenerate</Button>
                </DialogFooter>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
    </PlanRestrictedFeature>
  )
}

// Permissions Editor Component
const PermissionsEditor: React.FC<{
  rights: APITokenRights
  onChange: (rights: APITokenRights) => void
}> = ({ rights, onChange }) => {
  // API Token access is restricted to specific resources
  const resources = [
    { key: 'courses', label: 'Courses', hasCrud: true },
    { key: 'activities', label: 'Activities', hasCrud: true },
    { key: 'coursechapters', label: 'Chapters', hasCrud: true },
    { key: 'collections', label: 'Collections', hasCrud: true },
    { key: 'certifications', label: 'Certifications', hasCrud: true },
    { key: 'usergroups', label: 'User Groups', hasCrud: true },
    { key: 'payments', label: 'Payments', hasCrud: true },
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
            <TableHead>Resource</TableHead>
            <TableHead className="text-center">Create</TableHead>
            <TableHead className="text-center">Read</TableHead>
            <TableHead className="text-center">Update</TableHead>
            <TableHead className="text-center">Delete</TableHead>
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
            <TableCell className="font-medium">Search</TableCell>
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
      <div>Courses: {getPermissionSummary(rights.courses)}</div>
      <div>Activities: {getPermissionSummary(rights.activities)}</div>
      <div>Chapters: {getPermissionSummary(rights.coursechapters)}</div>
      <div>Collections: {getPermissionSummary(rights.collections)}</div>
      <div>Certs: {getPermissionSummary(rights.certifications)}</div>
      <div>Groups: {getPermissionSummary(rights.usergroups)}</div>
      <div>Payments: {getPermissionSummary(rights.payments)}</div>
      <div>Search: {rights.search?.action_read ? 'R' : '-'}</div>
    </div>
  )
}

export default OrgEditAPIAccess
