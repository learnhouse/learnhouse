'use client'
import React from 'react'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { CircleNotch, Clock, FlowArrow, Lightning, PencilSimple } from '@phosphor-icons/react'
import { Button, Modal, Skeleton, recipes } from '@/design'
import { createAutomation, errorMessage, getAutomationTemplates, listNotificationEvents, listPickerChannels } from '@services/ee/platform/api'
import { platformKeys } from '@services/ee/platform/keys'
import type { AutomationTemplate } from '@services/ee/platform/types'
import { shouldRetry, useAccessToken } from '@components/Admin/hooks'
import { QueryError } from '@components/Admin/Shared/AdminKit'
import { useScheduleLabel } from './shared'
import { Select } from './RuleBuilder'
import {
  AUTOMATION_GROUPS,
  ActionKindIcon,
  AutomationIcon,
  actionKind,
  automationRisks,
  automationVisual,
  type ActionKind,
  type AutomationGroup,
} from './automationVisuals'

// "Start from": compact template cards grouped by purpose, each with its
// icon, trigger and what it does. Creating from a template copies it switched
// off and in dry run.

const CARD =
  'group h-full flex flex-col gap-2 rounded-xl bg-white ring-1 ring-inset ring-neutral-100 p-3.5 text-start hover:bg-neutral-50 hover:ring-neutral-200 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/20 disabled:opacity-50 min-w-0'
const CHIP = 'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap'

export default function TemplateGallery({ open, onOpenChange }: { open: boolean; onOpenChange: (_open: boolean) => void }) {
  const { t } = useTranslation()
  const token = useAccessToken()
  const router = useRouter()
  const qc = useQueryClient()

  const templates = useQuery({
    queryKey: platformKeys.automationTemplates(),
    queryFn: () => getAutomationTemplates(token),
    enabled: open && !!token,
    retry: shouldRetry,
  })

  // Templates that post to a channel need one picked first (the API has no default channel).
  const [pending, setPending] = React.useState<AutomationTemplate | null>(null)
  const [channel, setChannel] = React.useState('')
  const channels = useQuery({
    queryKey: ['platform', 'notifications', 'channels', 'picker'],
    queryFn: () => listPickerChannels(token),
    enabled: open && !!token,
    retry: shouldRetry,
    staleTime: 5 * 60_000,
  })
  const channelList = (Array.isArray(channels.data) ? channels.data : []).filter((c) => c.enabled !== false)
  // Reopening the gallery starts from the template list again.
  const [wasOpen, setWasOpen] = React.useState(open)
  if (wasOpen !== open) {
    setWasOpen(open)
    if (!open) {
      setPending(null)
      setChannel('')
    }
  }
  const needsChannel = (tpl: AutomationTemplate) => (Array.isArray(tpl.actions) ? tpl.actions : []).some((a) => a.type === 'notify_channel')

  const create = useMutation({
    mutationFn: ({ tpl, channel_uuid }: { tpl: AutomationTemplate; channel_uuid?: string }) =>
      createAutomation(token, {
        channel_uuid,
        template: tpl.key,
        name: tpl.name,
        description: tpl.description,
        schedule: tpl.schedule,
        trigger: tpl.trigger,
        event_types: tpl.event_types,
        conditions: tpl.conditions,
        actions: tpl.actions,
        // Templates always start switched off and in dry run.
        enabled: false,
        dry_run: true,
      }),
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: platformKeys.automations() })
      toast.success(t('admin.automations.created_from_template'))
      onOpenChange(false)
      if (created?.automation_uuid) router.push(`/admin/automations/${created.automation_uuid}`)
    },
    onError: (err) => toast.error(errorMessage(err, t('admin.automations.create_failed'))),
  })

  // Event chips read "Organization created", not "org.created".
  const events = useQuery({
    queryKey: ['platform', 'notifications', 'events'],
    queryFn: () => listNotificationEvents(token),
    enabled: open && !!token,
    retry: shouldRetry,
    staleTime: 30 * 60_000,
  })
  const eventLabels = React.useMemo(
    () => new Map((Array.isArray(events.data) ? events.data : []).map((e) => [e.key, e.label || e.key])),
    [events.data]
  )
  const list = Array.isArray(templates.data) ? templates.data : []
  const grouped = AUTOMATION_GROUPS.map((g) => ({ group: g, items: list.filter((tpl) => automationVisual(tpl).group === g) })).filter((g) => g.items.length)

  return (
    <Modal
      isDialogOpen={open}
      onOpenChange={onOpenChange}
      size="xl"
      icon={<FlowArrow size={16} />}
      onBack={pending ? () => setPending(null) : undefined}
      dialogTitle={pending ? pending.name : t('admin.automations.gallery_title')}
      dialogDescription={pending ? t('admin.automations.pick_channel_desc') : t('admin.automations.gallery_desc')}
      preventClose={create.isPending}
      footer={
        pending ? (
          <>
            <Button onClick={() => setPending(null)} disabled={create.isPending}>
              {t('common.back')}
            </Button>
            <Button variant="primary" disabled={!channel} loading={create.isPending} onClick={() => create.mutate({ tpl: pending, channel_uuid: channel })}>
              {t('admin.automations.create')}
            </Button>
          </>
        ) : undefined
      }
      dialogContent={
        pending ? (
          <div className="space-y-3 max-w-md">
            <span className="flex items-center gap-2.5">
              <AutomationIcon automation={pending} />
              <span className="text-sm text-neutral-600">{pending.description}</span>
            </span>
            {channelList.length ? (
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-neutral-700">
                  {t('admin.automations.params.channel_uuid', { defaultValue: 'Channel' })}
                  <span className="text-rose-500"> *</span>
                </span>
                <Select
                  ariaLabel={t('admin.automations.params.channel_uuid', { defaultValue: 'Channel' })}
                  value={channel}
                  onChange={setChannel}
                  options={[
                    { value: '', label: t('admin.automations.builder.pick_channel') },
                    ...channelList.map((c) => ({ value: c.channel_uuid, label: c.kind ? `${c.name} · ${c.kind}` : c.name })),
                  ]}
                />
              </label>
            ) : (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                {t('admin.automations.builder.create_channel_first')}{' '}
                <code className="font-mono" dir="ltr">
                  POST /api/v1/ee/superadmin/notifications/channels
                </code>
              </p>
            )}
          </div>
        ) : templates.error ? (
          <QueryError error={templates.error} onRetry={() => templates.refetch()} compact />
        ) : (
          <div className="space-y-6">
            <button
              type="button"
              className={`${CARD} w-full flex-row items-center`}
              disabled={create.isPending}
              onClick={() => {
                onOpenChange(false)
                router.push('/admin/automations/new')
              }}
            >
              <span className="h-8 w-8 rounded-lg shrink-0 inline-flex items-center justify-center bg-neutral-100 text-neutral-600">
                <PencilSimple size={16} weight="duotone" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-neutral-900">{t('admin.automations.blank_rule')}</span>
                <span className="block text-xs text-neutral-500">{t('admin.automations.blank_rule_desc')}</span>
              </span>
            </button>

            {templates.isLoading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-32 rounded-xl" />
                ))}
              </div>
            ) : (
              grouped.map(({ group, items }) => (
                <section key={group} aria-labelledby={`tpl-group-${group}`}>
                  <h3 id={`tpl-group-${group}`} className={`${recipes.eyebrow} mb-2`}>
                    {t(`admin.automations.groups.${group as AutomationGroup}`)}
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {items.map((tpl) => (
                      <TemplateCard
                        key={tpl.key}
                        tpl={tpl}
                        busy={create.isPending && create.variables?.tpl.key === tpl.key}
                        disabled={create.isPending}
                        onPick={() => (needsChannel(tpl) ? (setPending(tpl), setChannel(channelList[0]?.channel_uuid ?? '')) : create.mutate({ tpl }))}
                        eventLabels={eventLabels}
                      />
                    ))}
                  </div>
                </section>
              ))
            )}
          </div>
        )
      }
    />
  )
}

