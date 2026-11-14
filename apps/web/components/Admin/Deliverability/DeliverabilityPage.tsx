'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  ArrowCounterClockwise,
  Buildings,
  CheckCircle,
  Gauge,
  HandPalm,
  PaperPlaneTilt,
  Play,
  Plus,
  Prohibit,
  Pulse,
  Queue,
  SealCheck,
  ShieldSlash,
  Trash,
  Warning,
  WarningOctagon,
  XCircle,
} from '@phosphor-icons/react'
import {
  Button,
  ConfirmDialog,
  DashPage,
  EmptyState,
  Panel,
  SearchInput,
  Skeleton,
  StatCard,
  StatusPill,
  SubTabPanel,
  SubTabs,
  ToolbarSelect,
  formatRelative,
} from '@/design'
import { errorMessage } from '@services/ee/platform/api'
import {
  deliverabilityKeys,
  getDeliverability,
  listGlobalSuppressions,
  pausedReasonText,
  removeGlobalSuppression,
  resumeOrgSending,
  verifyOrgSending,
  type DeliverabilityOrg,
  type DeliverabilityOverview,
  type DeliverabilityThresholds,
  type GlobalSuppression,
} from '@services/ee/platform/deliverability'
import {
  shouldRetry,
  useAccessToken,
  useDebounced,
  usePlatformMe,
} from '@components/Admin/hooks'
import {
  AdminHeader,
  CopyLinkButton,
  ListSkeleton,
  NoAccess,
  Pagination,
  QueryError,
  formatDate,
} from '@components/Admin/Shared/AdminKit'
import {
  IconTile,
  OrgCell,
  ToneCard,
  useUrlTab,
} from '@components/Admin/Shared/OpsKit'
import { Td, Th } from '@components/Admin/AICosts/aiCostsKit'
import {
  AddSuppressionDialog,
  RatePill,
  STATUS_TILE,
  SendingStatusPill,
  SuspendDialog,
  num,
  pct,
  rateStatus,
  riskScore,
  useInvalidateDeliverability,
} from './deliverabilityUi'

// Newsletter deliverability across the platform: the sending provider's
// health, volume and complaint signals, every org's sending state (auto
// paused, suspended, in review) with resume / suspend / verify, the
// thresholds behind auto-pause, and the global suppression list.

const TABS = ['orgs', 'suppressions', 'thresholds'] as const
type Tab = (typeof TABS)[number]
type Sort = 'risk' | 'volume' | 'name'
type StatusFilter =
  'all' | 'attention' | 'active' | 'review' | 'paused' | 'suspended'
const PAGE_SIZE = 50

