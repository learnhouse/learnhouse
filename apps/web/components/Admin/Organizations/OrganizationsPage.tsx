'use client'
import React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  ArrowSquareOut,
  BookOpen,
  Buildings,
  At,
  CalendarBlank,
  CreditCard,
  CurrencyCircleDollar,
  DownloadSimple,
  Funnel,
  Globe,
  Heartbeat,
  Hourglass,
  Lightning,
  Moon,
  Plus,
  Pulse,
  Tag,
  UserCircle,
  Users,
  X,
} from '@phosphor-icons/react'
import {
  BulkActionBar,
  BulkActionButton,
  Button,
  DashPage,
  EmptyState,
  FieldLabel,
  INPUT,
  Modal,
  Panel,
  ToolbarSelect,
  formatRelative,
} from '@/design'
import { safeHref } from '@services/security/url'
import { getDeploymentMode } from '@services/config/config'
import { errorMessage, exportOrgs, facetList, getOrgVisits, getTeam, listOrgs, updateOrgProfile, type OrgFilters } from '@services/ee/platform/api'
import { platformKeys } from '@services/ee/platform/keys'
import { LIFECYCLES, type ListFacets, type OrgListItem } from '@services/ee/platform/types'
import { useAccessToken, useFrontendDomain, useListKeyboard, usePlatformMe, useUrlQuery, shouldRetry } from '@components/Admin/hooks'
import {
  AdminHeader,
  Avatar,
  CopyLinkButton,
  HealthBadge,
  adminPath,
  orgDisplayName,
  LifecycleChip,
  ListSkeleton,
  NoAccess,
  OrgLogo,
  Pagination,
  PlanChip,
  QueryError,
  Sparkline,
  TagList,
  asList,
} from '@components/Admin/Shared/AdminKit'
import FilterBar, { resolveDate, type FilterDef } from '@components/Admin/Shared/FilterBar'
import CreateOrganizationModal from './CreateOrganizationModal'
import FollowButton from '@components/Admin/Following/FollowButton'

const PAGE_SIZE = 25

type Values = Record<string, string | undefined>

// Sorts: v2 keys take an order (`key:dir`); the rest are the pre-v2 presets.
const SORTS = [
  'created:desc',
  'created:asc',
  'name:asc',
  'members:desc',
  'activity:desc',
  'activity:asc',
  'health:asc',
  'health:desc',
  'courses_desc',
  'most_visits',
  'most_trails',
  'payments_active',
  'recently_updated',
] as const

// URL keys the filter bar writes; they go to the API as they are.
const FILTER_PARAMS = [
  'plan',
  'lifecycle',
  'tag',
  'members_min',
  'members_max',
  'courses_min',
  'courses_max',
  'health_min',
  'health_max',
  'has_custom_domain',
  'poc_ending_within_days',
  'inactive_days_min',
  'account_owner_user_id',
  'email_domain',
  'has_payments',
  'ai_credits_left_pct_max',
] as const

// One-click presets above the filter bar.
const QUICK_VIEWS: { key: string; filters: Values }[] = [
  { key: 'paid', filters: { plan: 'paid' } },
  { key: 'pocs', filters: { lifecycle: 'poc' } },
  { key: 'poc_ending', filters: { poc_ending_within_days: '7' } },
  { key: 'trials', filters: { lifecycle: 'trial' } },
  { key: 'at_risk', filters: { health_max: '39', plan: 'paid' } },
  { key: 'inactive', filters: { inactive_days_min: '30' } },
  { key: 'over_limit', filters: { tag: 'over-limit' } },
]
const QUICK_KEYS = ['q', ...FILTER_PARAMS, 'created_since', 'created_until'] as const

function toQuery(v: Values): OrgFilters & Record<string, string | number | undefined> {
  const [sort, order] = (v.sort || 'created:desc').split(':')
  const out: OrgFilters & Record<string, string | number | undefined> = {
    page: Number(v.page) || 1,
    limit: PAGE_SIZE,
    q: v.q || undefined,
    sort,
    order: (order as 'asc' | 'desc') || undefined,
    created_since: resolveDate(v.created_since),
    created_until: resolveDate(v.created_until, true),
  }
  for (const k of FILTER_PARAMS) if (v[k]) out[k] = v[k]
  return out
}

