'use client'
import React from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import {
  ArrowClockwise,
  ArrowSquareOut,
  Buildings,
  CalendarBlank,
  CheckCircle,
  CreditCard,
  ClockCounterClockwise,
  Code,
  DownloadSimple,
  FlowArrow,
  Gear,
  Globe,
  Key,
  Lightning,
  Pulse,
  Robot,
  Shapes,
  Tag,
  Target,
  User,
  WarningCircle,
  X,
  XCircle,
} from '@phosphor-icons/react'
import { Button, Chip, EmptyState, Panel, SegmentedControl, StatusPill, formatRelative } from '@/design'
import {
  errorMessage,
  exportAudit,
  exportUnifiedAudit,
  facetList,
  getAudit,
  getOrgActivity,
  getUnifiedAudit,
  getUnifiedEvent,
  getUnifiedFacets,
  isNotAvailable,
  listOrgs,
  type UnifiedAuditFilters,
} from '@services/ee/platform/api'
import { auditKeys, platformKeys } from '@services/ee/platform/keys'
import { LIFECYCLES, type AuditEvent, type UnifiedEvent } from '@services/ee/platform/types'
import { shouldRetry, useAccessToken, useListKeyboard, usePlatformMe, useUrlQuery } from '@components/Admin/hooks'
import { CopyLinkButton, KeyValue, ListSkeleton, Pagination, QueryError, adminPath, asList, formatDate } from '@components/Admin/Shared/AdminKit'
import FilterBar, { resolveDate, type FilterDef } from '@components/Admin/Shared/FilterBar'

// One audit log for the whole platform: every organization's audit events
// (logins, content edits, settings…) merged with the platform team's own
// events, newest first. The Activity page shows all of it; the org detail
// Activity tab shows the same view locked to one org.

const PAGE_SIZE = 50
const POLL_MS = 20_000

type Source = 'all' | 'org' | 'platform'

const FILTER_KEYS = ['source', 'org_id', 'actor_user_id', 'action', 'category', 'outcome', 'via', 'target_type', 'ip', 'q', 'since', 'until', 'org_plan', 'org_lifecycle', 'org_tag', 'page'] as const

/** A legacy platform-only event shaped like a unified one (older servers). */
function fromPlatform(e: AuditEvent): UnifiedEvent {
  return {
    id: `platform:${e.id}`,
    source: 'platform',
    created_at: e.created_at,
    org_id: e.org_id,
    org_name: e.org_name,
    actor_user_id: e.actor_user_id,
    actor_label: e.actor_label,
    actor_kind: e.actor_kind,
    via: e.actor_kind,
    action: e.action,
    target_type: e.target_type,
    target_id: e.target_id,
    summary: e.summary,
    ip: e.ip,
    details: e.details,
  }
}

// Org rows come with a generated summary ("auth.login.succeeded Leo Grant");
// say it like a sentence instead: "Login succeeded · Leo Grant".
const VERBS = new Set(['created', 'updated', 'deleted', 'published', 'unpublished', 'succeeded', 'failed', 'started', 'ended', 'joined', 'left', 'removed', 'added', 'enabled', 'disabled', 'executed', 'reordered', 'graded', 'submitted', 'invited', 'revoked', 'changed', 'viewed', 'completed'])