export default function DeliverabilityPage() {
  const { t } = useTranslation()
  const token = useAccessToken()
  const me = usePlatformMe()
  const [tab, setTab, values, setValues] = useUrlTab<Tab>(TABS, 'orgs', [
    'q',
    'status',
    'sort',
    'page',
  ])

  const q = useQuery({
    queryKey: deliverabilityKeys.overview(),
    queryFn: () => getDeliverability(token),
    enabled: !!token && me.can('platform.read'),
    retry: shouldRetry,
    refetchInterval: 60_000,
  })

  if (!me.isLoading && !me.can('platform.read')) {
    return (
      <DashPage>
        <AdminHeader title={t('admin.deliverability.title')} />
        <NoAccess />
      </DashPage>
    )
  }

  const data = q.data
  const orgs = Array.isArray(data?.orgs) ? data!.orgs : []
  const stopped = orgs.filter(
    (o) => o.status === 'paused' || o.status === 'suspended'
  ).length

  return (
    <DashPage>
      <AdminHeader
        title={t('admin.deliverability.title')}
        subtitle={t('admin.deliverability.subtitle')}
        actions={
          <>
            <CopyLinkButton label="" />
            <Button
              icon={<ArrowCounterClockwise size={14} />}
              onClick={() => q.refetch()}
              loading={q.isFetching && !q.isLoading}
            >
              {t('admin.deliverability.refresh')}
            </Button>
          </>
        }
      />

      {q.error ? (
        <QueryError error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <>
          <ProviderCard data={data} loading={q.isLoading} />
          <Totals data={data} loading={q.isLoading} />

          <SubTabs
            items={[
              {
                key: 'orgs' as const,
                label: t('admin.deliverability.tab_orgs'),
                icon: <Buildings size={15} className="text-blue-600" />,
                badge: stopped ? (
                  <span className="text-xs tabular-nums text-rose-600 font-semibold">
                    {stopped}
                  </span>
                ) : undefined,
              },
              {
                key: 'suppressions' as const,
                label: t('admin.deliverability.tab_suppressions'),
                icon: <ShieldSlash size={15} className="text-rose-600" />,
              },
              {
                key: 'thresholds' as const,
                label: t('admin.deliverability.tab_thresholds'),
                icon: <Gauge size={15} className="text-amber-600" />,
              },
            ]}
            value={tab}
            onChange={setTab}
            ariaLabel={t('admin.deliverability.title')}
          >
            <SubTabPanel tab="orgs" unmountWhenHidden>
              <OrgsTab
                data={data}
                loading={q.isLoading}
                canAct={me.can('orgs.update')}
                values={values}
                setValues={(v) => setValues(v, { replace: true })}
              />
            </SubTabPanel>
            <SubTabPanel tab="suppressions" unmountWhenHidden>
              <SuppressionsTab canAct={me.can('orgs.update')} />
            </SubTabPanel>
            <SubTabPanel tab="thresholds" unmountWhenHidden>
              <ThresholdsCard
                thresholds={data?.thresholds}
                loading={q.isLoading}
              />
            </SubTabPanel>
          </SubTabs>
        </>
      )}
    </DashPage>
  )
}

// ─── provider ────────────────────────────────────────────────────────────────

function ProviderCard({
  data,
  loading,
}: {
  data?: DeliverabilityOverview
  loading: boolean
}) {
  const { t, i18n } = useTranslation()
  if (loading || !data)
    return <Skeleton className="h-[74px] w-full rounded-2xl" />
  const p = data.provider
  const state = !p.configured
    ? 'not_configured'
    : p.healthy
      ? 'healthy'
      : 'unhealthy'
  const tone =
    state === 'healthy' ? 'emerald' : state === 'unhealthy' ? 'rose' : 'amber'
  const status =
    state === 'healthy'
      ? 'success'
      : state === 'unhealthy'
        ? 'danger'
        : 'warning'
  return (
    <Panel
      padded
      className="flex flex-col lg:flex-row lg:items-center gap-4 lg:gap-6"
    >
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <IconTile
          icon={
            state === 'healthy' ? (
              <Pulse size={18} />
            ) : (
              <WarningOctagon size={18} />
            )
          }
          tone={tone}
        />
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-neutral-900">
            <span className="truncate">
              {providerLabel(p.name) || t('admin.deliverability.provider')}
            </span>
            <StatusPill status={status} dot>
              {t(`admin.deliverability.provider_${state}`)}
            </StatusPill>
          </p>
          <p className="text-xs text-neutral-500 truncate">
            {p.from_domain ? (
              <>
                {t('admin.deliverability.from_domain')}{' '}
                <span dir="ltr" className="font-mono text-neutral-700">
                  {p.from_domain}
                </span>
              </>
            ) : (
              t('admin.deliverability.no_from_domain')
            )}
            {p.last_ok_at && (
              <>
                {' '}
                ·{' '}
                {t('admin.deliverability.last_ok', {
                  when: formatRelative(p.last_ok_at, i18n.language),
                })}
              </>
            )}
          </p>
        </div>
      </div>
      {p.error && (
        <div className="flex items-start gap-2 min-w-0 lg:max-w-[50%] rounded-xl bg-amber-50 px-3 py-2">
          <Warning
            size={15}
            weight="fill"
            className="text-amber-600 shrink-0 mt-px"
          />
          <div className="min-w-0">
            <p className="text-xs font-semibold text-amber-800">
              {t('admin.deliverability.cannot_send')}
            </p>
            <p
              className="text-xs text-amber-800 break-words line-clamp-2"
              dir="ltr"
              title={p.error}
            >
              {p.error}
            </p>
          </div>
        </div>
      )}
      {p.last_error ? (
        <div className="flex items-start gap-2 min-w-0 lg:max-w-[50%] rounded-xl bg-rose-50 px-3 py-2">
          <XCircle
            size={15}
            weight="fill"
            className="text-rose-600 shrink-0 mt-px"
          />
          <div className="min-w-0">
            <p className="text-xs font-semibold text-rose-700">
              {t('admin.deliverability.last_error')}
              {p.last_error_at && (
                <span
                  className="font-normal"
                  title={formatDate(p.last_error_at, i18n.language, true)}
                >
                  {' '}
                  · {formatRelative(p.last_error_at, i18n.language)}
                </span>
              )}
            </p>
            <p
              className="text-xs text-rose-700 break-words line-clamp-2"
              dir="ltr"
              title={p.last_error}
            >
              {p.last_error}
            </p>
          </div>
        </div>
      ) : p.configured && !p.error ? (
        <p className="inline-flex items-center gap-1.5 text-xs text-neutral-500">
          <CheckCircle size={14} weight="fill" className="text-emerald-600" />
          {t('admin.deliverability.no_errors')}
        </p>
      ) : null}
    </Panel>
  )
}

