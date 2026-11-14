'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Bell, Funnel, MoonStars, X } from '@phosphor-icons/react'
import { Button, FieldLabel, INPUT, Modal, SegmentedControl } from '@/design'
import { errorMessage } from '@services/ee/platform/api'
import { createRule, opsKeys, updateRule, RULE_MODES, type Rule, type RuleBody, type RuleMode } from '@services/ee/platform/ops'
import { LIFECYCLES, PLANS, PLATFORM_ROLES } from '@services/ee/platform/types'
import { useAccessToken } from '@components/Admin/hooks'
import { Switch } from '@components/Admin/Shared/AdminKit'
import { MultiPick, SEVERITIES, useChannelList, useEventCatalog } from '@components/Admin/Shared/OpsKit'
import EventPicker from './EventPicker'

// Create / edit a notification rule: which events (wildcards allowed), which
// orgs (filters), how often (instant or a digest), quiet hours, and where it
// goes (a channel, or the in-app inbox of some roles).

interface Draft {
  name: string
  enabled: boolean
  event_types: string[]
  plan: string[]
  lifecycle: string[]
  tags: string[]
  severity_min: string
  mode: RuleMode
  quiet: boolean
  quiet_start: string
  quiet_end: string
  dest: 'channel' | 'inbox'
  channel_uuid: string
  inbox_roles: string[]
}

function toDraft(r: Rule | null): Draft {
  const f = r?.filters ?? {}
  return {
    name: r?.name ?? '',
    enabled: r?.enabled ?? true,
    event_types: Array.isArray(r?.event_types) ? r!.event_types : [],
    plan: Array.isArray(f.plan) ? f.plan : [],
    lifecycle: Array.isArray(f.lifecycle) ? f.lifecycle : [],
    tags: Array.isArray(f.tags_any) ? f.tags_any : [],
    severity_min: f.severity_min ?? '',
    mode: (RULE_MODES as string[]).includes(r?.mode ?? '') ? (r!.mode as RuleMode) : 'instant',
    quiet: !!r?.quiet_hours,
    quiet_start: r?.quiet_hours?.start ?? '22:00',
    quiet_end: r?.quiet_hours?.end ?? '07:00',
    dest: r && !r.channel_uuid ? 'inbox' : r ? 'channel' : 'inbox',
    channel_uuid: r?.channel_uuid ?? '',
    inbox_roles: Array.isArray(r?.inbox_roles) ? r!.inbox_roles : [],
  }
}