export function eventTitle(
  e: { title?: string | null; summary?: string | null; action: string; target_name?: string | null; target_id?: string | null },
  t: (k: string, o?: Record<string, unknown>) => string
): string {
  // The API's human title wins; the phrase builder below is the fallback.
  if (e.title) return e.target_name && !e.title.includes(e.target_name) ? `${e.title} · ${e.target_name}` : e.title
  const generated = !e.summary || e.summary === e.action || e.summary.startsWith(`${e.action} `)
  if (!generated) return e.summary as string
  const known = t(`admin.audit.actions.${e.action.replace(/\./g, '_')}`, { defaultValue: '' })
  let phrase = known
  if (!phrase) {
    const parts = e.action.replace(/^[A-Z][\w ]*:\s*/, '').split('.').filter(Boolean)
    const last = parts[parts.length - 1] ?? e.action
    const obj = VERBS.has(last) ? parts.slice(Math.max(0, parts.length - 2), -1).join(' ') : parts.slice(-2).join(' ')
    const words = (VERBS.has(last) ? `${obj} ${last}` : obj || e.action).replace(/_/g, ' ').trim()
    phrase = words.charAt(0).toUpperCase() + words.slice(1)
  }
  const target = e.target_name || ''
  return target ? `${phrase} · ${target}` : phrase
}

function splitId(id: string): [string, string] {
  const i = id.indexOf(':')
  return i < 0 ? ['platform', id] : [id.slice(0, i), id.slice(i + 1)]
}

const VIA_ICON: Record<string, React.ReactNode> = {
  session: <User size={14} weight="duotone" />,
  web: <Globe size={14} weight="duotone" />,
  ui: <Globe size={14} weight="duotone" />,
  api: <Code size={14} weight="duotone" />,
  token: <Key size={14} weight="duotone" />,
  api_token: <Key size={14} weight="duotone" />,
  mcp: <Robot size={14} weight="duotone" />,
  automation: <FlowArrow size={14} weight="duotone" />,
  system: <Gear size={14} weight="duotone" />,
}

function outcomeStatus(o?: string | null) {
  if (!o) return null
  const v = o.toLowerCase()
  if (['success', 'ok', 'succeeded', 'allowed'].includes(v)) return 'success' as const
  if (['failure', 'failed', 'error', 'denied', 'forbidden'].includes(v)) return 'danger' as const
  return 'neutral' as const
}

