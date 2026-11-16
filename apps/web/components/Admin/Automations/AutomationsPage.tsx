'use client'
import React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { ClockCounterClockwise, FlowArrow, Plus, ToggleRight, WarningCircle, Eye } from '@phosphor-icons/react'
import {
  Button,
  ConfirmDialog,
  DashPage,
  EmptyState,
  Panel,
  SectionCard,
  StatCard,
  formatRelative,
  recipes,
} from '@/design'
import {
  errorMessage,
  getAutomationSchema,
  getAutomationTemplates,
  getRecentRuns,
  isNotAvailable,
  listAutomations,
  updateAutomation,
} from '@services/ee/platform/api'
import { platformKeys } from '@services/ee/platform/keys'
import type { Automation, RunMini } from '@services/ee/platform/types'
import { shouldRetry, useAccessToken, useListKeyboard, usePlatformMe, useUrlQuery } from '@components/Admin/hooks'
import FilterBar, { filterKeys, resolveDate, type FilterDef, type FilterValues } from '@components/Admin/Shared/FilterBar'
import { AdminHeader, CopyLinkButton, ListSkeleton, NoAccess, QueryError, Switch, adminPath, formatDate } from '@components/Admin/Shared/AdminKit'
import { DryRunPill, RunStatusPill, actionsMissingChannel, useEventLabels, useRuleSummary, useScheduleLabel, useTriggerLabel } from './shared'
import TemplateGallery from './TemplateGallery'
import { AutomationIcon } from './automationVisuals'
import { hasRunFilters, matchRun, runKey, runParams, useRunFilterDefs } from './runFilters'

const LIST_KEYS = ['q', 'enabled', 'dry_run', 'schedule', 'status', 'template', 'created_since', 'created_until'] as const

/** The list filters in the URL as API params (date presets resolved). */
function listParams(v: FilterValues): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {}
  for (const k of LIST_KEYS) out[k] = v[k] || undefined
  out.created_since = resolveDate(v.created_since)
  out.created_until = resolveDate(v.created_until, true)
  return out
}

/** Client-side fallback for APIs that ignore the list filters. */
function matchRule(r: Automation, p: Record<string, string | undefined>): boolean {
  if (p.q) {
    const q = p.q.toLowerCase()
    if (!`${r.name ?? ''} ${r.description ?? ''}`.toLowerCase().includes(q)) return false
  }
  if (p.enabled && String(!!r.enabled) !== p.enabled) return false
  if (p.dry_run && String(!!r.dry_run) !== p.dry_run) return false
  if (p.schedule && r.schedule !== p.schedule) return false
  if (p.status && (r.last_run?.status ?? r.last_run_status) !== p.status) return false
  if (p.template && (r.template || 'custom') !== p.template) return false
  const at = r.created_at ? new Date(r.created_at).getTime() : NaN
  if (p.created_since && !(at >= new Date(p.created_since).getTime())) return false
  if (p.created_until && !(at <= new Date(p.created_until).getTime())) return false
  return true
}

