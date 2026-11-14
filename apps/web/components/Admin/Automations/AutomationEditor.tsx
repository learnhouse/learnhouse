'use client'
import React from 'react'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { ClockCounterClockwise, Eye, FlowArrow, Funnel, Lightning, Play, SlidersHorizontal, Trash } from '@phosphor-icons/react'
import {
  Button,
  ConfirmDialog,
  DashPage,
  EmptyState,
  FieldLabel,
  INPUT,
  Modal,
  Panel,
  SectionCard,
  SegmentedControl,
  SettingRow,
  Skeleton,
  StickySaveBar,
  SubTabPanel,
  SubTabs,
  TEXTAREA,
  useSubTab,
} from '@/design'
import {
  createAutomation,
  deleteAutomation,
  errorMessage,
  getAutomationSchema,
  getAutomation,
  isNotAvailable,
  listAutomations,
  runAutomation,
  updateAutomation,
  errorStatus,
  fieldErrors,
  getTeam,
  listPickerChannels,
  listPickerEmailTemplates,
} from '@services/ee/platform/api'
import { platformKeys } from '@services/ee/platform/keys'
import type { Automation, AutomationAction, AutomationCondition } from '@services/ee/platform/types'
import { shouldRetry, useAccessToken, usePlatformMe } from '@components/Admin/hooks'
import { AdminHeader, CopyLinkButton, QueryError, Switch, adminPath } from '@components/Admin/Shared/AdminKit'
import { ActionsEditor, ConditionsEditor, MultiPick, Select, type PickerData } from './RuleBuilder'
import { NO_ERRORS, coerceRule, parseRuleError, type RuleErrors } from './ruleErrors'
import DeletionDryRunGate, { dryRunLocked } from './DeletionDryRunGate'
import { actionParams } from './shared'
import { DryRunPill, RunStatusPill, actionsMissingChannel, useEventLabels, useScheduleLabel, useTriggerLabel } from './shared'
import { EnableConfirm } from './AutomationsPage'
import PreviewPanel from './PreviewPanel'
import { AutomationIcon } from './automationVisuals'
import RunHistory from './RunHistory'
import OrgTargetPicker, { type OrgTarget } from './OrgTargetPicker'

interface Draft {
  name: string
  description: string
  schedule: string
  dry_run: boolean
  max_actions_per_run: number
  conditions: AutomationCondition[]
  actions: AutomationAction[]
  /** `schedule` (runs on `schedule`) or `event` (runs when one of `event_types` happens). */
  trigger: string
  event_types: string[]
  allow_repeats: boolean
}

const BLANK: Draft = {
  name: '',
  description: '',
  schedule: 'daily',
  dry_run: true,
  max_actions_per_run: 25,
  conditions: [],
  actions: [],
  trigger: 'schedule',
  event_types: [],
  allow_repeats: false,
}
const SECTIONS = ['rule', 'preview', 'runs'] as const
type Section = (typeof SECTIONS)[number]

function toDraft(a?: Automation | null): Draft {
  if (!a) return BLANK
  return {
    name: a.name ?? '',
    description: a.description ?? '',
    schedule: a.schedule ?? 'daily',
    dry_run: a.dry_run ?? true,
    max_actions_per_run: a.max_actions_per_run ?? 25,
    conditions: Array.isArray(a.conditions) ? a.conditions : [],
    actions: Array.isArray(a.actions) ? a.actions : [],
    trigger: a.trigger === 'event' ? 'event' : 'schedule',
    event_types: Array.isArray(a.event_types) ? a.event_types : [],
    allow_repeats: !!a.allow_repeats,
  }
}