export default function UnifiedAuditView({ orgId, embedded = false }: { orgId?: number | string; embedded?: boolean }) {
  const { t, i18n } = useTranslation()
  const token = useAccessToken()
  const me = usePlatformMe()
  const queryClient = useQueryClient()
  const [urlValues, setUrl] = useUrlQuery()
  // Inside org detail the URL also carries `section` and other tabs' params.
  const prefix = embedded ? 'a_' : ''
  const values = React.useMemo(() => {
    const out: Record<string, string | undefined> = {}
    for (const k of FILTER_KEYS) out[k] = urlValues[prefix + k]
    return out
  }, [urlValues, prefix])
  const setValues = React.useCallback(
    (u: Record<string, string | undefined>) => setUrl(Object.fromEntries(Object.entries(u).map(([k, v]) => [prefix + k, v]))),
    [setUrl, prefix]
  )

  const source = (values.source as Source) || 'all'
  const page = Number(values.page) || 1
  // The open event lives in the URL (?event=org:123) so a shared link opens it.
  const openId = urlValues[prefix + 'event'] ?? null
  const setOpenId = (id: string | null) => setUrl({ [prefix + 'event']: id ?? undefined })
  const [exporting, setExporting] = React.useState(false)

  const filters: UnifiedAuditFilters = {
    source,
    org_id: orgId ?? values.org_id,
    actor_user_id: values.actor_user_id,
    action: values.action,
    category: values.category,
    outcome: values.outcome,
    via: values.via,
    target_type: values.target_type,
    ip: values.ip,
    org_plan: values.org_plan,
    org_lifecycle: values.org_lifecycle,
    org_tag: values.org_tag,
    q: values.q,
    since: resolveDate(values.since),
    until: resolveDate(values.until, true),
    page,
    limit: PAGE_SIZE,
    sort: 'desc',
  }
  // Relative presets (`7d`) resolve to a moving timestamp; key the cache on
  // the URL values instead so it doesn't refetch on every render.
  const cacheKey = { ...values, orgId, page }

  const list = useQuery({
    queryKey: auditKeys.unified(cacheKey),
    queryFn: () => getUnifiedAudit(token, filters),
    enabled: !!token && me.can('audit.read'),
    retry: shouldRetry,
    placeholderData: (prev) => prev,
  })
  const legacy = !!list.error && isNotAvailable(list.error)

  // Older servers: platform-only log (or the org activity endpoint).
  const fallback = useQuery({
    queryKey: [...platformKeys.audit({ ...cacheKey }), 'fallback'],
    queryFn: async () => {
      if (orgId) {
        const items = asList(await getOrgActivity(token, orgId))
        return { items, total: items.length }
      }
      return getAudit(token, {
        page,
        limit: PAGE_SIZE,
        action: values.action || values.q,
        actor_user_id: values.actor_user_id,
        org_id: values.org_id,
        target_type: values.target_type,
        since: filters.since,
      })
    },
    enabled: !!token && legacy,
    retry: shouldRetry,
  })

  const facets = useQuery({
    queryKey: auditKeys.facets({ ...values, orgId, page: undefined }),
    queryFn: () => getUnifiedFacets(token, filters),
    enabled: !!token && me.can('audit.read') && !legacy,
    retry: shouldRetry,
    placeholderData: (prev) => prev,
  })

  // Live refresh: look for events newer than what's on screen.
  const head = useQuery({
    queryKey: auditKeys.head({ ...values, orgId }),
    queryFn: () => getUnifiedAudit(token, { ...filters, page: 1, limit: 1 }),
    enabled: !!token && !legacy && !!list.data && page === 1,
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
    retry: false,
  })
  const shownTotal = list.data?.total ?? 0
  const newCount = head.data && list.data && page === 1 ? Math.max(0, (head.data.total ?? 0) - shownTotal) : 0
  const refreshNow = () => {
    queryClient.invalidateQueries({ queryKey: auditKeys.unifiedAll() })
  }

  const events: UnifiedEvent[] = legacy
    ? asList(fallback.data as any).map((e: any) => fromPlatform(e as AuditEvent))
    : asList(list.data)
  const total = legacy ? (fallback.data as any)?.total ?? events.length : shownTotal
  const kb = useListKeyboard(events, (e) => setOpenId(e.id))

  const f = facets.data
  const opts = (raw: unknown, ns?: string) =>
    facetList(raw).map((o) => ({ value: o.value, label: o.label ?? (ns ? t(`${ns}.${o.value}`, { defaultValue: o.value }) : o.value), count: o.count }))
  const sourceCounts = Object.fromEntries(facetList(f?.sources).map((s) => [s.value, s.count]))

  const defs: FilterDef[] = [
    {
      kind: 'async',
      key: 'org_id',
      label: t('admin.audit.f.org'),
      icon: <Buildings size={14} />,
      hidden: !!orgId,
      options: (f?.orgs ?? []).map((o) => ({ value: String(o.id), label: o.name, count: o.count })),
      describe: (v) => (f?.orgs ?? []).find((o) => String(o.id) === v)?.name ?? `#${v}`,
      load: async (q) => (await listOrgs(token, { q, limit: 10, page: 1 })).items.map((o) => ({ value: String(o.id), label: o.name })),
      placeholder: t('admin.audit.f.org_search'),
    },
    {
      kind: 'select',
      key: 'actor_user_id',
      label: t('admin.audit.f.actor'),
      icon: <User size={14} />,
      options: (f?.actors ?? []).map((a) => ({ value: String(a.user_id), label: a.label, count: a.count })),
    },
    { kind: 'select', key: 'action', label: t('admin.audit.f.action'), icon: <Lightning size={14} />, options: opts(f?.actions) },
    { kind: 'select', key: 'category', label: t('admin.audit.f.category'), icon: <Shapes size={14} />, options: opts(f?.categories, 'admin.audit.category') },
    { kind: 'select', key: 'outcome', label: t('admin.audit.f.outcome'), icon: <CheckCircle size={14} />, options: opts(f?.outcomes, 'admin.audit.outcome') },
    { kind: 'select', key: 'via', label: t('admin.audit.f.via'), icon: <Globe size={14} />, options: opts(f?.vias, 'admin.audit.via') },
    { kind: 'text', key: 'target_type', label: t('admin.audit.f.target'), icon: <Target size={14} />, placeholder: t('admin.audit.f.target_placeholder') },
    { kind: 'date', key: 'when', sinceKey: 'since', untilKey: 'until', label: t('admin.audit.f.date'), icon: <CalendarBlank size={14} /> },
    { kind: 'text', key: 'ip', label: t('admin.audit.f.ip'), icon: <Globe size={14} />, placeholder: '203.0.113.7' },
    {
      kind: 'select',
      key: 'org_plan',
      label: t('admin.audit.f.org_plan'),
      icon: <CreditCard size={14} />,
      hidden: !!orgId,
      options: ['free', 'paid', 'standard', 'pro', 'enterprise'].map((p) => ({
        value: p,
        label: t(`admin.org_list.plan_${p}`),
        count: facetList((f as any)?.org_plans ?? (f as any)?.org_plan).find((x) => x.value === p)?.count,
      })),
    },
    {
      kind: 'select',
      key: 'org_lifecycle',
      label: t('admin.audit.f.org_lifecycle'),
      icon: <Pulse size={14} />,
      hidden: !!orgId,
      options: LIFECYCLES.map((l) => ({ value: l, label: t(`admin.lifecycle.${l}`) })),
    },
    { kind: 'text', key: 'org_tag', label: t('admin.audit.f.org_tag'), icon: <Tag size={14} />, hidden: !!orgId, placeholder: 'beta-tester' },
  ]

  const handleExport = async () => {
    setExporting(true)
    try {
      if (legacy) await exportAudit(token, { action: values.action, actor_user_id: values.actor_user_id, org_id: orgId ?? values.org_id, since: filters.since })
      else await exportUnifiedAudit(token, filters)
    } catch (err) {
      toast.error(errorMessage(err, t('admin.audit.export_failed')))
    } finally {
      setExporting(false)
    }
  }

  const loading = legacy ? fallback.isLoading : list.isLoading
  const error = legacy ? fallback.error : list.error && !legacy ? list.error : null
  const filtered = FILTER_KEYS.some((k) => k !== 'page' && k !== 'source' && values[k])

  return (
    <div className="flex flex-col gap-4 min-w-0">
      <FilterBar
        values={values}
        onChange={setValues}
        defs={legacy ? defs.filter((d) => ['org_id', 'action', 'target_type', 'when'].includes(d.key)) : defs}
        search={{ key: 'q', placeholder: t('admin.audit.search') }}
        savedViewsKey={orgId ? 'lh:admin:views:org-audit' : 'lh:admin:views:audit'}
        end={
          <>
            {me.can('export.data') && (
              <Button icon={<DownloadSimple size={14} />} onClick={handleExport} loading={exporting}>
                <span className="hidden sm:inline">{t('admin.audit.export')}</span>
              </Button>
            )}
            <CopyLinkButton label="" />
          </>
        }
      >
        {!legacy && (
          <SegmentedControl<Source>
            value={source}
            onChange={(v) => setValues({ source: v === 'all' ? undefined : v, page: undefined })}
            ariaLabel={t('admin.audit.source')}
            options={[
              { key: 'all', label: t('admin.audit.sources.all'), count: sourceCounts.all ?? (f ? Object.values(sourceCounts).reduce((a, b) => a + b, 0) : undefined) },
              { key: 'org', label: t('admin.audit.sources.org'), count: sourceCounts.org },
              { key: 'platform', label: t('admin.audit.sources.platform'), count: sourceCounts.platform },
            ]}
          />
        )}
      </FilterBar>

      {legacy && (
        <p className="flex items-start gap-2 rounded-xl bg-sky-50 px-3.5 py-2.5 text-xs text-sky-800 ring-1 ring-inset ring-sky-600/10">
          <WarningCircle size={14} className="mt-px shrink-0" />
          {t('admin.audit.legacy_note')}
        </p>
      )}

      {newCount > 0 && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={refreshNow}
            className="inline-flex items-center gap-1.5 h-8 px-3.5 rounded-full bg-neutral-900 text-white text-xs font-semibold shadow-lg animate-in fade-in slide-in-from-top-2"
          >
            <ArrowClockwise size={13} />
            {t('admin.audit.new_events', { count: newCount })}
          </button>
        </div>
      )}

      {error ? (
        <QueryError error={error} onRetry={() => (legacy ? fallback.refetch() : list.refetch())} />
      ) : loading ? (
        <ListSkeleton rows={8} />
      ) : events.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<ClockCounterClockwise size={22} />}
            title={filtered ? t('admin.audit.empty_filtered') : t('admin.audit.empty')}
            description={filtered ? t('admin.audit.empty_filtered_desc') : t('admin.audit.empty_desc')}
            action={
              filtered ? (
                <Button size="sm" onClick={() => setValues(Object.fromEntries(FILTER_KEYS.map((k) => [k, undefined])))}>
                  {t('admin.filters.clear_all')}
                </Button>
              ) : undefined
            }
          />
        </Panel>
      ) : (
        <>
          <Panel divided className={(legacy ? fallback.isFetching : list.isFetching) ? 'opacity-70 transition-opacity' : 'transition-opacity'}>
            {events.map((e, i) => (
              <EventRow key={e.id} event={e} showOrg={!orgId} showSource={!legacy} onOpen={() => setOpenId(e.id)} lang={i18n.language} rowProps={kb.rowProps(i)} />
            ))}
          </Panel>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-neutral-400">{t('admin.audit.count', { count: total })}</span>
            <div className="flex-1 min-w-0">
              <Pagination page={page} total={total} limit={PAGE_SIZE} onPage={(p) => setValues({ page: p === 1 ? undefined : String(p) })} />
            </div>
          </div>
        </>
      )}

      <EventDrawer id={openId} rows={events} legacy={legacy} onClose={() => setOpenId(null)} />
    </div>
  )
}