export default function AutomationsPage() {
  const { t } = useTranslation()
  const token = useAccessToken()
  const me = usePlatformMe()
  const qc = useQueryClient()
  const canManage = me.can('automations.manage')
  const [galleryOpen, setGalleryOpen] = React.useState(false)
  const [confirming, setConfirming] = React.useState<Automation | null>(null)
  const [urlValues, setUrl] = useUrlQuery()

  // Unfiltered, the list shares the editor's cache entry; filtered, it gets its own.
  const filterState = LIST_KEYS.map((k) => urlValues[k] ?? '')
  const filtered = filterState.some(Boolean)
  const listKey = filtered ? ([...platformKeys.automations(), 'list', ...filterState] as const) : platformKeys.automations()
  const rules = useQuery({
    queryKey: listKey,
    queryFn: () => listAutomations(token, filtered ? listParams(urlValues) : undefined),
    enabled: !!token,
    retry: shouldRetry,
    placeholderData: (prev) => prev,
  })
  const runsKey = runKey(urlValues, 'rr_')
  const runs = useQuery({
    queryKey: [...platformKeys.recentRuns(), ...runsKey],
    queryFn: () => {
      const p = runParams(urlValues, 'rr_')
      return getRecentRuns(token, hasRunFilters(p) ? { ...p } : undefined)
    },
    enabled: !!token,
    retry: shouldRetry,
    placeholderData: (prev) => prev,
  })
  const schema = useQuery({
    queryKey: platformKeys.automationSchema(),
    queryFn: () => getAutomationSchema(token),
    enabled: !!token,
    retry: shouldRetry,
    staleTime: 10 * 60_000,
  })
  const templates = useQuery({
    queryKey: platformKeys.automationTemplates(),
    queryFn: () => getAutomationTemplates(token),
    enabled: !!token,
    retry: shouldRetry,
    staleTime: 10 * 60_000,
  })
  const runDefs = useRunFilterDefs('rr_')
  const scheduleLabel = useScheduleLabel()
  const schedules = schema.data?.schedules?.length ? schema.data.schedules : ['hourly', 'daily', 'weekly']
  const templateList = Array.isArray(templates.data) ? templates.data : []
  const listDefs: FilterDef[] = [
    { key: 'enabled', kind: 'boolean', label: t('admin.automations.col_enabled'), trueLabel: t('admin.automations.on'), falseLabel: t('admin.automations.off') },
    { key: 'dry_run', kind: 'boolean', label: t('admin.automations.dry_run') },
    { key: 'schedule', kind: 'select', label: t('admin.automations.col_schedule'), options: schedules.map((s) => ({ value: s, label: scheduleLabel(s) })) },
    {
      key: 'status',
      kind: 'select',
      label: t('admin.automations.filter_last_status'),
      options: ['ok', 'partial', 'failed', 'skipped'].map((s) => ({ value: s, label: t(`admin.automations.run_status.${s}`) })),
    },
    {
      key: 'template',
      kind: 'select',
      label: t('admin.automations.filter_template'),
      options: [
        ...templateList.map((tpl) => ({ value: tpl.key, label: tpl.name })),
        { value: 'custom', label: t('admin.automations.template_custom') },
      ],
    },
    { key: 'created', kind: 'date', label: t('admin.automations.filter_created'), sinceKey: 'created_since', untilKey: 'created_until' },
  ]

  const toggle = useMutation({
    mutationFn: ({ rule, enabled }: { rule: Automation; enabled: boolean }) => updateAutomation(token, rule.automation_uuid, { enabled }),
    onMutate: async ({ rule, enabled }) => {
      await qc.cancelQueries({ queryKey: listKey })
      const prev = qc.getQueryData<Automation[]>(listKey)
      qc.setQueryData<Automation[]>(listKey, (old) =>
        Array.isArray(old) ? old.map((r) => (r.automation_uuid === rule.automation_uuid ? { ...r, enabled } : r)) : old
      )
      return { prev }
    },
    onError: (err, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(listKey, ctx.prev)
      toast.error(errorMessage(err, t('admin.automations.save_failed')))
    },
    onSuccess: (_d, { enabled }) => toast.success(enabled ? t('admin.automations.enabled_toast') : t('admin.automations.disabled_toast')),
    onSettled: () => qc.invalidateQueries({ queryKey: platformKeys.automations() }),
  })

  const router = useRouter()
  const lp = listParams(urlValues)
  const list = (Array.isArray(rules.data) ? rules.data : []).filter((r) => matchRule(r, lp))
  // j/k moves through the rules, Enter opens one.
  const kb = useListKeyboard(list, (r) => router.push(adminPath.automation(r.automation_uuid)))

  if (!me.isLoading && !me.canAny('automations.run', 'automations.manage', 'platform.read')) {
    return (
      <DashPage>
        <AdminHeader title={t('admin.automations.title')} />
        <NoAccess />
      </DashPage>
    )
  }

  const rp = runParams(urlValues, 'rr_')
  const recent = (Array.isArray(runs.data) ? runs.data : []).filter((r) => matchRun(r, rp))
  const failures = recent.filter((r) => r.status === 'failed' || r.status === 'partial')
  // On a server without automations, one "not available" panel is enough.
  const unavailable = isNotAvailable(rules.error)
  const stat = (n: number, q: { isLoading: boolean; error: unknown }) => (q.isLoading ? null : q.error ? '–' : n)

  return (
    <DashPage bottom="lg">
      <AdminHeader
        title={t('admin.automations.title')}
        subtitle={t('admin.automations.subtitle')}
        actions={
          canManage && !unavailable ? (
            <Button variant="primary" icon={<Plus size={14} weight="bold" />} onClick={() => setGalleryOpen(true)}>
              {t('admin.automations.new')}
            </Button>
          ) : undefined
        }
      />

      <div className={recipes.statGrid}>
        <StatCard
          icon={<FlowArrow size={18} />}
          iconClass="bg-neutral-100 text-neutral-600"
          label={t('admin.automations.stat_rules')}
          value={stat(list.length, rules)}
        />
        <StatCard
          icon={<ToggleRight size={18} />}
          iconClass="bg-emerald-50 text-emerald-600"
          label={t('admin.automations.stat_enabled')}
          value={stat(list.filter((r) => r.enabled).length, rules)}
        />
        <StatCard
          icon={<Eye size={18} />}
          iconClass="bg-sky-50 text-sky-600"
          label={t('admin.automations.stat_dry_run')}
          value={stat(list.filter((r) => r.dry_run).length, rules)}
        />
        <StatCard
          icon={<WarningCircle size={18} />}
          iconClass="bg-rose-50 text-rose-600"
          label={t('admin.automations.stat_failures')}
          value={stat(failures.length, runs)}
        />
      </div>

      {!unavailable && (
        <FilterBar
          values={urlValues}
          onChange={setUrl}
          defs={listDefs}
          search={{ key: 'q', placeholder: t('admin.automations.search_placeholder') }}
          savedViewsKey="lh:admin:views:automations"
          end={filtered ? <CopyLinkButton /> : undefined}
        />
      )}

      {rules.error ? (
        <QueryError error={rules.error} onRetry={() => rules.refetch()} />
      ) : rules.isLoading ? (
        <ListSkeleton rows={4} />
      ) : list.length === 0 && filtered ? (
        <Panel>
          <EmptyState
            icon={<FlowArrow size={22} />}
            title={t('admin.automations.empty_filtered_title')}
            description={t('admin.automations.empty_filtered_desc')}
            action={
              <Button size="sm" onClick={() => setUrl(Object.fromEntries([...filterKeys(listDefs), 'q'].map((k) => [k, undefined])))}>
                {t('admin.automations.clear_filters')}
              </Button>
            }
          />
        </Panel>
      ) : list.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<FlowArrow size={22} />}
            title={t('admin.automations.empty_title')}
            description={t('admin.automations.empty_desc')}
            action={
              canManage ? (
                <Button variant="primary" icon={<Plus size={14} weight="bold" />} onClick={() => setGalleryOpen(true)}>
                  {t('admin.automations.start_from_template')}
                </Button>
              ) : undefined
            }
          />
        </Panel>
      ) : (
        <Panel divided>
          <div className={`${recipes.tableHead} hidden md:grid grid-cols-[minmax(0,1fr)_11rem_10rem_4rem] gap-4`}>
            <span>{t('admin.automations.col_rule')}</span>
            <span>{t('admin.automations.col_schedule')}</span>
            <span>{t('admin.automations.col_last_run')}</span>
            <span className="text-end">{t('admin.automations.col_enabled')}</span>
          </div>
          {list.map((rule, i) => (
            <RuleRow
              key={rule.automation_uuid}
              rowProps={kb.rowProps(i)}
              rule={rule}
              canManage={canManage}
              onToggle={(enabled) => {
                if (!enabled) return toggle.mutate({ rule, enabled: false })
                // "Post to a channel" has no default channel: never switch on a rule that would always fail.
                if (actionsMissingChannel(rule.actions).length) return toast.error(t('admin.automations.channel_missing_enable'))
                setConfirming(rule)
              }}
            />
          ))}
        </Panel>
      )}

      {!unavailable && (
        <RecentRuns
          rules={[...(qc.getQueryData<Automation[]>(platformKeys.automations()) ?? []), ...list]}
          runs={recent}
          loading={runs.isLoading}
          error={runs.error}
          onRetry={() => runs.refetch()}
          filters={<FilterBar values={urlValues} onChange={setUrl} defs={runDefs} pageKey="rr_page" />}
          filtered={hasRunFilters(rp)}
        />
      )}

      <TemplateGallery open={galleryOpen} onOpenChange={setGalleryOpen} />
      <EnableConfirm
        rule={confirming}
        onClose={() => setConfirming(null)}
        onConfirm={async (rule) => {
          await toggle.mutateAsync({ rule, enabled: true }).catch(() => undefined)
        }}
      />
    </DashPage>
  )
}

