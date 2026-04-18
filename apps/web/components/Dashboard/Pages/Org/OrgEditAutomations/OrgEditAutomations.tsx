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
import { Textarea } from '@components/ui/textarea'
import { Label } from '@components/ui/label'
import { Switch } from '@components/ui/switch'
import { Badge } from '@components/ui/badge'
import { Checkbox } from '@components/ui/checkbox'
import {
  Zap,
  Plus,
  Copy,
  Trash2,
  RefreshCw,
  Eye,
  EyeOff,
  AlertTriangle,
  Check,
  Send,
  ChevronDown,
  ChevronUp,
  Clock,
  CheckCircle,
  XCircle,
  ExternalLink,
} from 'lucide-react'

// Zapier brand mark — the 8-point orange blossom from Zapier's brand system.
// Rendered inline so we don't need to ship an image asset, and scales cleanly
// at any size. Brand color #FF4A00.
const ZapierLogo: React.FC<{ size?: number; className?: string }> = ({
  size = 20,
  className,
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 100 100"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-hidden="true"
  >
    <g fill="#FF4A00">
      <ellipse cx="50" cy="50" rx="9" ry="42" />
      <ellipse cx="50" cy="50" rx="9" ry="42" transform="rotate(45 50 50)" />
      <ellipse cx="50" cy="50" rx="9" ry="42" transform="rotate(90 50 50)" />
      <ellipse cx="50" cy="50" rx="9" ry="42" transform="rotate(135 50 50)" />
    </g>
  </svg>
)
import {
  WebhookEndpoint,
  WebhookEndpointCreated,
  WebhookDeliveryLog,
  WebhookCreateRequest,
  createWebhookEndpoint,
  updateWebhookEndpoint,
  deleteWebhookEndpoint,
  regenerateWebhookSecret,
  sendTestEvent,
  getWebhookDeliveryLogs,
} from '@services/webhooks/webhooks'
import PlanRestrictedFeature from '@components/Dashboard/Shared/PlanRestricted/PlanRestrictedFeature'
import { usePlan } from '@components/Hooks/usePlan'

// Types for API-driven event registry
interface EventInfo {
  category: string
  description: string
  data_schema: any
}

interface EventCategory {
  label: string
  events: { id: string; description: string; data_schema: any }[]
}

/** Group flat event registry (from API) into categories for the UI. */
function buildCategories(events: Record<string, EventInfo>): EventCategory[] {
  const categoryMap = new Map<string, EventCategory>()
  for (const [id, info] of Object.entries(events)) {
    const cat = info.category || 'Other'
    if (!categoryMap.has(cat)) {
      categoryMap.set(cat, { label: cat, events: [] })
    }
    categoryMap.get(cat)!.events.push({
      id,
      description: info.description,
      data_schema: info.data_schema,
    })
  }
  return [...categoryMap.values()]
}

const OrgEditAutomations: React.FC = () => {
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const org = useOrg() as any
  const currentPlan = usePlan()

  // Fetch event registry from API
  const eventsUrl = org?.id ? `${getAPIUrl()}orgs/${org.id}/webhooks/events` : null
  const { data: eventsData } = useSWR<{ events: Record<string, EventInfo> }>(
    eventsUrl,
    (url: string) => swrFetcher(url, access_token)
  )
  const eventRegistry = eventsData?.events || {}
  const eventCategories = buildCategories(eventRegistry)
  const allEventIds = Object.keys(eventRegistry)

  // Dialog state
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [isRegenerateDialogOpen, setIsRegenerateDialogOpen] = useState(false)
  const [isDeliveryLogOpen, setIsDeliveryLogOpen] = useState(false)
  const [selectedWebhook, setSelectedWebhook] = useState<WebhookEndpoint | null>(null)
  const [newSecret, setNewSecret] = useState<string | null>(null)
  const [showSecret, setShowSecret] = useState(false)
  const [copiedSecret, setCopiedSecret] = useState(false)

  // Create form state
  const [createUrl, setCreateUrl] = useState('')
  const [createDescription, setCreateDescription] = useState('')
  const [createEvents, setCreateEvents] = useState<string[]>([])

  // Edit state
  const [editingWebhook, setEditingWebhook] = useState<string | null>(null)
  const [editUrl, setEditUrl] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editEvents, setEditEvents] = useState<string[]>([])

  // Delivery logs
  const [deliveryLogs, setDeliveryLogs] = useState<WebhookDeliveryLog[]>([])
  const [logsLoading, setLogsLoading] = useState(false)

  // Fetch webhooks
  const webhooksUrl = org?.id ? `${getAPIUrl()}orgs/${org.id}/webhooks` : null
  const { data: webhooks, isLoading } = useSWR<WebhookEndpoint[]>(
    webhooksUrl,
    (url: string) => swrFetcher(url, access_token)
  )

  // Split webhooks by source so the Zapier and manual lists render separately.
  const zapierWebhooks = (webhooks || []).filter((w) => w.source === 'zapier')
  const manualWebhooks = (webhooks || []).filter((w) => w.source !== 'zapier')

  const resetCreateForm = () => {
    setCreateUrl('')
    setCreateDescription('')
    setCreateEvents([])
  }

  const handleCreate = async () => {
    if (!createUrl.trim()) {
      toast.error('URL is required')
      return
    }
    if (createEvents.length === 0) {
      toast.error('Select at least one event')
      return
    }

    const loadingToast = toast.loading('Creating webhook...')
    try {
      const data: WebhookCreateRequest = {
        url: createUrl.trim(),
        description: createDescription.trim() || null,
        events: createEvents,
      }
      const response = await createWebhookEndpoint(org.id, data, access_token)

      if (response.success) {
        setNewSecret(response.data.secret)
        setShowSecret(true)
        mutate(webhooksUrl)
        toast.success('Webhook created', { id: loadingToast })
        resetCreateForm()
      } else {
        toast.error(response.data?.detail || 'Failed to create webhook', { id: loadingToast })
      }
    } catch (error: any) {
      toast.error(error.message || 'Failed to create webhook', { id: loadingToast })
    }
  }

  const handleToggleActive = async (webhook: WebhookEndpoint) => {
    const loadingToast = toast.loading(webhook.is_active ? 'Disabling...' : 'Enabling...')
    try {
      const response = await updateWebhookEndpoint(
        org.id,
        webhook.webhook_uuid,
        { is_active: !webhook.is_active },
        access_token
      )
      if (response.success) {
        mutate(webhooksUrl)
        toast.success(webhook.is_active ? 'Webhook disabled' : 'Webhook enabled', { id: loadingToast })
      } else {
        toast.error(response.data?.detail || 'Failed to update', { id: loadingToast })
      }
    } catch (error: any) {
      toast.error(error.message || 'Failed to update', { id: loadingToast })
    }
  }

  const handleDelete = async () => {
    if (!selectedWebhook) return
    const loadingToast = toast.loading('Deleting webhook...')
    try {
      const response = await deleteWebhookEndpoint(org.id, selectedWebhook.webhook_uuid, access_token)
      if (response.success) {
        mutate(webhooksUrl)
        toast.success('Webhook deleted', { id: loadingToast })
        setIsDeleteDialogOpen(false)
        setSelectedWebhook(null)
      } else {
        toast.error(response.data?.detail || 'Failed to delete', { id: loadingToast })
      }
    } catch (error: any) {
      toast.error(error.message || 'Failed to delete', { id: loadingToast })
    }
  }

  const handleRegenerate = async () => {
    if (!selectedWebhook) return
    const loadingToast = toast.loading('Regenerating secret...')
    try {
      const response = await regenerateWebhookSecret(org.id, selectedWebhook.webhook_uuid, access_token)
      if (response.success) {
        setNewSecret(response.data.secret)
        setShowSecret(true)
        mutate(webhooksUrl)
        toast.success('Secret regenerated', { id: loadingToast })
      } else {
        toast.error(response.data?.detail || 'Failed to regenerate', { id: loadingToast })
      }
    } catch (error: any) {
      toast.error(error.message || 'Failed to regenerate', { id: loadingToast })
    }
  }

  const handleTest = async (webhook: WebhookEndpoint) => {
    const loadingToast = toast.loading('Sending test event...')
    try {
      const response = await sendTestEvent(org.id, webhook.webhook_uuid, access_token)
      if (response.success) {
        toast.success('Test event sent', { id: loadingToast })
      } else {
        toast.error(response.data?.detail || 'Failed to send test', { id: loadingToast })
      }
    } catch (error: any) {
      toast.error(error.message || 'Failed to send test', { id: loadingToast })
    }
  }

  const handleViewLogs = async (webhook: WebhookEndpoint) => {
    setSelectedWebhook(webhook)
    setIsDeliveryLogOpen(true)
    setLogsLoading(true)
    try {
      const response = await getWebhookDeliveryLogs(org.id, webhook.webhook_uuid, access_token, 30)
      if (response.success) {
        setDeliveryLogs(response.data)
      }
    } catch {
      toast.error('Failed to load delivery logs')
    } finally {
      setLogsLoading(false)
    }
  }

  const handleStartEdit = (webhook: WebhookEndpoint) => {
    setEditingWebhook(webhook.webhook_uuid)
    setEditUrl(webhook.url)
    setEditDescription(webhook.description || '')
    setEditEvents([...webhook.events])
  }

  const handleSaveEdit = async (webhook: WebhookEndpoint) => {
    const loadingToast = toast.loading('Saving...')
    try {
      const response = await updateWebhookEndpoint(
        org.id,
        webhook.webhook_uuid,
        {
          url: editUrl.trim(),
          description: editDescription.trim() || null,
          events: editEvents,
        },
        access_token
      )
      if (response.success) {
        mutate(webhooksUrl)
        toast.success('Webhook updated', { id: loadingToast })
        setEditingWebhook(null)
      } else {
        toast.error(response.data?.detail || 'Failed to update', { id: loadingToast })
      }
    } catch (error: any) {
      toast.error(error.message || 'Failed to update', { id: loadingToast })
    }
  }

  const copyToClipboard = async (text: string) => {
    await navigator.clipboard.writeText(text)
    setCopiedSecret(true)
    toast.success('Copied to clipboard')
    setTimeout(() => setCopiedSecret(false), 2000)
  }

  const formatDate = (dateStr: string) => {
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
      icon={Zap}
      titleKey="common.plans.feature_restricted.webhooks.title"
      descriptionKey="common.plans.feature_restricted.webhooks.description"
    >
      <>
        {/* ── Zapier hero card (subtle variant) ────────────────────── */}
        <div className="sm:mx-10 mx-0 mb-6 bg-white rounded-xl nice-shadow overflow-hidden">
          <div className="px-5 py-4 flex items-center gap-4">
            <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-[#FFF5F0] flex items-center justify-center nice-shadow">
              <ZapierLogo size={22} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="font-semibold text-gray-800 text-[15px]">Zapier</h2>
                {zapierWebhooks.length > 0 && (
                  <Badge className="bg-[#FFF5F0] text-[#FF4A00] border border-[#FFE5D6] text-[10px] font-semibold uppercase tracking-wider hover:bg-[#FFF5F0]">
                    {zapierWebhooks.length} active {zapierWebhooks.length === 1 ? 'Zap' : 'Zaps'}
                  </Badge>
                )}
              </div>
              <p className="text-gray-500 text-xs mt-0.5">
                Connect LearnHouse to thousands of apps without writing code.
              </p>
            </div>
            <div className="flex items-center gap-3 flex-shrink-0">
              <a
                href="https://zapier.com/app/dashboard"
                target="_blank"
                rel="noopener noreferrer"
                className="text-gray-500 hover:text-gray-700 text-xs"
              >
                Manage Zaps
              </a>
              <a
                href="https://zapier.com/apps/learnhouse/integrations"
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button
                  variant="outline"
                  size="sm"
                  className="border-gray-200 text-gray-700 hover:bg-gray-50"
                >
                  Connect
                  <ExternalLink size={12} className="ms-1.5" />
                </Button>
              </a>
            </div>
          </div>

          {zapierWebhooks.length > 0 && (
            <div className="border-t border-gray-100 px-5 py-3 bg-gray-50/60">
              <div className="space-y-1.5">
                {zapierWebhooks.map((zap) => (
                  <ZapierRow
                    key={zap.webhook_uuid}
                    zap={zap}
                    onToggleActive={() => handleToggleActive(zap)}
                    onDelete={() => {
                      setSelectedWebhook(zap)
                      setIsDeleteDialogOpen(true)
                    }}
                    onViewLogs={() => handleViewLogs(zap)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── Manual webhooks ──────────────────────────────────────── */}
        <div className="sm:mx-10 mx-0 bg-white rounded-xl nice-shadow pt-3">
          <div className="flex flex-col gap-0">
            <div className="flex flex-col bg-gray-50 -space-y-1 px-5 py-3 mx-3 mb-3 rounded-md">
              <h1 className="font-bold text-xl text-gray-800">Webhooks</h1>
              <h2 className="text-gray-500 text-md">
                Send real-time event notifications to external services like Make.com, n8n, or your own API
              </h2>
            </div>

            <div className="px-5 pb-4">
              <div className="flex justify-between items-center mb-4">
                <p className="text-sm text-gray-600">
                  Webhook endpoints receive HTTP POST requests when events happen in your organization.
                </p>
                <Button
                  onClick={() => {
                    resetCreateForm()
                    setNewSecret(null)
                    setIsCreateDialogOpen(true)
                  }}
                  className="bg-black text-white hover:bg-black/90"
                >
                  <Plus size={16} className="me-2" />
                  Add Endpoint
                </Button>
              </div>

              {isLoading ? (
                <div className="flex justify-center py-8">
                  <RefreshCw className="animate-spin text-gray-400" size={24} />
                </div>
              ) : manualWebhooks.length > 0 ? (
                <div className="space-y-3">
                  {manualWebhooks.map((webhook) => (
                    <WebhookCard
                      key={webhook.webhook_uuid}
                      webhook={webhook}
                      isEditing={editingWebhook === webhook.webhook_uuid}
                      editUrl={editUrl}
                      editDescription={editDescription}
                      editEvents={editEvents}
                      onEditUrl={setEditUrl}
                      onEditDescription={setEditDescription}
                      onEditEvents={setEditEvents}
                      onStartEdit={() => handleStartEdit(webhook)}
                      onSaveEdit={() => handleSaveEdit(webhook)}
                      onCancelEdit={() => setEditingWebhook(null)}
                      onToggleActive={() => handleToggleActive(webhook)}
                      onTest={() => handleTest(webhook)}
                      onViewLogs={() => handleViewLogs(webhook)}
                      onRegenerate={() => {
                        setSelectedWebhook(webhook)
                        setNewSecret(null)
                        setShowSecret(false)
                        setIsRegenerateDialogOpen(true)
                      }}
                      onDelete={() => {
                        setSelectedWebhook(webhook)
                        setIsDeleteDialogOpen(true)
                      }}
                      formatDate={formatDate}
                      eventCategories={eventCategories}
                      eventRegistry={eventRegistry}
                    />
                  ))}
                </div>
              ) : (
                <div className="text-center py-12 text-gray-500">
                  <Zap size={48} className="mx-auto mb-4 opacity-50" />
                  <p>No webhook endpoints yet</p>
                  <p className="text-sm">Create your first endpoint to start receiving events</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Create Webhook Dialog */}
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader className="px-6 pt-6">
              <DialogTitle>Add Webhook Endpoint</DialogTitle>
              <DialogDescription>
                Events will be sent as HTTP POST requests with a signed payload.
              </DialogDescription>
            </DialogHeader>

            {newSecret ? (
              <div className="px-6 pb-6 space-y-4">
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="text-yellow-600 flex-shrink-0 mt-0.5" size={20} />
                    <div>
                      <p className="font-medium text-yellow-800">Save your signing secret now!</p>
                      <p className="text-sm text-yellow-700">
                        This is the only time you&apos;ll see this secret. Use it to verify webhook signatures.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Signing Secret</Label>
                  <div className="flex gap-2">
                    <Input
                      type={showSecret ? 'text' : 'password'}
                      value={newSecret}
                      readOnly
                      className="font-mono text-sm"
                    />
                    <Button variant="outline" size="icon" onClick={() => setShowSecret(!showSecret)}>
                      {showSecret ? <EyeOff size={16} /> : <Eye size={16} />}
                    </Button>
                    <Button variant="outline" size="icon" onClick={() => copyToClipboard(newSecret)}>
                      {copiedSecret ? <Check size={16} className="text-green-600" /> : <Copy size={16} />}
                    </Button>
                  </div>
                </div>

                <DialogFooter>
                  <Button onClick={() => { setIsCreateDialogOpen(false); setNewSecret(null); setShowSecret(false) }}>
                    Done
                  </Button>
                </DialogFooter>
              </div>
            ) : (
              <div className="px-6 pb-6 space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="webhookUrl">Endpoint URL *</Label>
                  <Input
                    id="webhookUrl"
                    value={createUrl}
                    onChange={(e) => setCreateUrl(e.target.value)}
                    placeholder="https://hooks.zapier.com/hooks/catch/..."
                    type="url"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="webhookDescription">Description</Label>
                  <Textarea
                    id="webhookDescription"
                    value={createDescription}
                    onChange={(e) => setCreateDescription(e.target.value)}
                    placeholder="What is this webhook for?"
                    maxLength={500}
                  />
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label>Events *</Label>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-xs"
                        onClick={() => setCreateEvents([...allEventIds])}
                      >
                        Select all
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-xs"
                        onClick={() => setCreateEvents([])}
                      >
                        Clear
                      </Button>
                    </div>
                  </div>
                  <EventSelector
                    categories={eventCategories}
                    selectedEvents={createEvents}
                    onChangeEvents={setCreateEvents}
                  />
                </div>

                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>Cancel</Button>
                  <Button onClick={handleCreate}>Create Endpoint</Button>
                </DialogFooter>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Delete Dialog */}
        <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
          <DialogContent>
            <DialogHeader className="px-6 pt-6">
              <DialogTitle className="flex items-center gap-2 text-red-600">
                <AlertTriangle size={20} />
                Delete Webhook
              </DialogTitle>
              <DialogDescription>
                This will permanently delete this endpoint and all its delivery logs.
              </DialogDescription>
            </DialogHeader>
            <div className="px-6 pb-6">
              {selectedWebhook && (
                <div className="bg-gray-50 rounded-lg p-3 mb-4">
                  <p className="font-medium truncate">{selectedWebhook.url}</p>
                  <p className="text-sm text-gray-500">{selectedWebhook.events.length} events subscribed</p>
                </div>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsDeleteDialogOpen(false)}>Cancel</Button>
                <Button variant="destructive" onClick={handleDelete}>Delete Endpoint</Button>
              </DialogFooter>
            </div>
          </DialogContent>
        </Dialog>

        {/* Regenerate Secret Dialog */}
        <Dialog open={isRegenerateDialogOpen} onOpenChange={setIsRegenerateDialogOpen}>
          <DialogContent>
            <DialogHeader className="px-6 pt-6">
              <DialogTitle className="flex items-center gap-2">
                <RefreshCw size={20} />
                Regenerate Signing Secret
              </DialogTitle>
              <DialogDescription>
                The old secret will immediately stop working. Update your integration with the new secret.
              </DialogDescription>
            </DialogHeader>
            <div className="px-6 pb-6">
              {newSecret ? (
                <div className="space-y-4">
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="text-yellow-600 flex-shrink-0 mt-0.5" size={20} />
                      <div>
                        <p className="font-medium text-yellow-800">Save your new secret!</p>
                        <p className="text-sm text-yellow-700">This is the only time you&apos;ll see it.</p>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Input
                      type={showSecret ? 'text' : 'password'}
                      value={newSecret}
                      readOnly
                      className="font-mono text-sm"
                    />
                    <Button variant="outline" size="icon" onClick={() => setShowSecret(!showSecret)}>
                      {showSecret ? <EyeOff size={16} /> : <Eye size={16} />}
                    </Button>
                    <Button variant="outline" size="icon" onClick={() => copyToClipboard(newSecret)}>
                      {copiedSecret ? <Check size={16} className="text-green-600" /> : <Copy size={16} />}
                    </Button>
                  </div>
                  <DialogFooter>
                    <Button onClick={() => { setIsRegenerateDialogOpen(false); setNewSecret(null); setShowSecret(false); setSelectedWebhook(null) }}>
                      Done
                    </Button>
                  </DialogFooter>
                </div>
              ) : (
                <>
                  {selectedWebhook && (
                    <div className="bg-gray-50 rounded-lg p-3 mb-4">
                      <p className="font-medium truncate">{selectedWebhook.url}</p>
                    </div>
                  )}
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setIsRegenerateDialogOpen(false)}>Cancel</Button>
                    <Button onClick={handleRegenerate}>Regenerate</Button>
                  </DialogFooter>
                </>
              )}
            </div>
          </DialogContent>
        </Dialog>

        {/* Delivery Logs Dialog */}
        <Dialog open={isDeliveryLogOpen} onOpenChange={setIsDeliveryLogOpen}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader className="px-6 pt-6">
              <DialogTitle>Delivery Logs</DialogTitle>
              <DialogDescription>
                Recent delivery attempts for this endpoint (last 30)
              </DialogDescription>
            </DialogHeader>
            <div className="px-6 pb-6">
              {logsLoading ? (
                <div className="flex justify-center py-8">
                  <RefreshCw className="animate-spin text-gray-400" size={24} />
                </div>
              ) : deliveryLogs.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Status</TableHead>
                      <TableHead>Event</TableHead>
                      <TableHead>Response</TableHead>
                      <TableHead>Attempt</TableHead>
                      <TableHead>Time</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {deliveryLogs.map((log) => (
                      <TableRow key={log.id}>
                        <TableCell>
                          {log.success ? (
                            <CheckCircle size={16} className="text-green-600" />
                          ) : (
                            <XCircle size={16} className="text-red-500" />
                          )}
                        </TableCell>
                        <TableCell>
                          <code className="bg-gray-100 px-2 py-0.5 rounded text-xs">{log.event_name}</code>
                        </TableCell>
                        <TableCell>
                          {log.response_status ? (
                            <Badge
                              variant={log.success ? 'default' : 'secondary'}
                              className={log.success ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}
                            >
                              {log.response_status}
                            </Badge>
                          ) : (
                            <span className="text-sm text-gray-400">{log.error_message ? 'Error' : '-'}</span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-gray-600">#{log.attempt}</TableCell>
                        <TableCell className="text-sm text-gray-500">{formatDate(log.created_at)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="text-center py-8 text-gray-500">
                  <Clock size={32} className="mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No delivery logs yet</p>
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      </>
    </PlanRestrictedFeature>
  )
}

// Webhook Card Component
const WebhookCard: React.FC<{
  webhook: WebhookEndpoint
  isEditing: boolean
  editUrl: string
  editDescription: string
  editEvents: string[]
  onEditUrl: (v: string) => void
  onEditDescription: (v: string) => void
  onEditEvents: (v: string[]) => void
  onStartEdit: () => void
  onSaveEdit: () => void
  onCancelEdit: () => void
  onToggleActive: () => void
  onTest: () => void
  onViewLogs: () => void
  onRegenerate: () => void
  onDelete: () => void
  formatDate: (d: string) => string
  eventCategories: EventCategory[]
  eventRegistry: Record<string, EventInfo>
}> = ({
  webhook,
  isEditing,
  editUrl,
  editDescription,
  editEvents,
  onEditUrl,
  onEditDescription,
  onEditEvents,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onToggleActive,
  onTest,
  onViewLogs,
  onRegenerate,
  onDelete,
  formatDate,
  eventCategories,
  eventRegistry,
}) => {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="border rounded-lg">
      {/* Header row */}
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <Switch
            checked={webhook.is_active}
            onCheckedChange={onToggleActive}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="font-medium text-sm truncate">{webhook.url}</p>
              <Badge
                variant={webhook.is_active ? 'default' : 'secondary'}
                className={webhook.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}
              >
                {webhook.is_active ? 'Active' : 'Inactive'}
              </Badge>
            </div>
            {webhook.description && (
              <p className="text-xs text-gray-500 truncate">{webhook.description}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <Button variant="ghost" size="sm" onClick={onTest} title="Send test event">
            <Send size={14} />
          </Button>
          <Button variant="ghost" size="sm" onClick={onViewLogs} title="View delivery logs">
            <Clock size={14} />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setExpanded(!expanded)}>
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </Button>
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="border-t px-4 py-3 bg-gray-50/50 space-y-3">
          {isEditing ? (
            <>
              <div className="space-y-2">
                <Label>Endpoint URL</Label>
                <Input value={editUrl} onChange={(e) => onEditUrl(e.target.value)} type="url" />
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea
                  value={editDescription}
                  onChange={(e) => onEditDescription(e.target.value)}
                  maxLength={500}
                />
              </div>
              <div className="space-y-2">
                <Label>Events</Label>
                <EventSelector categories={eventCategories} selectedEvents={editEvents} onChangeEvents={onEditEvents} />
              </div>
              <div className="flex gap-2 pt-2">
                <Button size="sm" onClick={onSaveEdit}>Save</Button>
                <Button size="sm" variant="outline" onClick={onCancelEdit}>Cancel</Button>
              </div>
            </>
          ) : (
            <>
              <div>
                <Label className="text-gray-500 text-xs">Events ({webhook.events.length})</Label>
                <div className="mt-1 space-y-1">
                  {webhook.events.map((event) => {
                    const info = eventRegistry[event]
                    return (
                      <EventPayloadRow key={event} eventId={event} info={info} />
                    )
                  })}
                </div>
              </div>
              <div className="flex items-center gap-4 text-xs text-gray-500">
                <span>Created {formatDate(webhook.creation_date)}</span>
                <span>Updated {formatDate(webhook.update_date)}</span>
              </div>
              <div className="flex gap-2 pt-1">
                <Button size="sm" variant="outline" onClick={onStartEdit}>Edit</Button>
                <Button size="sm" variant="outline" onClick={onRegenerate}>
                  <RefreshCw size={12} className="me-1" />
                  Rotate Secret
                </Button>
                <Button size="sm" variant="ghost" className="text-red-600 hover:text-red-700" onClick={onDelete}>
                  <Trash2 size={12} className="me-1" />
                  Delete
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// Expandable row showing an event name + its example payload
const EventPayloadRow: React.FC<{
  eventId: string
  info?: { description: string; data_schema: any }
}> = ({ eventId, info }) => {
  const [open, setOpen] = useState(false)
  return (
    <div className="border rounded text-xs">
      <div
        className="flex items-center gap-2 px-2 py-1.5 cursor-pointer hover:bg-gray-50"
        onClick={() => setOpen(!open)}
      >
        <code className="bg-gray-100 px-1.5 py-0.5 rounded font-medium text-gray-700">{eventId}</code>
        {info && <span className="text-gray-400 truncate">{info.description}</span>}
        <span className="ms-auto flex-shrink-0 text-gray-400">
          {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </span>
      </div>
      {open && info?.data_schema && (
        <pre className="px-3 py-2 bg-gray-50 border-t overflow-x-auto text-[11px] text-gray-600 leading-relaxed">
          {JSON.stringify(info.data_schema, null, 2)}
        </pre>
      )}
    </div>
  )
}

// Event Selector Component
const EventSelector: React.FC<{
  categories: EventCategory[]
  selectedEvents: string[]
  onChangeEvents: (events: string[]) => void
}> = ({ categories, selectedEvents, onChangeEvents }) => {
  const [previewEvent, setPreviewEvent] = useState<string | null>(null)

  const toggleEvent = (eventId: string) => {
    if (selectedEvents.includes(eventId)) {
      onChangeEvents(selectedEvents.filter((e) => e !== eventId))
    } else {
      onChangeEvents([...selectedEvents, eventId])
    }
  }

  const toggleCategory = (category: EventCategory) => {
    const categoryEventIds = category.events.map((e) => e.id)
    const allSelected = categoryEventIds.every((id) => selectedEvents.includes(id))
    if (allSelected) {
      onChangeEvents(selectedEvents.filter((e) => !categoryEventIds.includes(e)))
    } else {
      const newEvents = new Set([...selectedEvents, ...categoryEventIds])
      onChangeEvents([...newEvents])
    }
  }

  return (
    <div className="border rounded-lg max-h-[400px] overflow-y-auto">
      {categories.map((category) => {
        const categoryEventIds = category.events.map((e) => e.id)
        const selectedCount = categoryEventIds.filter((id) => selectedEvents.includes(id)).length

        return (
          <div key={category.label} className="border-b last:border-b-0">
            <div
              className="flex items-center justify-between px-3 py-2 bg-gray-50 cursor-pointer hover:bg-gray-100"
              onClick={() => toggleCategory(category)}
            >
              <span className="text-xs font-semibold text-gray-600 uppercase tracking-wider">
                {category.label}
              </span>
              <span className="text-xs text-gray-400">
                {selectedCount}/{categoryEventIds.length}
              </span>
            </div>
            <div className="px-3 py-1.5 space-y-0">
              {category.events.map((event) => (
                <div key={event.id}>
                  <div className="flex items-center gap-2 py-1.5 rounded px-1">
                    <Checkbox
                      checked={selectedEvents.includes(event.id)}
                      onCheckedChange={() => toggleEvent(event.id)}
                    />
                    <label
                      className="text-sm text-gray-700 cursor-pointer flex-1"
                      onClick={() => toggleEvent(event.id)}
                    >
                      {event.description}
                    </label>
                    <button
                      type="button"
                      className="text-gray-400 hover:text-gray-600 p-0.5 flex-shrink-0"
                      onClick={() => setPreviewEvent(previewEvent === event.id ? null : event.id)}
                      title="View example payload"
                    >
                      <code className="text-[10px]">{event.id}</code>
                      {previewEvent === event.id ? <ChevronUp size={10} className="inline ms-1" /> : <ChevronDown size={10} className="inline ms-1" />}
                    </button>
                  </div>
                  {previewEvent === event.id && event.data_schema && (
                    <pre className="mx-1 mb-1.5 px-3 py-2 bg-gray-50 border rounded text-[11px] text-gray-600 overflow-x-auto leading-relaxed">
{JSON.stringify(event.data_schema, null, 2)}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// Compact row used inside the Zapier hero card.
// Zapier-managed webhooks are read-only from LearnHouse's side — the Zap itself
// must be edited inside Zapier. We only expose enable/disable, view logs, and
// a delete escape hatch for admins who want to force-disconnect a Zap.
const ZapierRow: React.FC<{
  zap: WebhookEndpoint
  onToggleActive: () => void
  onDelete: () => void
  onViewLogs: () => void
}> = ({ zap, onToggleActive, onDelete, onViewLogs }) => {
  const title = zap.zap_name || zap.description || 'Zapier integration'
  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-white border border-gray-100 hover:border-gray-200 transition-colors">
      <Switch checked={zap.is_active} onCheckedChange={onToggleActive} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="font-medium text-sm text-gray-800 truncate">{title}</p>
          {zap.events[0] && (
            <code className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 font-mono flex-shrink-0">
              {zap.events[0]}
            </code>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        <Button
          variant="ghost"
          size="sm"
          onClick={onViewLogs}
          className="text-gray-400 hover:text-gray-700 hover:bg-gray-100 h-8 w-8 p-0"
          title="View delivery logs"
        >
          <Clock size={14} />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onDelete}
          className="text-gray-400 hover:text-red-600 hover:bg-red-50 h-8 w-8 p-0"
          title="Disconnect this Zap"
        >
          <Trash2 size={14} />
        </Button>
      </div>
    </div>
  )
}

export default OrgEditAutomations