function TemplateCard({
  tpl,
  busy,
  disabled,
  onPick,
  eventLabels,
}: {
  tpl: AutomationTemplate
  busy: boolean
  disabled: boolean
  onPick: () => void
  eventLabels: Map<string, string>
}) {
  const { t } = useTranslation()
  const scheduleLabel = useScheduleLabel()
  const actions = Array.isArray(tpl.actions) ? tpl.actions : []
  const kinds = Array.from(new Set(actions.map((a) => actionKind(a.type)))) as ActionKind[]
  const risks = automationRisks(actions)
  const events = tpl.trigger === 'event' && Array.isArray(tpl.event_types) ? tpl.event_types : []

  return (
    <button type="button" className={CARD} disabled={disabled} onClick={onPick} title={tpl.description}>
      <span className="flex items-center gap-2.5 min-w-0">
        {busy ? (
          <span className="h-8 w-8 rounded-lg shrink-0 inline-flex items-center justify-center bg-neutral-100 text-neutral-500">
            <CircleNotch size={16} className="animate-spin" />
          </span>
        ) : (
          <AutomationIcon automation={tpl} />
        )}
        <span className="text-sm font-semibold text-neutral-900 leading-tight line-clamp-2">{tpl.name}</span>
      </span>
      <span className="text-xs text-neutral-500 leading-snug line-clamp-2">{tpl.description}</span>
      <span className="mt-auto flex flex-wrap gap-1 pt-1">
        {tpl.trigger === 'event' ? (
          <>
            <span className={`${CHIP} bg-violet-50 text-violet-600`}>
              <Lightning size={11} weight="fill" />
              {t('admin.automations.on_event')}
            </span>
            {events.map((ev) => (
              <span key={ev} className={`${CHIP} bg-neutral-100 text-neutral-600`} title={ev}>
                {eventLabels.get(ev) ?? ev}
              </span>
            ))}
          </>
        ) : (
          <span className={`${CHIP} bg-neutral-100 text-neutral-600`}>
            <Clock size={11} />
            {scheduleLabel(tpl.schedule)}
          </span>
        )}
        {kinds.map((k) => (
          <span key={k} className={`${CHIP} bg-neutral-100 text-neutral-600`}>
            <ActionKindIcon kind={k} size={11} />
            {t(`admin.automations.kind.${k}`)}
          </span>
        ))}
        {risks.email && <span className={`${CHIP} bg-sky-50 text-sky-600`}>{t('admin.automations.uses_email')}</span>}
        {risks.deletes && <span className={`${CHIP} bg-rose-50 text-rose-600`}>{t('admin.automations.deletes_after_grace')}</span>}
      </span>
    </button>
  )
}