function RuleRow({
  rule,
  canManage,
  onToggle,
  rowProps,
}: {
  rule: Automation
  canManage: boolean
  onToggle: (_enabled: boolean) => void
  rowProps?: Record<string, unknown>
}) {
  const { t, i18n } = useTranslation()
  const triggerLabel = useTriggerLabel()
  const lastAt = rule.last_run?.started_at ?? rule.last_run_at
  const lastStatus = rule.last_run?.status ?? rule.last_run_status
  return (
    <div
      {...rowProps}
      className="grid grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,1fr)_11rem_10rem_4rem] items-center gap-4 px-5 py-3.5 hover:bg-neutral-50 data-[active=true]:bg-neutral-50"
    >
      <div className="flex items-start gap-3 min-w-0">
        <AutomationIcon automation={rule} className="mt-0.5" />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <Link href={`/admin/automations/${rule.automation_uuid}`} className="text-sm font-semibold text-neutral-900 hover:underline underline-offset-2 truncate">
              {rule.name}
            </Link>
            {rule.dry_run && <DryRunPill />}
          </div>
          {rule.description && <p className="mt-0.5 text-xs text-neutral-500 truncate">{rule.description}</p>}
          <p className="mt-1 text-xs text-neutral-400 md:hidden">
            {triggerLabel(rule)} · {lastAt ? formatRelative(lastAt, i18n.language) : t('admin.automations.never_ran')}
          </p>
        </div>
      </div>
      <span className="hidden md:block text-sm text-neutral-600 truncate" title={triggerLabel(rule)}>
        {triggerLabel(rule)}
      </span>
      <span className="hidden md:flex items-center gap-2 min-w-0">
        {lastAt ? (
          <>
            <RunStatusPill status={lastStatus} />
            <time className="text-xs text-neutral-400 truncate" title={formatDate(lastAt, i18n.language, true)}>
              {formatRelative(lastAt, i18n.language)}
            </time>
          </>
        ) : (
          <span className="text-xs text-neutral-400">{t('admin.automations.never_ran')}</span>
        )}
      </span>
      <span className="flex justify-end">
        <Switch checked={rule.enabled} onChange={onToggle} disabled={!canManage} label={t('admin.automations.col_enabled')} />
      </span>
    </div>
  )
}