function validate(d: Draft, t: (_k: string, _o?: Record<string, unknown>) => string, cap = 200): string | null {
  if (!d.name.trim()) return t('admin.automations.validation.name')
  if (!d.actions.length) return t('admin.automations.validation.actions')
  if (d.trigger === 'event' && !d.event_types.length) return t('admin.automations.validation.events')
  if (!Number.isInteger(d.max_actions_per_run) || d.max_actions_per_run < 1 || d.max_actions_per_run > cap) return t('admin.automations.validation.max', { max: cap })
  const missing = d.conditions.some(
    (c) => !['is_true', 'is_false'].includes(c.op) && (c.value === '' || c.value === undefined || (Array.isArray(c.value) && !c.value.length))
  )
  if (missing) return t('admin.automations.validation.values')
  return null
}

export default function AutomationEditor({ uuid }: { uuid?: string }) {
  const { t } = useTranslation()
  const token = useAccessToken()
  const me = usePlatformMe()
  const qc = useQueryClient()
  const router = useRouter()
  const isNew = !uuid
  const canManage = me.can('automations.manage')
  const canRun = me.can('automations.run')
  const readOnly = !canManage
  const scheduleLabel = useScheduleLabel()
  const triggerLabel = useTriggerLabel()
  const eventLabels = useEventLabels()

  const [section, setSection] = useSubTab<Section>('rule', SECTIONS, { rememberAs: false })
  const [confirmSave, setConfirmSave] = React.useState(false)
  const [confirmDelete, setConfirmDelete] = React.useState(false)
  const [confirmRun, setConfirmRun] = React.useState(false)
  const [enabling, setEnabling] = React.useState<Automation | null>(null)
  // Set when the API answers 409: deletion rules need a dry run/preview before going live.
  const [needsPreview, setNeedsPreview] = React.useState(false)
  // Event rules run by hand for one org (and optionally one of their events).
  const [eventRunOpen, setEventRunOpen] = React.useState(false)
  const [eventTarget, setEventTarget] = React.useState<OrgTarget>({})

  const schema = useQuery({
    queryKey: platformKeys.automationSchema(),
    queryFn: () => getAutomationSchema(token),
    enabled: !!token,
    retry: shouldRetry,
    staleTime: 10 * 60_000,
  })
  // GET /automations/{uuid}; a 404 (missing rule, or an older API without the
  // route) falls back to the list so both cases end in "found" or "not found".
  const rules = useQuery({
    queryKey: [...platformKeys.automations(), uuid ?? '', 'detail'],
    queryFn: async () => {
      try {
        return await getAutomation(token, uuid!)
      } catch (err) {
        if (!isNotAvailable(err)) throw err
        const list = await listAutomations(token)
        return (Array.isArray(list) ? list.find((r) => r.automation_uuid === uuid) : undefined) ?? null
      }
    },
    enabled: !!token && !isNew,
    retry: shouldRetry,
  })
  const rule = rules.data ?? null

  const saved = React.useMemo(() => toDraft(rule), [rule])
  const [draft, setDraft] = React.useState<Draft>(saved)
  // Deletion rules: preview and run are owner/admin only on the API. Gate on
  // automations.manage (the permission those roles have), not role names.
  const hasDeletion = [...(rule?.actions ?? []), ...(draft.actions ?? [])].some((x) => x?.type === 'schedule_org_deletion')
  const canRunRule = canRun && (!hasDeletion || canManage)
  // Re-sync the form when the saved rule changes (load, save, refetch).
  const [base, setBase] = React.useState<Draft>(saved)
  if (base !== saved) {
    setBase(saved)
    setDraft(saved)
  }
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved)
  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }))

  // Inline API validation errors; each clears as soon as its field changes.
  const [ruleErrors, setRuleErrors] = React.useState<RuleErrors>(NO_ERRORS)
  const setConditions = (conditions: AutomationCondition[]) => {
    setRuleErrors((e) => {
      const next = { ...e.conditions }
      for (const k of Object.keys(next)) {
        const i = Number(k)
        if (JSON.stringify(conditions[i]) !== JSON.stringify(draft.conditions[i])) delete next[i]
      }
      return { ...e, conditions: next }
    })
    patch({ conditions })
  }
  const setActions = (actions: AutomationAction[]) => {
    setRuleErrors((e) => {
      const next: RuleErrors['actions'] = {}
      for (const [k, byParam] of Object.entries(e.actions)) {
        const i = Number(k)
        const before = draft.actions[i]
        const after = actions[i]
        if (!after || before?.type !== after.type) continue
        const keep: Record<string, string> = {}
        for (const [param, msg] of Object.entries(byParam)) {
          const changed = param ? JSON.stringify(before?.params?.[param]) !== JSON.stringify(after.params?.[param]) : JSON.stringify(before) !== JSON.stringify(after)
          if (!changed) keep[param] = msg
        }
        if (Object.keys(keep).length) next[i] = keep
      }
      return { ...e, actions: next }
    })
    patch({ actions })
  }

  // Pickers for channel / email template / person params, loaded only when the schema uses them.
  const paramTypes = new Set(
    (Array.isArray(schema.data?.actions) ? schema.data!.actions : []).flatMap((a) => actionParams(a).map((p) => p.schema.type ?? ''))
  )
  const channelsQ = useQuery({
    queryKey: ['platform', 'notifications', 'channels', 'picker'],
    queryFn: () => listPickerChannels(token),
    enabled: !!token && paramTypes.has('channel'),
    retry: shouldRetry,
    staleTime: 5 * 60_000,
  })
  const templatesQ = useQuery({
    queryKey: ['platform', 'emails', 'templates', 'picker'],
    queryFn: () => listPickerEmailTemplates(token),
    enabled: !!token && paramTypes.has('email_template'),
    retry: shouldRetry,
    staleTime: 5 * 60_000,
  })
  const teamQ = useQuery({
    queryKey: platformKeys.team(),
    queryFn: () => getTeam(token),
    enabled: !!token && (paramTypes.has('user_ref') || paramTypes.has('user_ids')),
    retry: shouldRetry,
    staleTime: 5 * 60_000,
  })
  const pickers: PickerData = {
    channels: (Array.isArray(channelsQ.data) ? channelsQ.data : []).map((c) => ({
      value: c.channel_uuid,
      label: c.kind ? `${c.name} · ${t(`admin.automations.channel_kind.${c.kind}`, { defaultValue: c.kind })}` : c.name,
    })),
    templates: (Array.isArray(templatesQ.data) ? templatesQ.data : []).map((tp) => ({ value: tp.template_uuid, label: tp.name })),
    members: (Array.isArray(teamQ.data?.members) ? teamQ.data!.members : []).map((m) => ({ value: String(m.user_id), label: m.username })),
  }

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: platformKeys.automations() })
    qc.invalidateQueries({ queryKey: platformKeys.recentRuns() })
  }

  const save = useMutation({
    mutationFn: async () => {
      // Numbers as numbers ("24" is rejected), empty params dropped.
      const body = coerceRule(
        {
          ...draft,
          name: draft.name.trim(),
          description: draft.description.trim(),
          event_types: draft.trigger === 'event' ? draft.event_types : [],
        },
        schema.data
      )
      if (isNew) return createAutomation(token, { ...body, enabled: false, template: 'custom' })
      return updateAutomation(token, uuid!, body)
    },
    onSuccess: (res) => {
      invalidate()
      setRuleErrors(NO_ERRORS)
      toast.success(t('admin.automations.saved'))
      if (isNew && res?.automation_uuid) router.replace(`/admin/automations/${res.automation_uuid}`)
    },
    onError: (err) => {
      if (errorStatus(err) === 409) setNeedsPreview(true)
      // Structured field errors (loc: conditions.0.value, actions.1.params.grace_days, name…).
      const fe = fieldErrors(err)
      const locs = Object.values(fe)
      if (locs.length) {
        const next: RuleErrors = { actions: {}, conditions: {} }
        for (const e of locs) {
          const m = /^(conditions|actions)\.(\d+)(?:\.params\.([a-z_]+)|\.[a-z_]+)?$/.exec(e.loc)
          if (!m) continue
          const i = Number(m[2])
          if (m[1] === 'conditions') next.conditions[i] = e.message
          else next.actions[i] = { ...(next.actions[i] ?? {}), [m[3] ?? '']: e.message }
        }
        setRuleErrors(next)
        if (Object.keys(next.actions).length || Object.keys(next.conditions).length) setSection('rule')
        // The API's detail is a readable sentence ("action 2 (…): Grace period (days) must be…").
        toast.error(errorMessage(err, t('admin.automations.save_failed')))
        return
      }
      const raw = errorMessage(err, '')
      const parsed = raw ? parseRuleError(raw, schema.data, draft.actions, draft.conditions) : null
      if (!parsed) {
        toast.error(raw || t('admin.automations.save_failed'))
        return
      }
      setRuleErrors(parsed.errors)
      setSection('rule')
      const { summary } = parsed
      toast.error(
        summary.kind === 'action'
          ? t('admin.automations.builder.action_error', { n: summary.index + 1, action: summary.label, field: summary.field ?? '', message: summary.message, context: summary.field ? 'field' : undefined })
          : t('admin.automations.builder.condition_error', { n: summary.index + 1, field: summary.label, message: summary.message })
      )
    },
  })

  const remove = useMutation({
    mutationFn: () => deleteAutomation(token, uuid!),
    onSuccess: () => {
      invalidate()
      toast.success(t('admin.automations.deleted'))
      router.push('/admin/automations')
    },
    onError: (err) => toast.error(errorMessage(err, t('admin.automations.delete_failed'))),
  })

  const run = useMutation({
    mutationFn: (target?: { org_id?: number; event_key?: string }) => runAutomation(token, uuid!, target),
    onSuccess: (res) => {
      invalidate()
      qc.invalidateQueries({ queryKey: ['platform', 'automations', uuid, 'runs'] })
      toast.success(t('admin.automations.run_done', { matched: res?.matched ?? 0, acted: res?.acted ?? 0 }))
      // Land on the new run's drawer (a shareable link).
      if (res?.id) router.replace(adminPath.automation(uuid!, res.id), { scroll: false })
      else setSection('runs')
    },
    onError: (err) => {
      // A deletion rule must finish a dry run (or preview) before it can run live.
      if (errorStatus(err) === 409) setNeedsPreview(true)
      toast.error(errorMessage(err, t('admin.automations.run_failed')))
    },
  })

  const toggle = useMutation({
    mutationFn: (enabled: boolean) => updateAutomation(token, uuid!, { enabled }),
    onSuccess: (_d, enabled) => {
      invalidate()
      toast.success(enabled ? t('admin.automations.enabled_toast') : t('admin.automations.disabled_toast'))
    },
    onError: (err) => toast.error(errorMessage(err, t('admin.automations.save_failed'))),
  })

  const trySave = () => {
    const problem = validate(draft, (k, o) => t(k, o), cap)
    if (problem) {
      // Empty condition values are also flagged on the row itself.
      const empty = draft.conditions.flatMap((c, i) =>
        !['is_true', 'is_false'].includes(c.op) && (c.value === '' || c.value === undefined || c.value === null || (Array.isArray(c.value) && !c.value.length)) ? [i] : []
      )
      if (empty.length && problem === t('admin.automations.validation.values')) {
        setRuleErrors((e) => ({ ...e, conditions: { ...e.conditions, ...Object.fromEntries(empty.map((i) => [i, t('admin.automations.builder.value_required')])) } }))
      }
      toast.error(problem)
      return
    }
    const noChannel = actionsMissingChannel(draft.actions)
    if (noChannel.length) {
      setRuleErrors((e) => ({
        ...e,
        actions: { ...e.actions, ...Object.fromEntries(noChannel.map((i) => [i, { channel_uuid: t('admin.automations.builder.channel_required') }])) },
      }))
      toast.error(t('admin.automations.channel_missing_save'))
      return
    }
    // A live, enabled rule applies edits on its next run: say so first.
    if (!isNew && rule?.enabled && !draft.dry_run) setConfirmSave(true)
    else save.mutate()
  }

  // The API states the safety cap; 200 is the documented default.
  const cap = schema.data?.max_actions_per_run_cap && schema.data.max_actions_per_run_cap > 0 ? schema.data.max_actions_per_run_cap : 200

  const isEventRule = !isNew && rule?.trigger === 'event'
  const eventNames = (Array.isArray(rule?.event_types) ? rule!.event_types : []).map(eventLabels.label).join(', ') || '–'
  const eventOptions = (schema.data?.events?.length ? schema.data.events : eventLabels.keys).map((k) => ({ value: k, label: eventLabels.label(k) }))

  const title = isNew ? t('admin.automations.new_title') : rule?.name || t('admin.automations.title')
  const crumbs = [{ label: t('admin.automations.title'), href: '/admin/automations' }]

  if (schema.error || (rules.error && !isNew)) {
    return (
      <DashPage>
        <AdminHeader title={title} crumbs={crumbs} />
        <QueryError error={schema.error || rules.error} onRetry={() => (schema.error ? schema.refetch() : rules.refetch())} />
      </DashPage>
    )
  }

  const loading = schema.isLoading || (!isNew && rules.isLoading)
  if (!loading && !isNew && !rule) {
    return (
      <DashPage>
        <AdminHeader title={t('admin.automations.title')} crumbs={crumbs} />
        <Panel>
          <EmptyState
            icon={<FlowArrow size={22} />}
            title={t('admin.automations.not_found_title')}
            description={t('admin.automations.not_found_desc')}
            action={
              <Button onClick={() => router.push('/admin/automations')}>{t('admin.automations.back_to_list')}</Button>
            }
          />
        </Panel>
      </DashPage>
    )
  }

  const schedules = schema.data?.schedules?.length ? schema.data.schedules : ['hourly', 'daily', 'weekly']

  return (
    <DashPage bottom="xl">
      <AdminHeader
        title={title}
        crumbs={crumbs}
        subtitle={
          !isNew && rule ? (
            <span className="inline-flex flex-wrap items-center gap-2">
              <AutomationIcon automation={rule} size="sm" />
              <span>{triggerLabel(rule)}</span>
              {rule.dry_run && <DryRunPill />}
              {(rule.last_run?.status ?? rule.last_run_status) && <RunStatusPill status={rule.last_run?.status ?? rule.last_run_status} />}
              {isEventRule && (
                <span className="basis-full text-xs text-neutral-400">{t('admin.automations.run_event_note', { events: eventNames })}</span>
              )}
            </span>
          ) : (
            t('admin.automations.new_subtitle')
          )
        }
        actions={
          !isNew && rule ? (
            <>
              <label className="inline-flex items-center gap-2 h-8 px-2.5 rounded-lg bg-white nice-shadow text-[13px] font-semibold text-neutral-700">
                <Switch
                  checked={rule.enabled}
                  disabled={!canManage || toggle.isPending}
                  label={t('admin.automations.col_enabled')}
                  onChange={(v) => {
                    if (!v) return toggle.mutate(false)
                    if (actionsMissingChannel(rule.actions).length) return toast.error(t('admin.automations.channel_missing_enable'))
                    setEnabling(rule)
                  }}
                />
                {rule.enabled ? t('admin.automations.on') : t('admin.automations.off')}
              </label>
              {canRunRule && (
                <Button
                  variant={dirty ? 'secondary' : 'primary'}
                  icon={<Play size={14} weight="fill" />}
                  onClick={() => (isEventRule ? setEventRunOpen(true) : setConfirmRun(true))}
                  loading={run.isPending}
                >
                  {isEventRule ? t('admin.automations.run_for_org') : t('admin.automations.run_now')}
                </Button>
              )}
              <CopyLinkButton />
              {canManage && (
                <Button variant="danger-ghost" icon={<Trash size={14} />} onClick={() => setConfirmDelete(true)}>
                  {t('admin.automations.delete')}
                </Button>
              )}
            </>
          ) : undefined
        }
      />

      {needsPreview && <NeedsPreviewNotice onOpen={() => setSection('preview')} />}

      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-40 rounded-2xl" />
          <Skeleton className="h-56 rounded-2xl" />
        </div>
      ) : (
        <SubTabs
          value={section}
          onChange={setSection}
          ariaLabel={t('admin.automations.sections')}
          items={[
            { key: 'rule', label: t('admin.automations.tab_rule'), icon: <FlowArrow />, dirty },
            { key: 'preview', label: t('admin.automations.tab_preview'), icon: <Eye />, hidden: isNew },
            { key: 'runs', label: t('admin.automations.tab_runs'), icon: <ClockCounterClockwise />, hidden: isNew },
          ]}
        >
          <SubTabPanel tab="rule">
            {readOnly && <p className="rounded-xl bg-neutral-100 px-4 py-2.5 text-xs text-neutral-600">{t('admin.automations.read_only')}</p>}
            <SectionCard icon={<SlidersHorizontal size={18} />} title={t('admin.automations.settings_title')} description={t('admin.automations.settings_desc')}>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <label className="block md:col-span-2">
                  <FieldLabel>{t('admin.automations.field_name')}</FieldLabel>
                  <input className={INPUT} value={draft.name} maxLength={120} disabled={readOnly} onChange={(e) => patch({ name: e.target.value })} />
                </label>
                <label className="block md:col-span-2">
                  <FieldLabel hint={t('common.optional')}>{t('admin.automations.field_description')}</FieldLabel>
                  <textarea
                    className={TEXTAREA}
                    rows={2}
                    maxLength={500}
                    value={draft.description}
                    disabled={readOnly}
                    onChange={(e) => patch({ description: e.target.value })}
                  />
                </label>
                <div className="block md:col-span-2 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <FieldLabel>{t('admin.automations.field_trigger')}</FieldLabel>
                    {!readOnly && (
                      // Full-width halves on phones so long translations never push the page sideways.
                      <div className="w-full sm:w-auto [&>div]:grid [&>div]:w-full [&>div]:grid-cols-2 sm:[&>div]:inline-flex sm:[&>div]:w-auto [&_button]:justify-center [&_button]:min-w-0">
                      <SegmentedControl
                        value={draft.trigger === 'event' ? 'event' : 'schedule'}
                        onChange={(v) => patch({ trigger: v })}
                        ariaLabel={t('admin.automations.field_trigger')}
                        options={[
                          { key: 'schedule', label: t('admin.automations.trigger_schedule') },
                          { key: 'event', label: t('admin.automations.trigger_event') },
                        ]}
                      />
                      </div>
                    )}
                  </div>
                  {draft.trigger === 'event' ? (
                    <div className="space-y-3">
                      <p className="text-xs text-neutral-500">{t('admin.automations.trigger_event_desc')}</p>
                      {eventOptions.length ? (
                        <MultiPick
                          label={t('admin.automations.field_events')}
                          options={eventOptions}
                          value={draft.event_types}
                          onChange={(v) => patch({ event_types: v })}
                          disabled={readOnly}
                        />
                      ) : (
                        <p className="text-xs text-neutral-400">{t('admin.automations.no_events')}</p>
                      )}
                      <SettingRow
                        title={t('admin.automations.field_allow_repeats')}
                        description={t('admin.automations.field_allow_repeats_desc')}
                        control={
                          <Switch
                            checked={draft.allow_repeats}
                            disabled={readOnly}
                            onChange={(v) => patch({ allow_repeats: v })}
                            label={t('admin.automations.field_allow_repeats')}
                          />
                        }
                      />
                    </div>
                  ) : (
                    <div className="max-w-md">
                      <Select
                        ariaLabel={t('admin.automations.field_schedule')}
                        value={draft.schedule}
                        disabled={readOnly}
                        onChange={(v) => patch({ schedule: v })}
                        options={schedules.map((s) => ({ value: s, label: scheduleLabel(s) }))}
                      />
                    </div>
                  )}
                </div>
                <label className="block">
                  <FieldLabel>{t('admin.automations.field_max')}</FieldLabel>
                  <input
                    type="number"
                    min={1}
                    max={cap}
                    className={`${INPUT} tabular-nums`}
                    value={draft.max_actions_per_run}
                    disabled={readOnly}
                    onChange={(e) => patch({ max_actions_per_run: Number(e.target.value) })}
                  />
                  <span className="mt-1 block text-[11px] text-neutral-400">{t('admin.automations.field_max_hint', { max: cap })}</span>
                </label>
              </div>
              <div className="mt-5 border-t border-neutral-100 pt-4">
                <SettingRow
                  title={t('admin.automations.field_dry_run')}
                  description={t('admin.automations.field_dry_run_desc')}
                  control={<Switch checked={draft.dry_run} disabled={readOnly || (draft.dry_run && dryRunLocked(rule, draft))} onChange={(v) => patch({ dry_run: v })} label={t('admin.automations.field_dry_run')} />}
                />
                <DeletionDryRunGate rule={rule} draft={draft} isOwner={me.role === 'owner'} />
              </div>
              {isNew && <p className="mt-3 text-xs text-neutral-500">{t('admin.automations.new_disabled_note')}</p>}
            </SectionCard>

            <SectionCard icon={<Funnel size={18} />} title={t('admin.automations.conditions_title')} description={t('admin.automations.conditions_desc')}>
              {schema.data && (
                <ConditionsEditor schema={schema.data} conditions={draft.conditions} readOnly={readOnly} errors={ruleErrors.conditions} onChange={setConditions} />
              )}
            </SectionCard>

            <SectionCard icon={<Lightning size={18} />} title={t('admin.automations.actions_title')} description={
                draft.actions.some((a) => a.type.includes('delet')) ? t('admin.automations.actions_desc_deletion') : t('admin.automations.actions_desc')
              }>
              {schema.data && <ActionsEditor schema={schema.data} actions={draft.actions} readOnly={readOnly} pickers={pickers} errors={ruleErrors.actions} onChange={setActions} />}
            </SectionCard>
          </SubTabPanel>

          {!isNew && uuid && (
            <SubTabPanel tab="preview">
              <PreviewPanel
                uuid={uuid}
                canRun={canRunRule}
                dirty={dirty}
                events={isEventRule ? rule?.event_types ?? [] : undefined}
                eventLabel={eventLabels.label}
                eventNote={isEventRule ? t('admin.automations.preview_event_note', { events: eventNames }) : undefined}
                onPreviewed={() => setNeedsPreview(false)}
              />
            </SubTabPanel>
          )}
          {!isNew && uuid && (
            <SubTabPanel tab="runs" unmountWhenHidden>
              <RunHistory uuid={uuid} rule={rule} />
            </SubTabPanel>
          )}
        </SubTabs>
      )}

      {canManage && (
        <StickySaveBar
          visible={isNew ? !!draft.name || draft.conditions.length > 0 || draft.actions.length > 0 : dirty}
          saving={save.isPending}
          onSave={trySave}
          onDiscard={isNew ? () => router.push('/admin/automations') : () => setDraft(saved)}
          saveLabel={isNew ? t('admin.automations.create') : undefined}
        />
      )}

      <ConfirmDialog
        open={confirmSave}
        onOpenChange={setConfirmSave}
        title={t('admin.automations.save_live_title')}
        message={t('admin.automations.save_live_desc')}
        confirmLabel={t('admin.automations.save_live_confirm')}
        onConfirm={() => save.mutateAsync().catch(() => undefined)}
      />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t('admin.automations.delete_title', { name: rule?.name ?? '' })}
        message={t('admin.automations.delete_desc')}
        confirmLabel={t('admin.automations.delete_confirm')}
        onConfirm={() => remove.mutateAsync().catch(() => undefined)}
      />
      <ConfirmDialog
        open={confirmRun}
        onOpenChange={setConfirmRun}
        tone={rule?.dry_run ? 'info' : 'danger'}
        title={rule?.dry_run ? t('admin.automations.run_dry_title') : t('admin.automations.run_live_title')}
        message={
          <>
            {rule?.dry_run
              ? t('admin.automations.run_dry_desc')
              : t('admin.automations.run_live_desc', { max: rule?.max_actions_per_run ?? 25 })}
            {dirty && <span className="mt-2 block text-amber-700">{t('admin.automations.run_unsaved')}</span>}
          </>
        }
        confirmLabel={rule?.dry_run ? t('admin.automations.run_dry_confirm') : t('admin.automations.run_live_confirm')}
        onConfirm={() => run.mutateAsync(undefined).catch(() => undefined)}
      />
      <Modal
        isDialogOpen={eventRunOpen}
        onOpenChange={setEventRunOpen}
        size="sm"
        icon={<Play size={16} weight="fill" />}
        dialogTitle={t('admin.automations.run_for_org_title')}
        dialogDescription={
          rule?.dry_run ? t('admin.automations.run_for_org_dry', { events: eventNames }) : t('admin.automations.run_for_org_live', { events: eventNames })
        }
        preventClose={run.isPending}
        dialogContent={
          <div className="space-y-3">
            <OrgTargetPicker
              required
              value={eventTarget}
              onChange={setEventTarget}
              events={rule?.event_types ?? []}
              eventLabel={eventLabels.label}
            />
            {dirty && <p className="text-xs text-amber-700">{t('admin.automations.run_unsaved')}</p>}
          </div>
        }
        footer={
          <>
            <Button onClick={() => setEventRunOpen(false)} disabled={run.isPending}>
              {t('common.cancel')}
            </Button>
            <Button
              variant={rule?.dry_run ? 'primary' : 'danger'}
              disabled={!eventTarget.org}
              loading={run.isPending}
              onClick={() =>
                run
                  .mutateAsync({ org_id: eventTarget.org!.id, event_key: eventTarget.eventKey })
                  .then(() => setEventRunOpen(false))
                  .catch(() => undefined)
              }
            >
              {rule?.dry_run ? t('admin.automations.run_dry_confirm') : t('admin.automations.run_live_confirm')}
            </Button>
          </>
        }
      />
      <EnableConfirm
        rule={enabling}
        onClose={() => setEnabling(null)}
        onConfirm={async () => {
          await toggle.mutateAsync(true).catch(() => undefined)
        }}
      />
    </DashPage>
  )
}

/** 409 from the API: deletion rules must complete a dry run before running live. */
function NeedsPreviewNotice({ onOpen, compact }: { onOpen: () => void; compact?: boolean }) {
  const { t } = useTranslation()
  return (
    <div role="alert" className={`flex flex-wrap items-center gap-3 rounded-xl bg-amber-50 text-amber-800 ${compact ? 'mt-3 px-3 py-2 text-xs' : 'px-4 py-3 text-sm'}`}>
      <span className="flex-1 min-w-0">{t('admin.automations.needs_preview')}</span>
      <Button size="sm" icon={<Eye size={13} />} onClick={onOpen}>
        {t('admin.automations.open_preview')}
      </Button>
    </div>
  )
}