// ─── totals ──────────────────────────────────────────────────────────────────

function Totals({
  data,
  loading,
}: {
  data?: DeliverabilityOverview
  loading: boolean
}) {
  const { t } = useTranslation()
  const tt = data?.totals
  const th = data?.thresholds
  const v = (x: string) => (loading || !tt ? null : x)
  const bounce = rateStatus(tt?.bounce_rate_7d, th?.bounce_rate ?? 0)
  const complaint = rateStatus(tt?.complaint_rate_7d, th?.complaint_rate ?? 0)
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
      <StatCard
        icon={<PaperPlaneTilt size={18} />}
        iconClass="bg-sky-50 text-sky-600"
        label={t('admin.deliverability.sent_24h')}
        value={v(num(tt?.sent_24h))}
      />
      <StatCard
        icon={<PaperPlaneTilt size={18} />}
        iconClass="bg-blue-50 text-blue-600"
        label={t('admin.deliverability.sent_30d')}
        value={v(num(tt?.sent_30d))}
      />
      <StatCard
        icon={<XCircle size={18} />}
        iconClass={
          (tt?.failed_24h ?? 0) > 0 ? STATUS_TILE.danger : STATUS_TILE.neutral
        }
        label={t('admin.deliverability.failed_24h')}
        value={v(num(tt?.failed_24h))}
      />
      <StatCard
        icon={<Queue size={18} />}
        iconClass="bg-amber-50 text-amber-600"
        label={t('admin.deliverability.queue_depth')}
        value={v(num(tt?.queue_depth))}
      />
      <StatCard
        icon={<Warning size={18} />}
        iconClass={STATUS_TILE[bounce]}
        label={t('admin.deliverability.col_bounce')}
        value={v(pct(tt?.bounce_rate_7d))}
      />
      <StatCard
        icon={<HandPalm size={18} />}
        iconClass={STATUS_TILE[complaint]}
        label={t('admin.deliverability.col_complaint')}
        value={v(pct(tt?.complaint_rate_7d, 3))}
      />
    </div>
  )
}

// ─── orgs ────────────────────────────────────────────────────────────────────

function matchesStatus(
  o: DeliverabilityOrg,
  f: StatusFilter,
  th: DeliverabilityThresholds
) {
  if (f === 'all') return true
  if (f === 'attention') {
    if (o.status !== 'active' || (o.in_review ?? 0) > 0) return true
    const judged = (o.sent_30d ?? 0) >= (th.min_sample ?? 0)
    return (
      judged &&
      (o.bounce_rate_7d >= th.bounce_rate / 2 ||
        o.complaint_rate_7d >= th.complaint_rate / 2)
    )
  }
  return o.status === f
}