export function EnableConfirm({
  rule,
  onClose,
  onConfirm,
}: {
  rule: Automation | null
  onClose: () => void
  onConfirm: (_rule: Automation) => Promise<void>
}) {
  const { t } = useTranslation()
  const scheduleLabel = useScheduleLabel()
  const events = useEventLabels(rule?.trigger === 'event')
  const summary = useRuleSummary()
  const actions = (Array.isArray(rule?.actions) ? rule!.actions : []).map(summary.action).join(', ')
  // "daily" or "whenever Organization created happens"
  const when =
    rule?.trigger === 'event'
      ? t('admin.automations.when_events', { events: (Array.isArray(rule.event_types) ? rule.event_types : []).map(events.label).join(', ') || '–' })
      : scheduleLabel(rule?.schedule).toLowerCase()
  return (
    <ConfirmDialog
      open={!!rule}
      onOpenChange={(o) => !o && onClose()}
      tone={rule?.dry_run ? 'info' : 'danger'}
      title={t('admin.automations.enable_title', { name: rule?.name ?? '' })}
      message={
        rule?.dry_run
          ? t('admin.automations.enable_dry_desc', { schedule: when })
          : t('admin.automations.enable_live_desc', {
              schedule: when,
              actions: actions || '–',
              max: rule?.max_actions_per_run ?? 25,
            })
      }
      confirmLabel={t('admin.automations.enable_confirm')}
      onConfirm={() => (rule ? onConfirm(rule) : undefined)}
    />
  )
}