export default function RuleDialog({ open, rule, onClose }: { open: boolean; rule: Rule | null; onClose: () => void }) {
  const { t } = useTranslation()
  const token = useAccessToken()
  const queryClient = useQueryClient()
  const catalog = useEventCatalog()
  const channels = useChannelList(open)
  const [draft, setDraft] = React.useState<Draft>(() => toDraft(rule))
  const [tagInput, setTagInput] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [touched, setTouched] = React.useState(false)

  // Reset the form whenever the dialog opens on another rule (or "new").
  const openKey = open ? rule?.rule_uuid ?? 'new' : null
  const [seenKey, setSeenKey] = React.useState<string | null>(null)
  if (openKey !== seenKey) {
    setSeenKey(openKey)
    if (openKey) {
      setDraft(toDraft(rule))
      setTagInput('')
      setTouched(false)
    }
  }

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }))
  const addTag = () => {
    const v = tagInput.trim().toLowerCase()
    if (v && !draft.tags.includes(v)) set({ tags: [...draft.tags, v] })
    setTagInput('')
  }

  const errors = {
    name: !draft.name.trim() ? t('admin.notifications.rules.err_name') : undefined,
    events: draft.event_types.length === 0 ? t('admin.notifications.rules.err_events') : undefined,
    channel: draft.dest === 'channel' && !draft.channel_uuid ? t('admin.notifications.rules.err_channel') : undefined,
    quiet: draft.quiet && !(/^\d{2}:\d{2}$/.test(draft.quiet_start) && /^\d{2}:\d{2}$/.test(draft.quiet_end)) ? t('admin.notifications.rules.err_quiet') : undefined,
  }
  const valid = !Object.values(errors).some(Boolean)

  const save = async () => {
    setTouched(true)
    if (!valid) return
    const filters: RuleBody['filters'] = {}
    if (draft.plan.length) filters.plan = draft.plan
    if (draft.lifecycle.length) filters.lifecycle = draft.lifecycle
    if (draft.tags.length) filters.tags_any = draft.tags
    if (draft.severity_min) filters.severity_min = draft.severity_min
    const body: RuleBody = {
      name: draft.name.trim(),
      enabled: draft.enabled,
      event_types: draft.event_types,
      filters,
      mode: draft.mode,
      quiet_hours: draft.quiet ? { start: draft.quiet_start, end: draft.quiet_end } : null,
      channel_uuid: draft.dest === 'channel' ? draft.channel_uuid : null,
      inbox_roles: draft.dest === 'inbox' ? draft.inbox_roles : [],
    }
    setBusy(true)
    try {
      if (rule) await updateRule(token, rule.rule_uuid, body)
      else await createRule(token, body)
      toast.success(rule ? t('admin.notifications.rules.saved') : t('admin.notifications.rules.created'))
      queryClient.invalidateQueries({ queryKey: opsKeys.rules() })
      onClose()
    } catch (err) {
      toast.error(errorMessage(err, t('admin.common.error_desc')))
    } finally {
      setBusy(false)
    }
  }

  const err = (k: keyof typeof errors) => (touched ? errors[k] : undefined)

  const content = (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault()
        save()
      }}
    >
      <div className="flex items-end gap-3">
        <div className="flex-1 min-w-0">
          <FieldLabel error={err('name')}>{t('admin.notifications.rules.name')}</FieldLabel>
          <input className={INPUT} value={draft.name} onChange={(e) => set({ name: e.target.value })} maxLength={120} placeholder={t('admin.notifications.rules.name_placeholder')} />
        </div>
        <label className="flex items-center gap-2 h-9 text-sm text-neutral-600 shrink-0">
          <Switch checked={draft.enabled} onChange={(v) => set({ enabled: v })} label={t('admin.notifications.rules.enabled')} />
          <span className="hidden sm:inline">{t('admin.notifications.rules.enabled')}</span>
        </label>
      </div>

      <div>
        <FieldLabel error={err('events')} hint={t('admin.notifications.rules.events_hint')}>
          {t('admin.notifications.rules.events')}
        </FieldLabel>
        <EventPicker events={catalog.events} value={draft.event_types} onChange={(event_types) => set({ event_types })} />
      </div>

      <div>
        <FieldLabel hint={t('admin.notifications.rules.filters_hint')}>
          <span className="inline-flex items-center gap-1.5">
            <Funnel size={14} className="text-neutral-400" />
            {t('admin.notifications.rules.filters')}
          </span>
        </FieldLabel>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <MultiPick
            label={t('admin.notifications.rules.plan')}
            emptyLabel={t('admin.notifications.rules.any_plan')}
            options={PLANS.map((p) => ({ value: p, label: t(`admin.plans.${p}`, { defaultValue: p }) }))}
            value={draft.plan}
            onChange={(plan) => set({ plan })}
          />
          <MultiPick
            label={t('admin.notifications.rules.lifecycle')}
            emptyLabel={t('admin.notifications.rules.any_lifecycle')}
            options={LIFECYCLES.map((l) => ({ value: l, label: t(`admin.lifecycle.${l}`, { defaultValue: l }) }))}
            value={draft.lifecycle}
            onChange={(lifecycle) => set({ lifecycle })}
          />
          <select
            aria-label={t('admin.notifications.rules.severity_min')}
            className={INPUT}
            value={draft.severity_min}
            onChange={(e) => set({ severity_min: e.target.value })}
          >
            <option value="">{t('admin.notifications.rules.any_severity')}</option>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {t('admin.notifications.rules.severity_at_least', { severity: t(`admin.ops.severity.${s}`, { defaultValue: s }) })}
              </option>
            ))}
          </select>
          <div className="flex flex-wrap items-center gap-1.5 min-h-9 rounded-xl ring-1 ring-inset ring-neutral-200 px-2 py-1">
            {draft.tags.map((tag) => (
              <span key={tag} className="inline-flex items-center gap-1 rounded-md bg-neutral-100 ps-1.5 pe-0.5 py-0.5 text-[11px] font-medium text-neutral-700">
                {tag}
                <button type="button" aria-label={t('admin.notifications.rules.remove_tag', { tag })} onClick={() => set({ tags: draft.tags.filter((x) => x !== tag) })} className="h-4 w-4 inline-flex items-center justify-center rounded text-neutral-400 hover:text-neutral-800">
                  <X size={10} />
                </button>
              </span>
            ))}
            <input
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ',') {
                  e.preventDefault()
                  addTag()
                }
              }}
              onBlur={addTag}
              placeholder={draft.tags.length ? '' : t('admin.notifications.rules.tags_placeholder')}
              className="adm-bare-input flex-1 min-w-[6rem] h-7 bg-transparent text-sm outline-none placeholder:text-neutral-400"
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <div>
          <FieldLabel>{t('admin.notifications.rules.mode')}</FieldLabel>
          <div className="max-w-full overflow-x-auto">
            <SegmentedControl
              ariaLabel={t('admin.notifications.rules.mode')}
              value={draft.mode}
              onChange={(mode) => set({ mode })}
              options={RULE_MODES.map((m) => ({ key: m, label: t(`admin.notifications.modes.${m}`) }))}
            />
          </div>
        </div>
        <div>
          <FieldLabel hint={t('admin.notifications.rules.quiet_hint')}>
            <span className="inline-flex items-center gap-1.5">
              <MoonStars size={14} className="text-indigo-500" />
              {t('admin.notifications.rules.quiet')}
            </span>
          </FieldLabel>
          <div className="flex flex-wrap items-center gap-2">
            <Switch checked={draft.quiet} onChange={(quiet) => set({ quiet })} label={t('admin.notifications.rules.quiet')} />
            {draft.quiet && (
              <>
                <input type="time" aria-label={t('admin.notifications.rules.quiet_start')} className={`${INPUT} w-28`} value={draft.quiet_start} onChange={(e) => set({ quiet_start: e.target.value })} />
                <span className="text-xs text-neutral-400">–</span>
                <input type="time" aria-label={t('admin.notifications.rules.quiet_end')} className={`${INPUT} w-28`} value={draft.quiet_end} onChange={(e) => set({ quiet_end: e.target.value })} />
              </>
            )}
          </div>
          {err('quiet') && <p className="mt-1 text-xs text-rose-600">{err('quiet')}</p>}
        </div>
      </div>

      <div>
        <FieldLabel error={err('channel')}>{t('admin.notifications.rules.destination')}</FieldLabel>
        <div className="mb-2.5">
          <SegmentedControl
            ariaLabel={t('admin.notifications.rules.destination')}
            value={draft.dest}
            onChange={(dest) => set({ dest })}
            options={[
              { key: 'inbox', label: t('admin.notifications.rules.dest_inbox') },
              { key: 'channel', label: t('admin.notifications.rules.dest_channel') },
            ]}
          />
        </div>
        {draft.dest === 'channel' ? (
          channels.channels.length === 0 && !channels.isLoading ? (
            <p className="text-sm text-neutral-500">{t('admin.notifications.rules.no_channels')}</p>
          ) : (
            <select aria-label={t('admin.notifications.rules.dest_channel')} className={INPUT} value={draft.channel_uuid} onChange={(e) => set({ channel_uuid: e.target.value })}>
              <option value="">{t('admin.notifications.rules.pick_channel')}</option>
              {channels.channels.map((c) => (
                <option key={c.channel_uuid} value={c.channel_uuid}>
                  {c.name} · {t(`admin.notifications.kinds.${c.kind}`, { defaultValue: c.kind })}
                  {c.enabled ? '' : ` (${t('admin.notifications.rules.off')})`}
                </option>
              ))}
            </select>
          )
        ) : (
          <div className="space-y-1.5">
            <MultiPick
              className="w-full"
              icon={<Bell size={14} />}
              label={t('admin.notifications.rules.inbox_roles')}
              emptyLabel={t('admin.notifications.rules.everyone')}
              options={PLATFORM_ROLES.map((r) => ({ value: r, label: t(`admin.roles.${r}`) }))}
              value={draft.inbox_roles}
              onChange={(inbox_roles) => set({ inbox_roles })}
            />
            <p className="text-xs text-neutral-500">{t('admin.notifications.rules.inbox_hint')}</p>
          </div>
        )}
      </div>
      <button type="submit" hidden />
    </form>
  )

  return (
    <Modal
      isDialogOpen={open}
      onOpenChange={(o) => !o && onClose()}
      preventClose={busy}
      size="lg"
      icon={<Bell size={18} />}
      dialogTitle={rule ? t('admin.notifications.rules.edit_title', { name: rule.name }) : t('admin.notifications.rules.new_title')}
      dialogDescription={t('admin.notifications.rules.dialog_desc')}
      dialogContent={content}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onClick={save} loading={busy} disabled={touched && !valid}>
            {rule ? t('common.save') : t('admin.notifications.rules.create')}
          </Button>
        </>
      }
    />
  )
}