function OrgsTab({
  data,
  loading,
  canAct,
  values,
  setValues,
}: {
  data?: DeliverabilityOverview
  loading: boolean
  canAct: boolean
  values: Record<string, string | undefined>
  setValues: (_v: Record<string, string | undefined>) => void
}) {
  const { t, i18n } = useTranslation()
  const token = useAccessToken()
  const invalidate = useInvalidateDeliverability()
  const [draft, setDraft] = React.useState(values.q ?? '')
  const search = useDebounced(draft.trim().toLowerCase(), 200)
  const sort = (
    ['risk', 'volume', 'name'].includes(values.sort ?? '')
      ? values.sort
      : 'risk'
  ) as Sort
  const status = (values.status ?? 'all') as StatusFilter
  const [suspend, setSuspend] = React.useState<DeliverabilityOrg | null>(null)
  const [confirm, setConfirm] = React.useState<{
    kind: 'resume' | 'verify'
    org: DeliverabilityOrg
  } | null>(null)

  React.useEffect(() => {
    if (search !== (values.q ?? '')) setValues({ q: search || undefined })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const th = data?.thresholds
  const rows = React.useMemo(() => {
    if (!data || !th) return []
    const list = (Array.isArray(data.orgs) ? data.orgs : []).filter(
      (o) =>
        matchesStatus(o, status, th) &&
        (!search ||
          `${o.name} ${o.slug} ${o.org_id}`.toLowerCase().includes(search))
    )
    return list.sort((a, b) => {
      if (sort === 'name') return (a.name || '').localeCompare(b.name || '')
      if (sort === 'volume') return (b.sent_30d || 0) - (a.sent_30d || 0)
      return riskScore(b, th) - riskScore(a, th)
    })
  }, [data, th, status, search, sort])

  const run = async (kind: 'resume' | 'verify', org: DeliverabilityOrg) => {
    try {
      if (kind === 'resume') await resumeOrgSending(token, org.org_id)
      else await verifyOrgSending(token, org.org_id)
      toast.success(
        t(
          kind === 'resume'
            ? 'admin.deliverability.resumed_toast'
            : 'admin.deliverability.verified_toast',
          { name: org.name }
        )
      )
      invalidate()
    } catch (err) {
      toast.error(errorMessage(err, t('admin.common.error_desc')))
      throw err
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-2.5 sm:items-center">
        <SearchInput
          className="sm:max-w-md"
          value={draft}
          onChange={setDraft}
          placeholder={t('admin.deliverability.search_orgs')}
        />
        <div className="flex flex-wrap items-center gap-2 sm:ms-auto">
          <ToolbarSelect
            ariaLabel={t('admin.deliverability.filter_status')}
            value={status}
            onChange={(v) => setValues({ status: v === 'all' ? undefined : v })}
            options={(
              [
                'all',
                'attention',
                'active',
                'review',
                'paused',
                'suspended',
              ] as const
            ).map((s) => ({
              value: s,
              label: t(`admin.deliverability.filter.${s}`),
            }))}
          />
          <ToolbarSelect
            ariaLabel={t('admin.deliverability.sort_label')}
            value={sort}
            onChange={(v) => setValues({ sort: v === 'risk' ? undefined : v })}
            options={(['risk', 'volume', 'name'] as const).map((s) => ({
              value: s,
              label: t(`admin.deliverability.sort.${s}`),
            }))}
          />
        </div>
      </div>

      {loading || !th ? (
        <ListSkeleton rows={5} />
      ) : rows.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<Buildings size={22} />}
            title={
              search || status !== 'all'
                ? t('admin.deliverability.no_org_match')
                : t('admin.deliverability.no_orgs')
            }
            description={
              search || status !== 'all'
                ? t('admin.deliverability.no_org_match_desc')
                : t('admin.deliverability.no_orgs_desc')
            }
          />
        </Panel>
      ) : (
        <Panel className="overflow-hidden">
          <div className="overflow-x-auto scrollbar-hide">
            <table className="w-full min-w-[1080px] text-sm">
              <thead>
                <tr className="border-b border-neutral-100 text-xs text-neutral-500">
                  <Th>{t('admin.deliverability.col_org')}</Th>
                  <Th>{t('admin.deliverability.col_status')}</Th>
                  <Th end>{t('admin.deliverability.col_sent_24h')}</Th>
                  <Th end>{t('admin.deliverability.col_sent_30d')}</Th>
                  <Th end>{t('admin.deliverability.col_bounce')}</Th>
                  <Th end>{t('admin.deliverability.col_complaint')}</Th>
                  <Th>{t('admin.deliverability.col_warmup')}</Th>
                  <Th end>{t('admin.deliverability.col_actions')}</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {rows.map((o) => {
                  const stopped =
                    o.status === 'paused' || o.status === 'suspended'
                  return (
                    <tr
                      key={o.org_id}
                      className="hover:bg-neutral-50/70 align-top"
                    >
                      <Td className="py-3">
                        <OrgCell
                          id={o.org_id}
                          name={o.name}
                          plan={o.plan}
                          sub={
                            <span className="inline-flex items-center gap-1.5">
                              <span dir="ltr">{o.slug}</span>
                              {o.verified ? (
                                <span
                                  className="inline-flex items-center gap-0.5 text-emerald-600"
                                  title={t(
                                    'admin.deliverability.verified_title'
                                  )}
                                >
                                  <SealCheck size={12} weight="fill" />
                                  {t('admin.deliverability.verified')}
                                </span>
                              ) : (
                                <span className="text-neutral-400">
                                  {t('admin.deliverability.unverified')}
                                </span>
                              )}
                            </span>
                          }
                        />
                      </Td>
                      <Td className="py-3 max-w-[260px]">
                        <span className="inline-flex flex-wrap items-center gap-1.5">
                          <SendingStatusPill status={o.status} />
                          {(o.in_review ?? 0) > 0 && (
                            <StatusPill status="info">
                              {t('admin.deliverability.in_review_count', {
                                count: o.in_review,
                              })}
                            </StatusPill>
                          )}
                        </span>
                        {(o.paused_reason || o.paused_reason_code) && (
                          <p
                            className="mt-1 text-xs text-neutral-500 line-clamp-2 break-words"
                            title={pausedReasonText(t, o)}
                          >
                            {pausedReasonText(t, o)}
                          </p>
                        )}
                        {o.paused_at && stopped && (
                          <p
                            className="text-[11px] text-neutral-400"
                            title={formatDate(o.paused_at, i18n.language, true)}
                          >
                            {formatRelative(o.paused_at, i18n.language)}
                          </p>
                        )}
                      </Td>
                      <Td end className="py-3">
                        {num(o.sent_24h)}
                      </Td>
                      <Td end className="py-3">
                        {num(o.sent_30d)}
                      </Td>
                      <Td end className="py-3">
                        <RatePill
                          rate={o.bounce_rate_7d}
                          threshold={th.bounce_rate}
                          sample={o.sent_30d}
                          minSample={th.min_sample}
                        />
                      </Td>
                      <Td end className="py-3">
                        <RatePill
                          rate={o.complaint_rate_7d}
                          threshold={th.complaint_rate}
                          sample={o.sent_30d}
                          minSample={th.min_sample}
                        />
                      </Td>
                      <Td className="py-3">
                        <span className="block text-[13px] text-neutral-800 tabular-nums">
                          {t('admin.deliverability.warmup_day', {
                            day: o.warmup_day || 0,
                          })}
                        </span>
                        <span className="block text-[11px] text-neutral-400 tabular-nums">
                          {o.daily_cap
                            ? t('admin.deliverability.daily_cap', {
                                count: o.daily_cap,
                                n: num(o.daily_cap),
                              })
                            : t('admin.deliverability.no_cap')}
                        </span>
                      </Td>
                      <Td end className="py-3">
                        {canAct ? (
                          <div className="inline-flex flex-wrap justify-end items-center gap-1.5">
                            {!o.verified && (
                              <Button
                                size="sm"
                                icon={<SealCheck size={13} />}
                                onClick={() =>
                                  setConfirm({ kind: 'verify', org: o })
                                }
                              >
                                {t('admin.deliverability.verify')}
                              </Button>
                            )}
                            {stopped ? (
                              <Button
                                size="sm"
                                icon={<Play size={13} />}
                                onClick={() =>
                                  setConfirm({ kind: 'resume', org: o })
                                }
                              >
                                {t('admin.deliverability.resume')}
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                variant="danger-ghost"
                                icon={<Prohibit size={13} />}
                                onClick={() => setSuspend(o)}
                              >
                                {t('admin.deliverability.suspend')}
                              </Button>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-neutral-400">–</span>
                        )}
                      </Td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <SuspendDialog
        org={suspend}
        open={!!suspend}
        onOpenChange={(o) => !o && setSuspend(null)}
      />
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        tone="info"
        title={
          confirm?.kind === 'verify'
            ? t('admin.deliverability.verify_title', {
                name: confirm?.org.name ?? '',
              })
            : t('admin.deliverability.resume_title', {
                name: confirm?.org.name ?? '',
              })
        }
        message={
          confirm?.kind === 'verify'
            ? t('admin.deliverability.verify_desc')
            : t('admin.deliverability.resume_desc')
        }
        confirmLabel={
          confirm?.kind === 'verify'
            ? t('admin.deliverability.verify')
            : t('admin.deliverability.resume')
        }
        onConfirm={() =>
          confirm
            ? run(confirm.kind, confirm.org).catch(() => undefined)
            : undefined
        }
      />
    </div>
  )
}

// ─── suppressions ────────────────────────────────────────────────────────────

function SuppressionsTab({ canAct }: { canAct: boolean }) {
  const { t, i18n } = useTranslation()
  const token = useAccessToken()
  const me = usePlatformMe()
  const invalidate = useInvalidateDeliverability()
  const [draft, setDraft] = React.useState('')
  const search = useDebounced(draft.trim(), 300)
  // The page belongs to one search: a new search starts back on page 1.
  const [paging, setPaging] = React.useState({ q: '', page: 1 })
  const page = paging.q === search ? paging.page : 1
  const setPage = (p: number) => setPaging({ q: search, page: p })
  const [adding, setAdding] = React.useState(false)
  const [removing, setRemoving] = React.useState<GlobalSuppression | null>(null)

  const filters = { q: search || undefined, page }
  const q = useQuery({
    queryKey: deliverabilityKeys.suppressions(filters),
    queryFn: () => listGlobalSuppressions(token, filters),
    enabled: !!token && me.can('platform.read'),
    retry: shouldRetry,
    placeholderData: (prev) => prev,
  })
  const items = Array.isArray(q.data?.items) ? q.data!.items : []
  const total = q.data?.total ?? items.length

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-2.5 sm:items-center">
        <SearchInput
          className="sm:max-w-md"
          value={draft}
          onChange={setDraft}
          placeholder={t('admin.deliverability.search_suppressions')}
        />
        <div className="flex items-center gap-3 sm:ms-auto">
          {q.data && (
            <span className="text-xs text-neutral-400 tabular-nums">
              {t('admin.deliverability.suppression_count', {
                count: total,
                n: num(total),
              })}
            </span>
          )}
          {canAct && (
            <Button
              variant="primary"
              icon={<Plus size={14} weight="bold" />}
              onClick={() => setAdding(true)}
            >
              {t('admin.deliverability.add_suppression')}
            </Button>
          )}
        </div>
      </div>

      {q.isLoading ? (
        <ListSkeleton rows={4} />
      ) : q.error ? (
        <QueryError error={q.error} onRetry={() => q.refetch()} />
      ) : items.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<ShieldSlash size={22} />}
            title={
              search
                ? t('admin.deliverability.no_suppression_match')
                : t('admin.deliverability.no_suppressions')
            }
            description={
              search
                ? undefined
                : t('admin.deliverability.no_suppressions_desc')
            }
          />
        </Panel>
      ) : (
        <>
          <Panel divided>
            {items.map((s) => (
              <div
                key={s.id}
                className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 px-5 py-3.5"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <IconTile
                    icon={<ShieldSlash size={15} />}
                    tone="rose"
                    size="sm"
                  />
                  <div className="min-w-0">
                    <p
                      className="truncate text-sm font-medium text-neutral-900"
                      dir="ltr"
                    >
                      {s.email}
                    </p>
                    <p className="truncate text-xs text-neutral-500">
                      {s.reason || t('admin.deliverability.no_reason')}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3 ps-10 sm:ps-0">
                  <span
                    className="text-xs text-neutral-400"
                    title={formatDate(s.created_at, i18n.language, true)}
                  >
                    {formatRelative(s.created_at, i18n.language)}
                  </span>
                  {canAct && (
                    <Button
                      size="sm"
                      variant="danger-ghost"
                      icon={<Trash size={13} />}
                      onClick={() => setRemoving(s)}
                    >
                      {t('admin.deliverability.remove')}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </Panel>
          <Pagination
            page={page}
            total={total}
            limit={PAGE_SIZE}
            onPage={setPage}
          />
        </>
      )}

      <AddSuppressionDialog open={adding} onOpenChange={setAdding} />
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={t('admin.deliverability.remove_title')}
        message={t('admin.deliverability.remove_desc', {
          email: removing?.email ?? '',
        })}
        confirmLabel={t('admin.deliverability.remove')}
        onConfirm={async () => {
          if (!removing) return
          try {
            await removeGlobalSuppression(token, removing.id)
            toast.success(t('admin.deliverability.removed_toast'))
            invalidate()
          } catch (err) {
            toast.error(errorMessage(err, t('admin.common.error_desc')))
          }
        }}
      />
    </div>
  )
}

// ─── thresholds ──────────────────────────────────────────────────────────────

function ThresholdsCard({
  thresholds: th,
  loading,
}: {
  thresholds?: DeliverabilityThresholds
  loading: boolean
}) {
  const { t } = useTranslation()
  return (
    <ToneCard
      icon={<Gauge size={18} />}
      tone="amber"
      title={t('admin.deliverability.thresholds')}
      description={t('admin.deliverability.thresholds_desc')}
    >
      {loading || !th ? (
        <Skeleton className="h-32 w-full" />
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <Fact label={t('admin.deliverability.th_bounce')}>
              {pct(th.bounce_rate)}
            </Fact>
            <Fact label={t('admin.deliverability.th_complaint')}>
              {pct(th.complaint_rate, 3)}
            </Fact>
            <Fact label={t('admin.deliverability.th_min_sample')}>
              {t('admin.deliverability.sends', {
                count: th.min_sample,
                n: num(th.min_sample),
              })}
            </Fact>
            <Fact
              label={t('admin.deliverability.th_spike')}
            >{`${th.spike_factor}×`}</Fact>
            <Fact label={t('admin.deliverability.th_review')}>
              {t('admin.deliverability.recipients', {
                count: th.review_threshold,
                n: num(th.review_threshold),
              })}
            </Fact>
            <Fact label={t('admin.deliverability.th_global_rate')}>
              {t('admin.deliverability.per_second', { count: th.global_rate })}
            </Fact>
            <Fact label={t('admin.deliverability.th_org_rate')}>
              {t('admin.deliverability.per_second', { count: th.org_rate })}
            </Fact>
          </div>
          <ul className="space-y-2 rounded-xl bg-neutral-50 px-4 py-3.5">
            {(
              [
                'auto_pause',
                'spike',
                'review',
                'warmup',
                'suppression',
              ] as const
            ).map((k) => (
              <li
                key={k}
                className="flex items-start gap-2 text-sm text-neutral-600"
              >
                <span className="mt-2 w-1 h-1 rounded-full bg-neutral-400 shrink-0" />
                <span>
                  {t(`admin.deliverability.explain.${k}`, {
                    bounce: pct(th.bounce_rate),
                    complaint: pct(th.complaint_rate, 3),
                    sample: num(th.min_sample),
                    spike: th.spike_factor,
                    review: num(th.review_threshold),
                  })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </ToneCard>
  )
}

function Fact({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className="text-lg font-semibold text-neutral-900 tabular-nums">
        {children}
      </p>
    </div>
  )
}

/** "smtp" → "SMTP", "resend" → "Resend": the API sends the provider key. */
function providerLabel(name: string | null | undefined): string {
  const n = (name || '').trim()
  if (!n) return ''
  if (n.length <= 4) return n.toUpperCase()
  return n.charAt(0).toUpperCase() + n.slice(1)
}