function RecentRuns({
  rules,
  runs,
  loading,
  error,
  onRetry,
  filters,
  filtered,
}: {
  rules: Automation[]
  runs: RunMini[]
  loading: boolean
  error: unknown
  onRetry: () => void
  filters?: React.ReactNode
  filtered?: boolean
}) {
  const { t, i18n } = useTranslation()
  // Failures first so they are seen; the rest keep their time order.
  const sorted = [...runs].sort((a, b) => Number(b.status === 'failed') - Number(a.status === 'failed'))
  const byUuid = new Map((Array.isArray(rules) ? rules : []).map((r) => [r.automation_uuid, r]))
  return (
    <SectionCard
      icon={<ClockCounterClockwise size={18} />}
      title={t('admin.automations.recent_title')}
      description={t('admin.automations.recent_desc')}
      bodyClassName="pt-3 pb-2"
      actions={filters && !error ? <div className="max-w-full">{filters}</div> : undefined}
    >
      {error ? (
        <div className="px-5 pb-3">
          <QueryError error={error} onRetry={onRetry} compact />
        </div>
      ) : loading ? (
        <div className="px-5 pb-3 space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className={`${recipes.skeleton} h-10`} />
          ))}
        </div>
      ) : sorted.length === 0 ? (
        <p className="px-5 pb-4 text-sm text-neutral-500">{filtered ? t('admin.automations.recent_empty_filtered') : t('admin.automations.recent_empty')}</p>
      ) : (
        <div className="divide-y divide-neutral-100">
          {sorted.slice(0, 12).map((run) => {
            const failed = run.status === 'failed'
            const href = run.automation_uuid ? adminPath.automation(run.automation_uuid, run.id) : undefined
            return (
              <div key={run.id} className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5 ${failed ? 'bg-rose-50/60' : ''}`}>
                <AutomationIcon automation={run.automation_uuid ? byUuid.get(run.automation_uuid) : null} size="sm" />
                <RunStatusPill status={run.status} />
                <span className="min-w-[10rem] flex-1 truncate text-sm text-neutral-900">
                  {href ? (
                    <Link href={href} className="hover:underline underline-offset-2">
                      {run.automation_name || t('admin.automations.untitled')}
                    </Link>
                  ) : (
                    run.automation_name || t('admin.automations.untitled')
                  )}
                  {run.dry_run && <span className="ms-2 text-xs text-sky-700">{t('admin.automations.dry_run')}</span>}
                </span>
                <span className="text-xs text-neutral-500 tabular-nums">
                  {t('admin.automations.matched_acted', { matched: run.matched ?? 0, acted: run.acted ?? 0 })}
                </span>
                <span className="text-xs text-neutral-400">{t(`admin.automations.trigger.${run.trigger}`, { defaultValue: run.trigger })}</span>
                <time className="text-xs text-neutral-400" title={formatDate(run.started_at, i18n.language, true)}>
                  {formatRelative(run.started_at, i18n.language)}
                </time>
                {failed && run.error && <p className="basis-full text-xs text-rose-700 break-words">{run.error}</p>}
              </div>
            )
          })}
        </div>
      )}
    </SectionCard>
  )
}