export default function OrganizationsPage() {
  const { t, i18n } = useTranslation()
  const token = useAccessToken()
  const router = useRouter()
  const me = usePlatformMe()
  const queryClient = useQueryClient()
  const isSaaS = getDeploymentMode() === 'saas'
  const domain = useFrontendDomain()
  const [filters, setFilters] = useUrlQuery()
  const [createOpen, setCreateOpen] = React.useState(false)
  const [selected, setSelected] = React.useState<Set<number>>(new Set())
  const [tagDialog, setTagDialog] = React.useState<'add' | 'remove' | null>(null)
  const [exporting, setExporting] = React.useState(false)

  const query = toQuery(filters)
  const page = query.page ?? 1
  const canRead = me.can('platform.read')

  const q = useQuery({
    queryKey: platformKeys.orgs(query),
    queryFn: () => listOrgs(token, query),
    enabled: !!token && canRead,
    retry: shouldRetry,
    placeholderData: (prev) => prev,
  })

  // Team members for the account-owner filter.
  const team = useQuery({
    queryKey: platformKeys.team(),
    queryFn: () => getTeam(token),
    enabled: !!token && canRead,
    retry: shouldRetry,
    staleTime: 5 * 60_000,
  })

  const visits = useQuery({
    queryKey: platformKeys.orgVisits(),
    queryFn: () => getOrgVisits(token),
    enabled: !!token && canRead,
    retry: shouldRetry,
  })

  const sparkByOrg = React.useMemo(() => {
    const map: Record<number, number[]> = {}
    const rows = Array.isArray(visits.data?.data) ? visits.data!.data : []
    const raw: Record<number, Record<string, number>> = {}
    for (const r of rows) (raw[r.org_id] ??= {})[r.date] = r.views
    const dates: string[] = []
    for (let i = 6; i >= 0; i--) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      dates.push(d.toISOString().slice(0, 10))
    }
    for (const [id, byDate] of Object.entries(raw)) map[Number(id)] = dates.map((d) => byDate[d] || 0)
    return map
  }, [visits.data])

  const items: OrgListItem[] = Array.isArray(q.data?.items) ? q.data!.items : []
  const total = q.data?.total ?? 0
  // j/k + Enter open organizations from the keyboard.
  const kb = useListKeyboard(items, (o) => router.push(adminPath.org(o.id)))
  const filtered = QUICK_KEYS.some((k) => !!filters[k])
  const facets = (q.data as { facets?: ListFacets } | undefined)?.facets

  // Selection is per page; a new result set drops ids that are gone.
  React.useEffect(() => {
    setSelected((prev) => {
      const ids = new Set(items.map((o) => o.id))
      const next = new Set([...prev].filter((id) => ids.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [items])

  const tagOptions = React.useMemo(() => {
    const set = new Set<string>(['at-risk', 'dormant', 'over-limit', 'low-credits', 'poc-ending'])
    for (const o of items) for (const tag of o.tags ?? []) set.add(tag)
    return [...set].sort()
  }, [items])

  if (!me.isLoading && !canRead) {
    return (
      <DashPage>
        <AdminHeader title={t('admin.nav.organizations')} />
        <NoAccess />
      </DashPage>
    )
  }

  const applyView = (f: Values) => {
    const updates: Values = { page: undefined }
    for (const k of QUICK_KEYS) updates[k] = f[k]
    setFilters(updates)
  }
  const viewActive = (f: Values) => QUICK_KEYS.every((k) => (f[k] ?? '') === (filters[k] ?? ''))

  const counts = (key: string) => Object.fromEntries(facetList(facets?.[key]).map((x) => [x.value, x.count]))
  const planCounts = counts('plan')
  // "paid" is a group, not a plan the facets know: sum the paid plans.
  if (facets?.plan) planCounts.paid = (planCounts.standard ?? 0) + (planCounts.pro ?? 0) + (planCounts.enterprise ?? 0)
  const lifecycleCounts = counts('lifecycle')
  const tagFacets = facetList(facets?.tag ?? facets?.tags)
  const owners = asList(team.data?.members)
  const defs: FilterDef[] = [
    {
      kind: 'select',
      key: 'plan',
      label: t('admin.orgs.filters.plan'),
      icon: <CreditCard size={14} />,
      hidden: !isSaaS,
      // With facets present, a missing value means 0 (not "unknown").
      options: ['free', 'paid', 'standard', 'pro', 'enterprise'].map((p) => ({ value: p, label: t(`admin.org_list.plan_${p}`), count: facets?.plan ? planCounts[p] ?? 0 : undefined })),
    },
    {
      kind: 'select',
      key: 'lifecycle',
      label: t('admin.orgs.filters.lifecycle'),
      icon: <Pulse size={14} />,
      options: LIFECYCLES.map((l) => ({ value: l, label: t(`admin.lifecycle.${l}`), count: facets?.lifecycle ? lifecycleCounts[l] ?? 0 : undefined })),
    },
    {
      kind: 'async',
      key: 'tag',
      label: t('admin.orgs.filters.tag'),
      icon: <Tag size={14} />,
      options: (tagFacets.length ? tagFacets : tagOptions.map((v) => ({ value: v, count: undefined as number | undefined }))).map((x) => ({ value: x.value, label: x.value, count: x.count })),
      // Free text: any tag can be typed; known ones are suggested.
      load: async (text) => {
        const v = text.trim().toLowerCase()
        const known = (tagFacets.length ? tagFacets.map((x) => x.value) : tagOptions).filter((x) => x.includes(v))
        return Array.from(new Set([v, ...known])).filter(Boolean).map((x) => ({ value: x, label: x }))
      },
      placeholder: t('admin.orgs.filters.tag_placeholder'),
    },
    { kind: 'range', key: 'members', minKey: 'members_min', maxKey: 'members_max', label: t('admin.orgs.filters.members'), icon: <Users size={14} /> },
    { kind: 'range', key: 'courses', minKey: 'courses_min', maxKey: 'courses_max', label: t('admin.orgs.filters.courses'), icon: <BookOpen size={14} /> },
    { kind: 'range', key: 'health', minKey: 'health_min', maxKey: 'health_max', label: t('admin.common.health'), icon: <Heartbeat size={14} /> },
    { kind: 'boolean', key: 'has_custom_domain', label: t('admin.orgs.filters.custom_domain'), icon: <Globe size={14} /> },
    {
      kind: 'number',
      key: 'poc_ending_within_days',
      label: t('admin.orgs.filters.poc_ending'),
      icon: <Hourglass size={14} />,
      min: 0,
      suffix: t('admin.orgs.filters.days'),
      placeholder: '7',
    },
    { kind: 'number', key: 'inactive_days_min', label: t('admin.orgs.filters.inactive'), icon: <Moon size={14} />, min: 1, suffix: t('admin.orgs.filters.days'), placeholder: '30' },
    {
      kind: 'select',
      key: 'account_owner_user_id',
      label: t('admin.orgs.col_owner'),
      icon: <UserCircle size={14} />,
      options: owners.map((m) => ({ value: String(m.user_id), label: m.username })),
    },
    { kind: 'date', key: 'created', sinceKey: 'created_since', untilKey: 'created_until', label: t('admin.orgs.filters.created'), icon: <CalendarBlank size={14} /> },
    { kind: 'text', key: 'email_domain', label: t('admin.orgs.filters.email_domain'), icon: <At size={14} />, placeholder: 'acme.com' },
    { kind: 'boolean', key: 'has_payments', label: t('admin.orgs.filters.has_payments'), icon: <CurrencyCircleDollar size={14} /> },
    {
      kind: 'number',
      key: 'ai_credits_left_pct_max',
      label: t('admin.orgs.filters.ai_credits_left'),
      icon: <Lightning size={14} />,
      min: 0,
      max: 100,
      suffix: '%',
      placeholder: '10',
    },
  ]

  const handleExport = async () => {
    setExporting(true)
    try {
      await exportOrgs(token, query)
    } catch (err) {
      toast.error(errorMessage(err, t('admin.orgs.export_failed')))
    } finally {
      setExporting(false)
    }
  }

  const allOnPage = items.length > 0 && items.every((o) => selected.has(o.id))
  const toggleAll = () => setSelected(allOnPage ? new Set() : new Set(items.map((o) => o.id)))
  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const canBulkTag = me.can('notes.write')
  const protocol = typeof window !== 'undefined' ? window.location.protocol : 'http:'
  const rowPad = 'py-3.5'

  return (
    <DashPage bottom="xl">
      <AdminHeader
        title={t('admin.orgs.title')}
        subtitle={t('admin.orgs.subtitle')}
        actions={
          <>
            {me.can('export.data') && (
              <Button icon={<DownloadSimple size={14} />} onClick={handleExport} loading={exporting}>
                {t('admin.orgs.export')}
              </Button>
            )}
            {me.can('orgs.create') && (
              <Button variant="primary" icon={<Plus size={14} weight="bold" />} onClick={() => setCreateOpen(true)}>
                {t('admin.org_list.new_organization')}
              </Button>
            )}
          </>
        }
      />

      {/* One-click presets */}
      <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide -mx-4 px-4 sm:mx-0 sm:px-0">
        <ViewChip active={viewActive({})} onClick={() => applyView({})}>
          {t('admin.orgs.views.all')}
        </ViewChip>
        {QUICK_VIEWS.map((v) => (
          <ViewChip key={v.key} active={viewActive(v.filters)} onClick={() => applyView(v.filters)}>
            {t(`admin.orgs.views.${v.key}`)}
          </ViewChip>
        ))}
      </div>

      <FilterBar
        values={filters}
        onChange={setFilters}
        defs={defs}
        search={{ key: 'q', placeholder: t('admin.orgs.search') }}
        savedViewsKey="lh:admin:views:orgs"
        end={
          <>
            <ToolbarSelect
              ariaLabel={t('admin.orgs.filters.sort')}
              value={filters.sort || 'created:desc'}
              onChange={(v) => setFilters({ sort: v === 'created:desc' ? undefined : v, page: undefined })}
              options={SORTS.map((s) => ({ value: s, label: t(`admin.orgs.sort.${s.replace(':', '_')}`) }))}
            />
            <CopyLinkButton label="" />
          </>
        }
      />

      {q.error && !q.data ? (
        <QueryError error={q.error} onRetry={() => q.refetch()} />
      ) : q.isLoading ? (
        <ListSkeleton rows={8} />
      ) : items.length === 0 ? (
        <Panel>
          {filtered ? (
            <EmptyState
              icon={<Funnel size={22} />}
              title={t('admin.orgs.empty_filtered_title')}
              description={t('admin.orgs.empty_filtered_desc')}
              action={
                <Button size="sm" onClick={() => applyView({})}>
                  {t('admin.orgs.clear_filters')}
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={<Buildings size={22} />}
              title={t('admin.org_list.no_orgs')}
              description={t('admin.orgs.empty_desc')}
              action={
                me.can('orgs.create') ? (
                  <Button size="sm" variant="primary" icon={<Plus size={13} weight="bold" />} onClick={() => setCreateOpen(true)}>
                    {t('admin.org_list.new_organization')}
                  </Button>
                ) : undefined
              }
            />
          )}
        </Panel>
      ) : (
        <>
          <Panel divided className={q.isFetching ? 'opacity-70 transition-opacity' : 'transition-opacity'}>
            <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] md:grid-cols-[auto_minmax(0,1fr)_7rem_5rem_5rem_6rem] xl:grid-cols-[auto_minmax(0,1fr)_7rem_5rem_5rem_6rem_5.5rem_7rem] items-center gap-x-4 px-5 py-3 border-b border-neutral-100 text-xs font-medium text-neutral-500">
              <input
                type="checkbox"
                aria-label={t('admin.orgs.select_all')}
                checked={allOnPage}
                onChange={toggleAll}
                disabled={!canBulkTag}
                className="h-4 w-4 accent-neutral-900 disabled:opacity-30"
              />
              <span>{t('admin.org_list.col_organization')}</span>
              <span className="hidden md:block">{t('admin.orgs.col_status')}</span>
              <span className="hidden md:block text-end">{t('admin.org_list.col_users')}</span>
              <span className="hidden md:block text-end">{t('admin.org_list.col_courses')}</span>
              <span className="hidden md:block">{t('admin.common.health')}</span>
              <span className="hidden xl:block">{t('admin.org_list.col_visits_7d')}</span>
              <span className="hidden xl:block">{t('admin.orgs.col_owner')}</span>
              <span className="md:hidden" />
            </div>
            {items.map((org, index) => {
              const orgUrl = `${protocol}//${org.slug}.${domain}`
              return (
                <div
                  key={org.id}
                  {...kb.rowProps(index)}
                  className={`group grid grid-cols-[auto_minmax(0,1fr)_auto] md:grid-cols-[auto_minmax(0,1fr)_7rem_5rem_5rem_6rem] xl:grid-cols-[auto_minmax(0,1fr)_7rem_5rem_5rem_6rem_5.5rem_7rem] items-center gap-x-4 px-5 ${rowPad} hover:bg-neutral-50/70 data-[active=true]:bg-neutral-50 data-[active=true]:shadow-[inset_2px_0_0_rgb(255_255_255/0.4)] ${
                    selected.has(org.id) ? 'bg-neutral-50' : ''
                  }`}
                >
                  <input
                    type="checkbox"
                    aria-label={t('admin.orgs.select', { name: org.name })}
                    checked={selected.has(org.id)}
                    onChange={() => toggle(org.id)}
                    disabled={!canBulkTag}
                    className="h-4 w-4 accent-neutral-900 disabled:opacity-30"
                  />
                  <div className="flex items-center gap-3 min-w-0">
                    <Link href={`/admin/organizations/${org.id}`} className="shrink-0">
                      <OrgLogo org={org} size={34} />
                    </Link>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <Link href={`/admin/organizations/${org.id}`} className="truncate text-sm font-semibold text-neutral-900 hover:underline underline-offset-2">
                          {orgDisplayName(org, t)}
                        </Link>
                        <span className="md:hidden shrink-0">
                          <PlanChip plan={isSaaS ? org.plan : undefined} />
                        </span>
                        <FollowButton orgId={org.id} orgName={orgDisplayName(org, t)} compact />
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 min-w-0 text-xs text-neutral-400">
                        <a href={safeHref(orgUrl)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 truncate hover:text-neutral-700" dir="ltr">
                          <Globe size={11} className="shrink-0" />
                          <span className="truncate">
                            {org.slug}.{domain}
                          </span>
                        </a>
                        {(org.custom_domains?.length ?? 0) > 0 && (
                          <span className="hidden sm:inline shrink-0 text-emerald-600">+{org.custom_domains.length}</span>
                        )}
                        <span className="hidden sm:inline shrink-0" title={org.creation_date}>
                          · {formatRelative(org.creation_date, i18n.language)}
                        </span>
                      </div>
                      {(org.tags?.length ?? 0) > 0 && (
                        <div className="mt-1">
                          <TagList tags={org.tags} max={4} />
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="hidden md:flex flex-col items-start gap-1">
                    {isSaaS && <PlanChip plan={org.plan} />}
                    <LifecycleChip lifecycle={org.lifecycle} />
                  </div>
                  <span className="hidden md:block text-end text-sm tabular-nums text-neutral-700">{(org.user_count ?? 0).toLocaleString()}</span>
                  <span className="hidden md:flex items-center justify-end gap-1 text-sm tabular-nums text-neutral-700">
                    <BookOpen size={13} className="text-neutral-300" />
                    {(org.course_count ?? 0).toLocaleString()}
                  </span>
                  <span className="hidden md:block">
                    <HealthBadge score={org.health_score} />
                  </span>
                  <span className="hidden xl:flex items-center gap-1.5">
                    <Sparkline data={sparkByOrg[org.id] ?? []} width={44} />
                    <span className="text-xs tabular-nums text-neutral-500">{(sparkByOrg[org.id] ?? []).reduce((a, b) => a + b, 0) || ''}</span>
                  </span>
                  <span className="hidden xl:flex items-center gap-1.5 min-w-0">
                    {org.account_owner ? (
                      <Link href={adminPath.user(org.account_owner.user_id ?? org.account_owner.id ?? '')} className="flex items-center gap-1.5 min-w-0 hover:underline underline-offset-2">
                        <Avatar user={org.account_owner} size={20} />
                        <span className="truncate text-xs text-neutral-600">{org.account_owner.username}</span>
                      </Link>
                    ) : (
                      <span className="text-xs text-neutral-300">–</span>
                    )}
                  </span>
                  <a
                    href={safeHref(`${orgUrl}/dash`)}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={t('admin.org_list.open_dashboard')}
                    aria-label={t('admin.org_list.open_dashboard')}
                    className="md:hidden h-8 w-8 inline-flex items-center justify-center rounded-lg text-neutral-400 hover:text-neutral-900 hover:bg-neutral-100"
                  >
                    <ArrowSquareOut size={15} />
                  </a>
                </div>
              )
            })}
          </Panel>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-neutral-400">{t('admin.org_list.orgs_count', { count: total })}</span>
            <div className="flex-1 min-w-0">
              <Pagination page={page} total={total} limit={PAGE_SIZE} onPage={(p) => setFilters({ page: p === 1 ? undefined : String(p) })} />
            </div>
          </div>
        </>
      )}

      <BulkActionBar count={selected.size} label={t('admin.orgs.selected', { count: selected.size })} onClear={() => setSelected(new Set())}>
        <BulkActionButton icon={<Tag size={14} />} label={t('admin.orgs.bulk.add_tag')} onClick={() => setTagDialog('add')} />
        <BulkActionButton icon={<X size={14} />} label={t('admin.orgs.bulk.remove_tag')} onClick={() => setTagDialog('remove')} />
      </BulkActionBar>

      <BulkTagDialog
        mode={tagDialog}
        orgs={items.filter((o) => selected.has(o.id))}
        onClose={() => setTagDialog(null)}
        onDone={() => {
          setTagDialog(null)
          setSelected(new Set())
          queryClient.invalidateQueries({ queryKey: platformKeys.orgs() })
        }}
        token={token}
      />
      <CreateOrganizationModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </DashPage>
  )
}

function ViewChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center shrink-0 h-7 px-3 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${
        active ? 'bg-neutral-900 text-white' : 'bg-white text-neutral-600 nice-shadow hover:text-neutral-900'
      }`}
    >
      {children}
    </button>
  )
}

function BulkTagDialog({
  mode,
  orgs,
  onClose,
  onDone,
  token,
}: {
  mode: 'add' | 'remove' | null
  orgs: OrgListItem[]
  onClose: () => void
  onDone: () => void
  token?: string
}) {
  const { t } = useTranslation()
  const [tag, setTag] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  React.useEffect(() => {
    if (mode) setTag('')
  }, [mode])

  const clean = tag.trim().toLowerCase().replace(/\s+/g, '-').slice(0, 32)
  const run = async () => {
    if (!clean || !mode) return
    setBusy(true)
    let ok = 0
    let failed = 0
    let lastError: unknown = null
    // One PUT per org: tags are a per-org list, there is no bulk endpoint.
    for (const org of orgs) {
      const current = Array.isArray(org.tags) ? org.tags : []
      const next = mode === 'add' ? Array.from(new Set([...current, clean])) : current.filter((x) => x !== clean)
      if (next.length === current.length && next.every((x, i) => x === current[i])) {
        ok++
        continue
      }
      try {
        await updateOrgProfile(token, org.id, { tags: next })
        ok++
      } catch (err) {
        failed++
        lastError = err
      }
    }
    setBusy(false)
    if (failed) toast.error(errorMessage(lastError, t('admin.orgs.bulk.failed', { count: failed })))
    if (ok) toast.success(mode === 'add' ? t('admin.orgs.bulk.added', { tag: clean, count: ok }) : t('admin.orgs.bulk.removed', { tag: clean, count: ok }))
    onDone()
  }

  return (
    <Modal
      isDialogOpen={!!mode}
      onOpenChange={(o) => !o && onClose()}
      preventClose={busy}
      size="sm"
      icon={<Tag size={18} />}
      dialogTitle={mode === 'remove' ? t('admin.orgs.bulk.remove_title', { count: orgs.length }) : t('admin.orgs.bulk.add_title', { count: orgs.length })}
      dialogDescription={mode === 'remove' ? t('admin.orgs.bulk.remove_desc') : t('admin.orgs.bulk.add_desc')}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button variant={mode === 'remove' ? 'danger' : 'primary'} onClick={run} disabled={!clean} loading={busy}>
            {mode === 'remove' ? t('admin.orgs.bulk.remove_cta') : t('admin.orgs.bulk.add_cta')}
          </Button>
        </>
      }
      dialogContent={
        <form
          onSubmit={(e) => {
            e.preventDefault()
            run()
          }}
        >
          <FieldLabel hint={t('admin.orgs.bulk.tag_hint')}>{t('admin.orgs.bulk.tag')}</FieldLabel>
          <input autoFocus className={INPUT} value={tag} onChange={(e) => setTag(e.target.value)} placeholder="beta-tester" maxLength={32} />
        </form>
      }
    />
  )
}

