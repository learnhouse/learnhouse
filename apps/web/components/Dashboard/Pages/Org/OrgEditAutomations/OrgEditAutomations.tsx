'use client'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Image from 'next/image'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { toast } from 'react-hot-toast'
import { getAPIUrl } from '@services/config/config'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { apiFetch } from '@services/utils/ts/requests'
import { Switch } from '@components/ui/switch'
import { Checkbox } from '@components/ui/checkbox'
import {
  ArrowSquareOut,
  ArrowsClockwise,
  CaretDown,
  CaretRight,
  CheckCircle,
  ClockCounterClockwise,
  FlowArrow,
  PaperPlaneTilt,
  PencilSimple,
  Plus,
  Trash,
  WebhooksLogo,
  XCircle,
} from '@phosphor-icons/react'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import {
  Button,
  Chip,
  ConfirmDialog,
  EmptyState,
  FieldLabel,
  INPUT,
  TEXTAREA,
  buttonClass,
  formatRelative,
} from '@components/Dashboard/Shared/DashKit/DashKit'
import { CodeBlock, SecretOnce, StatusCode } from '@components/Dashboard/Pages/Org/Developers/devKit'

const ZapierLogo: React.FC<{ size?: number; className?: string }> = ({
  size = 20,
  className,
}) => (
  <Image
    src="/zapier_logo.png"
    alt="Zapier"
    width={size}
    height={size}
    className={className}
    unoptimized
  />
)
import {
  WebhookEndpoint,
  WebhookDeliveryLog,
  WebhookCreateRequest,
  createWebhookEndpoint,
  updateWebhookEndpoint,
  deleteWebhookEndpoint,
  regenerateWebhookSecret,
  sendTestEvent,
  getWebhookDeliveryLogs,
} from '@services/webhooks/webhooks'
import FeatureGate from '@components/Dashboard/Shared/FeatureGate/FeatureGate'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'

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

// Desktop table: header and rows are subgrids of the card grid.
const TABLE_GRID =
  'lg:grid lg:grid-cols-[minmax(0,2.4fr)_minmax(0,1.5fr)_minmax(0,0.8fr)_auto] lg:gap-x-4'
const ROW_GRID = 'lg:col-span-full lg:grid lg:grid-cols-subgrid lg:items-center lg:gap-x-4'
const LOG_GRID =
  'md:grid md:grid-cols-[auto_minmax(0,1.6fr)_minmax(0,0.9fr)_minmax(0,0.5fr)_minmax(0,0.9fr)_auto] md:gap-x-4'
const LOG_ROW = 'md:col-span-full md:grid md:grid-cols-subgrid md:items-center md:gap-x-4'

type EditorState = { mode: 'create' } | { mode: 'edit'; webhook: WebhookEndpoint }