function EventRow({
  event,
  showOrg,
  showSource,
  onOpen,
  lang,
  rowProps,
}: {
  event: UnifiedEvent
  showOrg: boolean
  showSource: boolean
  onOpen: () => void
  lang: string
  rowProps?: Record<string, unknown>
}) {
  const { t } = useTranslation()
  const via = event.via || event.actor_kind || ''
  const status = outcomeStatus(event.outcome)
  return (
    <button type="button" onClick={onOpen} {...rowProps} className="w-full text-start flex items-start gap-3 px-5 py-3 hover:bg-neutral-50/70 data-[active=true]:bg-neutral-50 focus:outline-none focus-visible:bg-neutral-50">
      <span
        className={`mt-0.5 h-7 w-7 shrink-0 rounded-lg flex items-center justify-center ${event.source === 'platform' ? 'bg-amber-50 text-amber-700' : 'bg-neutral-100 text-neutral-500'}`}
        title={t(`admin.audit.sources.${event.source}`, { defaultValue: event.source })}
      >
        {VIA_ICON[via] ?? (event.source === 'platform' ? <Gear size={14} weight="duotone" /> : <User size={14} weight="duotone" />)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 min-w-0">
          <span className="text-sm text-neutral-900 truncate">{eventTitle(event, t)}</span>
          {status === 'danger' && (
            <StatusPill status="danger" className="!py-0.5 shrink-0">
              {t(`admin.audit.outcome.${event.outcome}`, { defaultValue: event.outcome ?? '' })}
            </StatusPill>
          )}
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-neutral-400">
          <span className="font-medium text-neutral-500">{event.actor_label || event.actor_email || t('admin.audit.unknown_actor')}</span>
          <span aria-hidden="true">·</span>
          <code className="font-mono text-[11px] text-neutral-500" dir="ltr">
            {event.action}
          </code>
          {event.category && (
            <span className="hidden sm:inline">
              · {t(`admin.audit.category.${event.category}`, { defaultValue: event.category })}
            </span>
          )}
          {showOrg && event.org_id ? <span className="truncate max-w-[12rem]">· {event.org_name || `#${event.org_id}`}</span> : null}
          <span aria-hidden="true">·</span>
          <time dateTime={event.created_at} title={formatDate(event.created_at, lang, true)}>
            {formatRelative(event.created_at, lang) ?? '–'}
          </time>
        </span>
      </span>
      {showSource && (
        // Wrapped: Chip's own inline-flex would beat `hidden` on phones.
        <span className="hidden md:block shrink-0">
          <Chip tone={event.source === 'platform' ? 'amber' : 'neutral'} className="!py-0.5">
            {t(`admin.audit.sources.${event.source}`, { defaultValue: event.source })}
          </Chip>
        </span>
      )}
    </button>
  )
}

// ─── detail drawer ───────────────────────────────────────────────────────────

/** Changes come as {field: {from, to}}, {field: {before, after}}, {field: [old, new]} or {before: {}, after: {}}. */
function changeRows(changes: unknown): { field: string; before: unknown; after: unknown }[] {
  if (!changes || typeof changes !== 'object') return []
  if (Array.isArray(changes)) {
    return changes
      .filter((c) => c && typeof c === 'object')
      .map((c: any) => ({ field: String(c.field ?? c.key ?? c.name ?? '?'), before: c.before ?? c.old ?? c.from, after: c.after ?? c.new ?? c.to }))
  }
  const c = changes as Record<string, any>
  if (c.before && c.after && typeof c.before === 'object' && typeof c.after === 'object') {
    const keys = Array.from(new Set([...Object.keys(c.before), ...Object.keys(c.after)]))
    return keys.map((k) => ({ field: k, before: c.before[k], after: c.after[k] }))
  }
  return Object.entries(c).map(([field, v]) => {
    if (Array.isArray(v) && v.length === 2) return { field, before: v[0], after: v[1] }
    if (v && typeof v === 'object' && ('before' in v || 'after' in v || 'old' in v || 'new' in v || 'from' in v || 'to' in v))
      return { field, before: v.before ?? v.old ?? v.from, after: v.after ?? v.new ?? v.to }
    return { field, before: undefined, after: v }
  })
}

function show(v: unknown): string {
  if (v === undefined) return '–'
  if (v === null) return 'null'
  if (typeof v === 'string') return v
  return JSON.stringify(v)
}

function EventDrawer({ id, rows, legacy, onClose }: { id: string | null; rows: UnifiedEvent[]; legacy: boolean; onClose: () => void }) {
  const { t, i18n } = useTranslation()
  const token = useAccessToken()
  const row = rows.find((r) => r.id === id) ?? null
  const [src, rawId] = id ? splitId(id) : ['', '']
  // Permalinks are `org:<n>` or `platform:<n>`; anything else can't exist.
  const validId = (src === 'org' || src === 'platform') && /^\d+$/.test(rawId)
  const full = useQuery({
    queryKey: auditKeys.event(src, rawId),
    queryFn: () => getUnifiedEvent(token, src, rawId),
    enabled: !!token && !!id && !legacy && validId,
    retry: false,
  })
  // The detail endpoint nests request info under `request` for org rows.
  const req = (full.data as { request?: Partial<UnifiedEvent> } | undefined)?.request
  const e: UnifiedEvent | null = full.data ? ({ ...row, ...full.data, ...(req ?? {}) } as UnifiedEvent) : row
  const missing = !!id && !row && (!validId || (!!full.error && !full.isFetching))
  const diff = changeRows(e?.changes)
  const hasDetails = !!e?.details && Object.keys(e.details).length > 0

  return (
    <DialogPrimitive.Root open={!!id} onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 bg-[var(--adm-overlay)] data-[state=open]:animate-in data-[state=open]:fade-in-0" style={{ zIndex: 'var(--z-modal-backdrop)' as any }} />
        <DialogPrimitive.Content
          className="fixed inset-y-0 end-0 w-full sm:w-[480px] bg-[var(--adm-canvas)] shadow-2xl flex flex-col data-[state=open]:animate-in data-[state=open]:slide-in-from-right rtl:data-[state=open]:slide-in-from-left focus:outline-none"
          style={{ zIndex: 'var(--z-modal)' as any }}
          aria-describedby={undefined}
        >
          <div className="flex items-start gap-3 px-5 py-4 bg-white nice-shadow">
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="text-base font-semibold text-neutral-900 break-words">
                {e ? eventTitle(e, t) : missing ? t('admin.audit.event_missing') : t('admin.audit.event')}
              </DialogPrimitive.Title>
              {e && (
                <p className="mt-0.5 text-xs text-neutral-500">
                  {formatDate(e.created_at, i18n.language, true)} · {t(`admin.audit.sources.${e.source}`, { defaultValue: e.source })}
                </p>
              )}
            </div>
            {id && <CopyLinkButton href={adminPath.event(id)} label="" size="sm" />}
            <DialogPrimitive.Close className="h-8 w-8 shrink-0 inline-flex items-center justify-center rounded-lg text-neutral-400 hover:text-neutral-900 hover:bg-neutral-100" aria-label={t('common.close')}>
              <X size={16} />
            </DialogPrimitive.Close>
          </div>
          {missing && (
            <div className="flex-1 p-4">
              <EmptyState icon={<WarningCircle size={22} />} title={t('admin.audit.event_missing')} description={t('admin.audit.event_missing_desc')} />
            </div>
          )}
          {e && (
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <Panel padded>
                <div className="divide-y divide-neutral-100">
                  <KeyValue label={t('admin.audit.d.action')} mono>
                    {e.action}
                  </KeyValue>
                  {e.category && <KeyValue label={t('admin.audit.f.category')}>{t(`admin.audit.category.${e.category}`, { defaultValue: e.category })}</KeyValue>}
                  {e.outcome && (
                    <KeyValue label={t('admin.audit.f.outcome')}>
                      <StatusPill status={outcomeStatus(e.outcome) ?? 'neutral'} icon={outcomeStatus(e.outcome) === 'danger' ? <XCircle size={12} weight="fill" /> : <CheckCircle size={12} weight="fill" />}>
                        {t(`admin.audit.outcome.${e.outcome}`, { defaultValue: e.outcome })}
                      </StatusPill>
                    </KeyValue>
                  )}
                  <KeyValue label={t('admin.audit.f.actor')}>
                    {e.actor_user_id ? (
                      <Link href={adminPath.user(e.actor_user_id)} className="block font-medium hover:underline underline-offset-2">
                        {e.actor_label || t('admin.audit.unknown_actor')}
                      </Link>
                    ) : (
                      <span className="block">{e.actor_label || t('admin.audit.unknown_actor')}</span>
                    )}
                    {e.actor_email && <span className="block text-xs text-neutral-500">{e.actor_email}</span>}
                    {e.actor_role && <span className="block text-xs text-neutral-500">{e.actor_role}</span>}
                    {(e.actor_user_id || e.actor_email) && (
                      <Link
                        href={e.actor_user_id ? adminPath.user(e.actor_user_id) : `/admin/users?q=${encodeURIComponent(e.actor_email ?? '')}`}
                        className="mt-0.5 inline-flex items-center gap-1 text-xs font-semibold text-neutral-600 hover:text-neutral-900"
                      >
                        {t('admin.audit.d.view_user')}
                        <ArrowSquareOut size={11} />
                      </Link>
                    )}
                  </KeyValue>
                  {(e.via || e.actor_kind) && <KeyValue label={t('admin.audit.f.via')}>{t(`admin.audit.via.${e.via || e.actor_kind}`, { defaultValue: e.via || e.actor_kind || '' })}</KeyValue>}
                  {e.org_id ? (
                    <KeyValue label={t('admin.audit.f.org')}>
                      <Link href={`/admin/organizations/${e.org_id}`} className="font-medium hover:underline underline-offset-2">
                        {e.org_name || `#${e.org_id}`}
                      </Link>
                    </KeyValue>
                  ) : null}
                  {(e.target_type || e.target_name || e.target_id) && (
                    <KeyValue label={t('admin.audit.d.target')}>
                      <span className="block">{e.target_name || e.target_id}</span>
                      {e.target_type && <span className="block text-xs text-neutral-500 font-mono">{e.target_type}{e.target_id && e.target_name ? ` · ${e.target_id}` : ''}</span>}
                    </KeyValue>
                  )}
                </div>
              </Panel>

              <section>
                <h3 className="px-1 pb-2 text-xs font-semibold text-neutral-500">{t('admin.audit.d.changes')}</h3>
                {diff.length === 0 ? (
                  <Panel padded>
                    <p className="text-sm text-neutral-400">{t('admin.audit.d.no_changes')}</p>
                  </Panel>
                ) : (
                  <Panel divided>
                    {diff.map((c) => (
                      <div key={c.field} className="px-4 py-3">
                        <p className="text-xs font-semibold text-neutral-700 font-mono" dir="ltr">
                          {c.field}
                        </p>
                        <div className="mt-1.5 grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-xs" dir="ltr">
                          <pre className="rounded-lg bg-rose-50 text-rose-800 px-2.5 py-1.5 whitespace-pre-wrap break-all">{show(c.before)}</pre>
                          <pre className="rounded-lg bg-emerald-50 text-emerald-800 px-2.5 py-1.5 whitespace-pre-wrap break-all">{show(c.after)}</pre>
                        </div>
                      </div>
                    ))}
                  </Panel>
                )}
              </section>

              {(e.ip || e.user_agent || e.method || e.path || e.request_id) && (
                <section>
                  <h3 className="px-1 pb-2 text-xs font-semibold text-neutral-500">{t('admin.audit.d.request')}</h3>
                  <Panel padded>
                    <div className="divide-y divide-neutral-100">
                      {e.ip && <KeyValue label={t('admin.audit.f.ip')} mono>{e.ip}</KeyValue>}
                      {(e.method || e.path) && (
                        <KeyValue label={t('admin.audit.d.endpoint')} mono>
                          {[e.method, e.path].filter(Boolean).join(' ')}
                          {e.status_code ? ` → ${e.status_code}` : ''}
                        </KeyValue>
                      )}
                      {e.request_id && <KeyValue label={t('admin.audit.d.request_id')} mono>{e.request_id}</KeyValue>}
                      {e.user_agent && <KeyValue label={t('admin.audit.d.user_agent')}>{<span className="text-xs text-neutral-600 break-all">{e.user_agent}</span>}</KeyValue>}
                    </div>
                  </Panel>
                </section>
              )}

              {hasDetails && (
                <section>
                  <h3 className="px-1 pb-2 text-xs font-semibold text-neutral-500">{t('admin.audit.d.details')}</h3>
                  <pre dir="ltr" className="max-h-80 overflow-auto rounded-2xl bg-white nice-shadow p-4 text-[11px] leading-relaxed text-neutral-700">
                    {JSON.stringify(e.details, null, 2)}
                  </pre>
                </section>
              )}
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