const OrgEditAutomations: React.FC = () => {
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const org = useOrg() as any
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const { track } = useLHAnalytics('dashboard')

  // Fetch event registry from API
  const { data: eventsData } = useQuery<{ events: Record<string, EventInfo> }>({
    queryKey: org?.id ? ['org', org.id, 'webhooks-events'] : ['webhooks-events-disabled'],
    queryFn: () => apiFetch(`${getAPIUrl()}orgs/${org.id}/webhooks/events`, access_token),
    enabled: !!(org?.id && access_token),
    staleTime: 60_000,
  })
  const eventRegistry = eventsData?.events || {}
  const eventCategories = buildCategories(eventRegistry)
  const allEventIds = Object.keys(eventRegistry)

  // Dialog state
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<WebhookEndpoint | null>(null)
  const [regenTarget, setRegenTarget] = useState<WebhookEndpoint | null>(null)
  const [logsFor, setLogsFor] = useState<WebhookEndpoint | null>(null)
  // A freshly minted signing secret: shown once, then gone.
  const [secret, setSecret] = useState<{ value: string; kind: 'created' | 'regenerated'; url: string } | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  // Form state, shared by create and edit
  const [formUrl, setFormUrl] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formEvents, setFormEvents] = useState<string[]>([])

  // Delivery logs
  const [deliveryLogs, setDeliveryLogs] = useState<WebhookDeliveryLog[]>([])
  const [logsLoading, setLogsLoading] = useState(false)

  // Fetch webhooks
  const { data: webhooks, isLoading } = useQuery<WebhookEndpoint[]>({
    queryKey: org?.id ? queryKeys.org.automations(org.id) : ['automations-disabled'],
    queryFn: () => apiFetch(`${getAPIUrl()}orgs/${org.id}/webhooks`, access_token),
    enabled: !!(org?.id && access_token),
    staleTime: 60_000,
  })

  // Split webhooks by source so the Zapier and manual lists render separately.
  const allWebhooks = Array.isArray(webhooks) ? webhooks : []
  const zapierWebhooks = allWebhooks.filter((w) => w.source === 'zapier')
  const manualWebhooks = allWebhooks.filter((w) => w.source !== 'zapier')

  const openCreate = () => {
    setFormUrl('')
    setFormDescription('')
    setFormEvents([])
    setSecret(null)
    setEditor({ mode: 'create' })
  }

  const openEdit = (webhook: WebhookEndpoint) => {
    setFormUrl(webhook.url)
    setFormDescription(webhook.description || '')
    setFormEvents([...(webhook.events ?? [])])
    setSecret(null)
    setEditor({ mode: 'edit', webhook })
  }

  const closeEditor = () => {
    setEditor(null)
    setSecret(null)
  }

  const handleCreate = async () => {
    if (!formUrl.trim()) {
      toast.error(t('dashboard.organization.automations.toasts.url_required'))
      return
    }
    if (formEvents.length === 0) {
      toast.error(t('dashboard.organization.automations.toasts.select_event'))
      return
    }

    setSaving(true)
    const loadingToast = toast.loading(t('dashboard.organization.automations.toasts.creating'))
    try {
      const data: WebhookCreateRequest = {
        url: formUrl.trim(),
        description: formDescription.trim() || null,
        events: formEvents,
      }
      const response = await createWebhookEndpoint(org.id, data, access_token)

      if (response.success) {
        setSecret({ value: response.data.secret, kind: 'created', url: data.url })
        track(AnalyticsEvent.WebhookCreated, { events_count: formEvents.length })
        queryClient.invalidateQueries({ queryKey: queryKeys.org.automations(org.id) })
        toast.success(t('dashboard.organization.automations.toasts.created'), { id: loadingToast })
      } else {
        toast.error(response.data?.detail || t('dashboard.organization.automations.toasts.create_failed'), { id: loadingToast })
      }
    } catch (error: any) {
      toast.error(error.message || t('dashboard.organization.automations.toasts.create_failed'), { id: loadingToast })
    } finally {
      setSaving(false)
    }
  }

  const handleSaveEdit = async (webhook: WebhookEndpoint) => {
    setSaving(true)
    const loadingToast = toast.loading(t('dashboard.organization.automations.toasts.saving'))
    try {
      const response = await updateWebhookEndpoint(
        org.id,
        webhook.webhook_uuid,
        {
          url: formUrl.trim(),
          description: formDescription.trim() || null,
          events: formEvents,
        },
        access_token
      )
      if (response.success) {
        queryClient.invalidateQueries({ queryKey: queryKeys.org.automations(org.id) })
        toast.success(t('dashboard.organization.automations.toasts.updated'), { id: loadingToast })
        closeEditor()
      } else {
        toast.error(response.data?.detail || t('dashboard.organization.automations.toasts.update_failed'), { id: loadingToast })
      }
    } catch (error: any) {
      toast.error(error.message || t('dashboard.organization.automations.toasts.update_failed'), { id: loadingToast })
    } finally {
      setSaving(false)
    }
  }

  const handleToggleActive = async (webhook: WebhookEndpoint) => {
    const loadingToast = toast.loading(webhook.is_active ? t('dashboard.organization.automations.toasts.disabling') : t('dashboard.organization.automations.toasts.enabling'))
    try {
      const response = await updateWebhookEndpoint(
        org.id,
        webhook.webhook_uuid,
        { is_active: !webhook.is_active },
        access_token
      )
      if (response.success) {
        queryClient.invalidateQueries({ queryKey: queryKeys.org.automations(org.id) })
        toast.success(webhook.is_active ? t('dashboard.organization.automations.toasts.disabled') : t('dashboard.organization.automations.toasts.enabled'), { id: loadingToast })
      } else {
        toast.error(response.data?.detail || t('dashboard.organization.automations.toasts.update_failed'), { id: loadingToast })
      }
    } catch (error: any) {
      toast.error(error.message || t('dashboard.organization.automations.toasts.update_failed'), { id: loadingToast })
    }
  }

  const handleDelete = async () => {
    const target = deleteTarget
    if (!target) return
    const loadingToast = toast.loading(t('dashboard.organization.automations.toasts.deleting'))
    try {
      const response = await deleteWebhookEndpoint(org.id, target.webhook_uuid, access_token)
      if (response.success) {
        queryClient.invalidateQueries({ queryKey: queryKeys.org.automations(org.id) })
        toast.success(t('dashboard.organization.automations.toasts.deleted'), { id: loadingToast })
      } else {
        toast.error(response.data?.detail || t('dashboard.organization.automations.toasts.delete_failed'), { id: loadingToast })
      }
    } catch (error: any) {
      toast.error(error.message || t('dashboard.organization.automations.toasts.delete_failed'), { id: loadingToast })
    }
  }

  const handleRegenerate = async () => {
    const target = regenTarget
    if (!target) return
    const loadingToast = toast.loading(t('dashboard.organization.automations.toasts.regenerating'))
    try {
      const response = await regenerateWebhookSecret(org.id, target.webhook_uuid, access_token)
      if (response.success) {
        setSecret({ value: response.data.secret, kind: 'regenerated', url: target.url })
        queryClient.invalidateQueries({ queryKey: queryKeys.org.automations(org.id) })
        toast.success(t('dashboard.organization.automations.toasts.regenerated'), { id: loadingToast })
      } else {
        toast.error(response.data?.detail || t('dashboard.organization.automations.toasts.regenerate_failed'), { id: loadingToast })
      }
    } catch (error: any) {
      toast.error(error.message || t('dashboard.organization.automations.toasts.regenerate_failed'), { id: loadingToast })
    }
  }

  const handleTest = async (webhook: WebhookEndpoint) => {
    const loadingToast = toast.loading(t('dashboard.organization.automations.toasts.sending_test'))
    try {
      const response = await sendTestEvent(org.id, webhook.webhook_uuid, access_token)
      if (response.success) {
        toast.success(t('dashboard.organization.automations.toasts.test_sent'), { id: loadingToast })
      } else {
        toast.error(response.data?.detail || t('dashboard.organization.automations.toasts.test_failed'), { id: loadingToast })
      }
    } catch (error: any) {
      toast.error(error.message || t('dashboard.organization.automations.toasts.test_failed'), { id: loadingToast })
    }
  }

  const loadLogs = async (webhook: WebhookEndpoint) => {
    setLogsLoading(true)
    try {
      const response = await getWebhookDeliveryLogs(org.id, webhook.webhook_uuid, access_token, 30)
      if (response.success) {
        setDeliveryLogs(Array.isArray(response.data) ? response.data : [])
      }
    } catch {
      toast.error(t('dashboard.organization.automations.toasts.logs_failed'))
    } finally {
      setLogsLoading(false)
    }
  }

  const handleViewLogs = (webhook: WebhookEndpoint) => {
    setLogsFor(webhook)
    setDeliveryLogs([])
    loadLogs(webhook)
  }

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return dateStr
    return new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(d)
  }

  // Zapier hero card stays hidden until the LearnHouse Zapier app is live
  const showZapierHeroCard = false

  const createdSecret = editor?.mode === 'create' && secret?.kind === 'created' ? secret : null

  return (
    <FeatureGate feature="webhooks">
      <div className="flex flex-col gap-5">
        {/* ── Zapier hero card (hidden until the LearnHouse Zapier app is live) ────────────────────── */}
        {showZapierHeroCard && (
          <section className="bg-white rounded-2xl nice-shadow overflow-hidden">
            <div className="px-5 py-4 flex items-center gap-4">
              <div className="shrink-0 w-10 h-10 rounded-xl overflow-hidden nice-shadow">
                <ZapierLogo size={40} className="w-full h-full object-cover" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="font-semibold text-neutral-900 text-base">Zapier</h2>
                  <Chip tone="violet">{t('dashboard.organization.automations.beta')}</Chip>
                  {zapierWebhooks.length > 0 && (
                    <Chip tone="amber">{t('dashboard.organization.automations.active_zaps', { count: zapierWebhooks.length })}</Chip>
                  )}
                </div>
                <p className="text-neutral-500 text-sm mt-0.5">{t('dashboard.organization.automations.zapier_description')}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <a href="https://zapier.com/app/dashboard" target="_blank" rel="noopener noreferrer" className={buttonClass('ghost', 'sm')}>
                  {t('dashboard.organization.automations.manage_zaps')}
                </a>
                <a href="https://zapier.com/apps/learnhouse/integrations" target="_blank" rel="noopener noreferrer" className={buttonClass('secondary', 'sm')}>
                  {t('dashboard.organization.automations.connect')}
                  <ArrowSquareOut size={12} />
                </a>
              </div>
            </div>

            {zapierWebhooks.length > 0 && (
              <ul className="border-t border-neutral-100 divide-y divide-neutral-100">
                {zapierWebhooks.map((zap) => (
                  <ZapierRow
                    key={zap.webhook_uuid}
                    zap={zap}
                    onToggleActive={() => handleToggleActive(zap)}
                    onDelete={() => setDeleteTarget(zap)}
                    onViewLogs={() => handleViewLogs(zap)}
                  />
                ))}
              </ul>
            )}
          </section>
        )}

        {/* ── Manual webhooks ──────────────────────────────────────── */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-white nice-shadow text-neutral-600 flex items-center justify-center shrink-0">
              <WebhooksLogo size={18} />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-neutral-900 leading-tight">
                {t('dashboard.organization.automations.webhooks_title')}
              </h2>
              <p className="text-sm text-neutral-500">{t('dashboard.organization.automations.webhooks_description')}</p>
            </div>
          </div>
          <Button variant="primary" icon={<Plus size={14} weight="bold" />} onClick={openCreate}>
            {t('dashboard.organization.automations.add_endpoint')}
          </Button>
        </div>

        <div className={`bg-white rounded-2xl nice-shadow overflow-hidden ${TABLE_GRID}`}>
          {(isLoading || manualWebhooks.length > 0) && (
            <div className={`hidden ${ROW_GRID} px-5 py-3 border-b border-neutral-100 text-xs font-medium text-neutral-500`}>
              <span>{t('dashboard.organization.automations.endpoint_url')}</span>
              <span>{t('dashboard.organization.automations.events')}</span>
              <span>{t('common.status')}</span>
              <span className="sr-only">{t('dashboard.organization.api_access.actions')}</span>
            </div>
          )}

          {isLoading ? (
            <div className="animate-pulse divide-y divide-neutral-100 lg:col-span-full">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-4 px-5 py-4">
                  <div className="flex-1 space-y-2">
                    <div className="h-3.5 bg-neutral-100 rounded w-3/5" />
                    <div className="h-3 bg-neutral-100 rounded w-2/5" />
                  </div>
                  <div className="h-5 w-9 bg-neutral-100 rounded-full" />
                </div>
              ))}
            </div>
          ) : manualWebhooks.length === 0 ? (
            <div className="lg:col-span-full">
              <EmptyState
                icon={<FlowArrow size={22} />}
                title={t('dashboard.organization.automations.no_endpoints')}
                description={t('dashboard.organization.automations.no_endpoints_hint')}
                action={
                  <Button variant="primary" icon={<Plus size={14} weight="bold" />} onClick={openCreate}>
                    {t('dashboard.organization.automations.add_endpoint')}
                  </Button>
                }
              />
            </div>
          ) : (
            <ul className={`divide-y divide-neutral-100 ${ROW_GRID}`}>
              {manualWebhooks.map((webhook) => {
                const events = Array.isArray(webhook.events) ? webhook.events : []
                const open = expanded === webhook.webhook_uuid
                return (
                  <li key={webhook.webhook_uuid} className={`${ROW_GRID} ${open ? 'bg-neutral-50/60' : ''}`}>
                    <div className={`${ROW_GRID} px-5 py-3.5 flex flex-col gap-2.5`}>
                      <div className="min-w-0 flex items-start gap-2">
                        <button
                          type="button"
                          onClick={() => setExpanded(open ? null : webhook.webhook_uuid)}
                          aria-expanded={open}
                          aria-label={t('dashboard.organization.automations.events_count', { count: events.length })}
                          className="mt-0.5 -ms-1 w-5 h-5 rounded-md flex items-center justify-center text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 shrink-0"
                        >
                          {open ? <CaretDown size={12} /> : <CaretRight size={12} className="rtl:rotate-180" />}
                        </button>
                        <div className="min-w-0">
                          <code
                            dir="ltr"
                            className={`block font-mono text-[12.5px] truncate ${webhook.is_active ? 'text-neutral-900' : 'text-neutral-400'}`}
                            title={webhook.url}
                          >
                            {webhook.url}
                          </code>
                          {webhook.description && (
                            <p className="mt-0.5 text-xs text-neutral-500 truncate">{webhook.description}</p>
                          )}
                        </div>
                      </div>
                      <div className="min-w-0 flex flex-wrap items-center gap-1 ps-6 lg:ps-0">
                        {events.slice(0, 2).map((ev) => (
                          <code key={ev} className="font-mono text-[11px] text-neutral-600 bg-neutral-100 rounded-md px-1.5 py-0.5 truncate max-w-[180px]">
                            {ev}
                          </code>
                        ))}
                        {events.length > 2 && (
                          <span className="text-xs font-semibold text-neutral-400 tabular-nums">+{events.length - 2}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 ps-6 lg:ps-0">
                        <Switch
                          checked={webhook.is_active}
                          onCheckedChange={() => handleToggleActive(webhook)}
                          aria-label={webhook.is_active ? t('dashboard.organization.automations.active') : t('dashboard.organization.automations.inactive')}
                        />
                        <span className={`text-xs font-medium ${webhook.is_active ? 'text-emerald-700' : 'text-neutral-400'}`}>
                          {webhook.is_active ? t('dashboard.organization.automations.active') : t('dashboard.organization.automations.inactive')}
                        </span>
                      </div>
                      <div className="flex items-center gap-0.5 ps-5 lg:ps-0 lg:justify-end">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleTest(webhook)}
                          title={t('dashboard.organization.automations.send_test_event')}
                          aria-label={t('dashboard.organization.automations.send_test_event')}
                          icon={<PaperPlaneTilt size={15} />}
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleViewLogs(webhook)}
                          title={t('dashboard.organization.automations.view_delivery_logs')}
                          aria-label={t('dashboard.organization.automations.view_delivery_logs')}
                          icon={<ClockCounterClockwise size={15} />}
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEdit(webhook)}
                          title={t('dashboard.organization.automations.edit')}
                          aria-label={t('dashboard.organization.automations.edit')}
                          icon={<PencilSimple size={15} />}
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setRegenTarget(webhook)}
                          title={t('dashboard.organization.automations.rotate_secret')}
                          aria-label={t('dashboard.organization.automations.rotate_secret')}
                          icon={<ArrowsClockwise size={15} />}
                        />
                        <Button
                          variant="danger-ghost"
                          size="icon"
                          onClick={() => setDeleteTarget(webhook)}
                          title={t('common.delete')}
                          aria-label={t('common.delete')}
                          icon={<Trash size={15} />}
                        />
                      </div>
                    </div>
                    {open && (
                      <div className="lg:col-span-full pe-5 pb-4 ps-11 flex flex-col gap-2">
                        <div className="flex flex-col gap-1.5">
                          {events.map((event) => (
                            <EventPayloadRow key={event} eventId={event} info={eventRegistry[event]} />
                          ))}
                        </div>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-neutral-400">
                          <span>{t('dashboard.organization.automations.created_on', { date: formatDate(webhook.creation_date) })}</span>
                          <span>{t('dashboard.organization.automations.updated_on', { date: formatDate(webhook.update_date) })}</span>
                        </div>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>

      {/* Create / edit endpoint */}
      <Modal
        isDialogOpen={!!editor}
        onOpenChange={(open) => !open && closeEditor()}
        size="lg"
        closeOnOutsideClick={!createdSecret}
        preventClose={saving}
        icon={createdSecret ? <CheckCircle size={17} weight="fill" className="text-emerald-500" /> : <WebhooksLogo size={16} />}
        dialogTitle={
          createdSecret
            ? t('dashboard.developers.automations.endpoint_ready')
            : editor?.mode === 'edit'
              ? t('dashboard.developers.automations.edit_title')
              : t('dashboard.organization.automations.add_dialog_title')
        }
        dialogDescription={createdSecret ? createdSecret.url : t('dashboard.organization.automations.add_dialog_desc')}
        footer={
          createdSecret ? (
            <div className="flex justify-end">
              <Button variant="primary" onClick={closeEditor}>
                {t('dashboard.organization.automations.done')}
              </Button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-neutral-400 tabular-nums">
                {t('dashboard.organization.automations.events_subscribed', { count: formEvents.length })}
              </span>
              <div className="flex gap-2">
                <Button onClick={closeEditor} disabled={saving}>
                  {t('common.cancel')}
                </Button>
                <Button
                  variant="primary"
                  loading={saving}
                  onClick={() => (editor?.mode === 'edit' ? handleSaveEdit(editor.webhook) : handleCreate())}
                >
                  {editor?.mode === 'edit' ? t('common.save') : t('dashboard.organization.automations.create_endpoint')}
                </Button>
              </div>
            </div>
          )
        }
        dialogContent={
          createdSecret ? (
            <SecretOnce
              title={t('dashboard.organization.automations.save_secret_title')}
              hint={t('dashboard.organization.automations.save_secret_hint')}
              label={t('dashboard.organization.automations.signing_secret')}
              value={createdSecret.value}
            />
          ) : (
            <div className="flex flex-col gap-5">
              <label className="block">
                <FieldLabel>{t('dashboard.organization.automations.endpoint_url_required')}</FieldLabel>
                <input
                  autoFocus
                  type="url"
                  dir="ltr"
                  className={`${INPUT} font-mono text-[13px]`}
                  value={formUrl}
                  onChange={(e) => setFormUrl(e.target.value)}
                  placeholder="https://example.com/webhooks/learnhouse"
                />
              </label>
              <label className="block">
                <FieldLabel>{t('dashboard.organization.automations.description')}</FieldLabel>
                <textarea
                  className={`${TEXTAREA} h-16`}
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  placeholder={t('dashboard.organization.automations.description_placeholder')}
                  maxLength={500}
                />
              </label>
              <div>
                <div className="flex items-center justify-between gap-3 mb-1.5">
                  <span className="text-sm font-semibold text-neutral-800">
                    {t('dashboard.organization.automations.events_required')}
                  </span>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" onClick={() => setFormEvents([...allEventIds])}>
                      {t('dashboard.organization.automations.select_all')}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setFormEvents([])}>
                      {t('dashboard.organization.automations.clear')}
                    </Button>
                  </div>
                </div>
                <EventSelector categories={eventCategories} selectedEvents={formEvents} onChangeEvents={setFormEvents} />
              </div>
            </div>
          )
        }
      />

      {/* Rotated secret */}
      <Modal
        isDialogOpen={secret?.kind === 'regenerated'}
        onOpenChange={(open) => !open && setSecret(null)}
        size="md"
        closeOnOutsideClick={false}
        icon={<ArrowsClockwise size={16} />}
        dialogTitle={t('dashboard.organization.automations.regenerate_title')}
        dialogDescription={secret?.url}
        footer={
          <div className="flex justify-end">
            <Button variant="primary" onClick={() => setSecret(null)}>
              {t('dashboard.organization.automations.done')}
            </Button>
          </div>
        }
        dialogContent={
          secret?.kind === 'regenerated' ? (
            <SecretOnce
              title={t('dashboard.organization.automations.save_new_secret_title')}
              hint={t('dashboard.organization.automations.save_new_secret_hint')}
              label={t('dashboard.organization.automations.signing_secret')}
              value={secret.value}
            />
          ) : null
        }
      />

      {/* Delivery logs */}
      <Modal
        isDialogOpen={!!logsFor}
        onOpenChange={(open) => !open && setLogsFor(null)}
        size="xl"
        icon={<ClockCounterClockwise size={16} />}
        dialogTitle={t('dashboard.organization.automations.delivery_logs')}
        dialogDescription={
          logsFor ? (
            <span className="font-mono text-xs" dir="ltr">
              {logsFor.url}
            </span>
          ) : (
            t('dashboard.organization.automations.delivery_logs_desc')
          )
        }
        headerActions={
          logsFor ? (
            <Button
              size="sm"
              onClick={() => loadLogs(logsFor)}
              disabled={logsLoading}
              icon={<ArrowsClockwise size={13} className={logsLoading ? 'animate-spin' : ''} />}
            >
              {t('dashboard.developers.automations.refresh')}
            </Button>
          ) : undefined
        }
        dialogContent={
          <DeliveryLogs logs={deliveryLogs} loading={logsLoading} formatDate={formatDate} />
        }
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t('dashboard.organization.automations.delete_title')}
        message={
          <>
            {t('dashboard.organization.automations.delete_desc')}
            {deleteTarget && <EndpointRef webhook={deleteTarget} />}
          </>
        }
        confirmLabel={t('dashboard.organization.automations.delete_endpoint')}
        onConfirm={handleDelete}
      />

      <ConfirmDialog
        open={!!regenTarget}
        onOpenChange={(open) => !open && setRegenTarget(null)}
        tone="info"
        title={t('dashboard.organization.automations.regenerate_title')}
        message={
          <>
            {t('dashboard.organization.automations.regenerate_desc')}
            {regenTarget && <EndpointRef webhook={regenTarget} />}
          </>
        }
        confirmLabel={t('dashboard.organization.automations.regenerate')}
        onConfirm={handleRegenerate}
      />
    </FeatureGate>
  )
}

function EndpointRef({ webhook }: { webhook: WebhookEndpoint }) {
  const { t } = useTranslation()
  const count = Array.isArray(webhook.events) ? webhook.events.length : 0
  return (
    <span className="mt-3 block rounded-lg bg-neutral-50 ring-1 ring-inset ring-neutral-200/70 px-3 py-2">
      <code dir="ltr" className="block font-mono text-xs text-neutral-800 truncate">{webhook.url}</code>
      <span className="block text-xs text-neutral-500 mt-0.5">
        {t('dashboard.organization.automations.events_subscribed', { count })}
      </span>
    </span>
  )
}

// Delivery attempts as a subgrid table. A row opens to show what was sent
// and what came back.
function DeliveryLogs({
  logs,
  loading,
  formatDate,
}: {
  logs: WebhookDeliveryLog[]
  loading: boolean
  formatDate: (_d: string) => string
}) {
  const { t, i18n } = useTranslation()
  const [open, setOpen] = useState<number | null>(null)

  if (loading && logs.length === 0) {
    return (
      <div className="animate-pulse divide-y divide-neutral-100 -mx-1">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-center gap-4 px-1 py-3">
            <div className="h-5 w-20 bg-neutral-100 rounded-full" />
            <div className="h-4 bg-neutral-100 rounded w-40" />
            <div className="h-4 bg-neutral-100 rounded w-12 ms-auto" />
          </div>
        ))}
      </div>
    )
  }

  if (logs.length === 0) {
    return (
      <EmptyState
        icon={<ClockCounterClockwise size={22} />}
        title={t('dashboard.organization.automations.no_logs')}
        description={t('dashboard.organization.automations.delivery_logs_desc')}
      />
    )
  }

  const pretty = (value: unknown) => {
    if (value == null || value === '') return ''
    if (typeof value === 'string') {
      try {
        return JSON.stringify(JSON.parse(value), null, 2)
      } catch {
        return value
      }
    }
    return JSON.stringify(value, null, 2)
  }

  return (
    <div className={`rounded-xl ring-1 ring-inset ring-neutral-200/80 overflow-hidden ${LOG_GRID}`}>
      <div className={`hidden ${LOG_ROW} px-4 py-2.5 border-b border-neutral-100 text-xs font-medium text-neutral-500`}>
        <span>{t('common.status')}</span>
        <span>{t('dashboard.organization.automations.log_event')}</span>
        <span>{t('dashboard.organization.automations.log_response')}</span>
        <span>{t('dashboard.organization.automations.log_attempt')}</span>
        <span>{t('dashboard.organization.automations.log_time')}</span>
        <span className="sr-only">{t('dashboard.developers.automations.details')}</span>
      </div>
      <ul className={`divide-y divide-neutral-100 ${LOG_ROW}`}>
        {logs.map((log) => {
          const isOpen = open === log.id
          return (
            <li key={log.id} className={`${LOG_ROW} ${isOpen ? 'bg-neutral-50/70' : ''}`}>
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : log.id)}
                aria-expanded={isOpen}
                className={`${LOG_ROW} w-full px-4 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-start hover:bg-neutral-50/70 transition-colors`}
              >
                <span>
                  {log.success ? (
                    <Chip tone="emerald" icon={<CheckCircle size={12} weight="fill" />}>
                      {t('dashboard.developers.automations.delivered')}
                    </Chip>
                  ) : (
                    <Chip tone="rose" icon={<XCircle size={12} weight="fill" />}>
                      {t('dashboard.developers.automations.failed')}
                    </Chip>
                  )}
                </span>
                <code className="min-w-0 truncate font-mono text-[12px] text-neutral-700">{log.event_name}</code>
                <span className="min-w-0" title={log.error_message || undefined}>
                  {log.response_status ? (
                    <StatusCode code={log.response_status} />
                  ) : (
                    <span className="text-xs text-rose-600">
                      {log.error_message ? t('dashboard.organization.automations.log_error') : '—'}
                    </span>
                  )}
                </span>
                <span className="text-xs text-neutral-500 tabular-nums">#{log.attempt}</span>
                <span className="text-xs text-neutral-500" title={formatDate(log.created_at)}>
                  {formatRelative(log.created_at, i18n.language) ?? formatDate(log.created_at)}
                </span>
                <span className="ms-auto md:ms-0 text-neutral-400">
                  {isOpen ? <CaretDown size={13} /> : <CaretRight size={13} className="rtl:rotate-180" />}
                </span>
              </button>
              {isOpen && (
                <div className="md:col-span-full px-4 pb-4 grid grid-cols-1 lg:grid-cols-2 gap-3">
                  <div className="min-w-0">
                    <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
                      {t('dashboard.developers.automations.request_payload')}
                    </p>
                    <CodeBlock
                      title="payload.json"
                      maxHeight="max-h-[260px]"
                      tabs={[{ key: 'req', label: 'payload.json', code: pretty(log.request_payload) || '{}', lang: 'json' }]}
                    />
                  </div>
                  <div className="min-w-0">
                    <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
                      {t('dashboard.developers.automations.response_body')}
                    </p>
                    <CodeBlock
                      title={log.response_status ? `HTTP ${log.response_status}` : 'error'}
                      maxHeight="max-h-[260px]"
                      tabs={[
                        {
                          key: 'res',
                          label: 'response',
                          code: pretty(log.response_body) || log.error_message || '—',
                          lang: 'json',
                        },
                      ]}
                    />
                  </div>
                </div>
              )}
            </li>
          )
        })}
      </ul>
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
    <div className="rounded-lg bg-white ring-1 ring-inset ring-neutral-200/80 overflow-hidden text-xs">
      <button
        type="button"
        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-start hover:bg-neutral-50"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <code className="font-mono font-medium text-neutral-800 bg-neutral-100 rounded px-1.5 py-0.5 shrink-0">{eventId}</code>
        {info && <span className="text-neutral-500 truncate">{info.description}</span>}
        <span className="ms-auto shrink-0 text-neutral-400">
          {open ? <CaretDown size={12} /> : <CaretRight size={12} className="rtl:rotate-180" />}
        </span>
      </button>
      {open && info?.data_schema && (
        <div className="p-2 pt-0">
          <CodeBlock
            title={`${eventId}.json`}
            maxHeight="max-h-[240px]"
            tabs={[{ key: eventId, label: `${eventId}.json`, code: JSON.stringify(info.data_schema, null, 2), lang: 'json' }]}
          />
        </div>
      )}
    </div>
  )
}

// Event Selector Component
const EventSelector: React.FC<{
  categories: EventCategory[]
  selectedEvents: string[]
  onChangeEvents: (_events: string[]) => void
}> = ({ categories, selectedEvents, onChangeEvents }) => {
  const { t } = useTranslation()
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

  if (categories.length === 0) {
    return (
      <div className="rounded-xl ring-1 ring-inset ring-neutral-200/80 px-4 py-6 animate-pulse space-y-2">
        <div className="h-3 bg-neutral-100 rounded w-1/3" />
        <div className="h-3 bg-neutral-100 rounded w-1/2" />
        <div className="h-3 bg-neutral-100 rounded w-2/5" />
      </div>
    )
  }

  return (
    <div className="rounded-xl ring-1 ring-inset ring-neutral-200/80 max-h-[380px] overflow-y-auto divide-y divide-neutral-100">
      {categories.map((category) => {
        const categoryEventIds = category.events.map((e) => e.id)
        const selectedCount = categoryEventIds.filter((id) => selectedEvents.includes(id)).length
        const all = selectedCount === categoryEventIds.length

        return (
          <div key={category.label}>
            <button
              type="button"
              className="sticky top-0 z-[1] w-full flex items-center justify-between px-3 py-2 bg-neutral-50 hover:bg-neutral-100 text-start"
              onClick={() => toggleCategory(category)}
              aria-pressed={all}
            >
              <span className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">{category.label}</span>
              <span className={`text-[11px] font-semibold tabular-nums ${selectedCount ? 'text-neutral-800' : 'text-neutral-400'}`}>
                {selectedCount}/{categoryEventIds.length}
              </span>
            </button>
            <div className="px-2 py-1">
              {category.events.map((event) => (
                <div key={event.id}>
                  <div className="flex items-center gap-2.5 py-1.5 px-1 rounded-md hover:bg-neutral-50">
                    <Checkbox
                      id={`ev-${event.id}`}
                      checked={selectedEvents.includes(event.id)}
                      onCheckedChange={() => toggleEvent(event.id)}
                    />
                    <label htmlFor={`ev-${event.id}`} className="text-sm text-neutral-700 cursor-pointer flex-1 min-w-0 truncate">
                      {event.description}
                    </label>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 text-neutral-400 hover:text-neutral-700 px-1 py-0.5 rounded shrink-0"
                      onClick={() => setPreviewEvent(previewEvent === event.id ? null : event.id)}
                      title={t('dashboard.organization.automations.view_example_payload')}
                      aria-expanded={previewEvent === event.id}
                    >
                      <code className="font-mono text-[10.5px]">{event.id}</code>
                      {previewEvent === event.id ? <CaretDown size={10} /> : <CaretRight size={10} className="rtl:rotate-180" />}
                    </button>
                  </div>
                  {previewEvent === event.id && event.data_schema && (
                    <div className="px-1 pb-2">
                      <CodeBlock
                        title={`${event.id}.json`}
                        maxHeight="max-h-[220px]"
                        tabs={[{ key: event.id, label: event.id, code: JSON.stringify(event.data_schema, null, 2), lang: 'json' }]}
                      />
                    </div>
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
// Zapier-managed webhooks are read-only from LearnHouse's side; the Zap itself
// must be edited inside Zapier. We only expose enable/disable, view logs, and
// a delete escape hatch for admins who want to force-disconnect a Zap.
const ZapierRow: React.FC<{
  zap: WebhookEndpoint
  onToggleActive: () => void
  onDelete: () => void
  onViewLogs: () => void
}> = ({ zap, onToggleActive, onDelete, onViewLogs }) => {
  const { t } = useTranslation()
  const title = zap.zap_name || zap.description || t('dashboard.organization.automations.zapier_integration')
  return (
    <li className="flex items-center gap-3 px-5 py-2.5">
      <Switch checked={zap.is_active} onCheckedChange={onToggleActive} />
      <div className="min-w-0 flex-1 flex items-center gap-2">
        <p className="font-medium text-sm text-neutral-800 truncate">{title}</p>
        {zap.events?.[0] && (
          <code className="text-[10.5px] px-1.5 py-0.5 rounded bg-neutral-100 text-neutral-600 font-mono shrink-0">
            {zap.events[0]}
          </code>
        )}
      </div>
      <Button
        variant="ghost"
        size="icon"
        onClick={onViewLogs}
        title={t('dashboard.organization.automations.view_delivery_logs')}
        aria-label={t('dashboard.organization.automations.view_delivery_logs')}
        icon={<ClockCounterClockwise size={15} />}
      />
      <Button
        variant="danger-ghost"
        size="icon"
        onClick={onDelete}
        title={t('dashboard.organization.automations.disconnect_zap')}
        aria-label={t('dashboard.organization.automations.disconnect_zap')}
        icon={<Trash size={15} />}
      />
    </li>
  )
}

export default OrgEditAutomations
