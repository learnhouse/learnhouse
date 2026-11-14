'use client'
import React from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { ArrowClockwise, Buildings, CalendarBlank, CreditCard, Lightning, ListChecks, Plugs, Pulse, Tray, WarningCircle } from '@phosphor-icons/react'
import { Button, EmptyState, Panel, Skeleton, formatRelative, recipes } from '@/design'
import { errorMessage, facetList, listOrgs } from '@services/ee/platform/api'
import { DELIVERY_STATUSES, getDelivery, listDeliveries, listRules, opsKeys, retryDelivery, type Delivery } from '@services/ee/platform/ops'
import { shouldRetry, useAccessToken, useListKeyboard } from '@components/Admin/hooks'
import { ListSkeleton, Pagination, QueryError, adminPath, formatDate } from '@components/Admin/Shared/AdminKit'
import { DetailRows, OrgCell, SideDrawer, useChannelList, useEventCatalog } from '@components/Admin/Shared/OpsKit'
import FilterBar, { filterKeys, resolveDate, type FilterDef } from '@components/Admin/Shared/FilterBar'
import { DeliveryStatusPill, KindIcon } from './channelVisuals'

// The delivery log: every message a rule produced, its status and retries.
// Filters live in the URL; `?delivery=<id>` opens the detail drawer (payload,
// error, retry) so a failed delivery can be shared as a link.

const PAGE_SIZE = 30
const GRID = 'grid grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_6rem_6rem] gap-x-4'

export default function DeliveriesTab({
  values,
  setValues,
}: {
  values: Record<string, string | undefined>
  setValues: (_u: Record<string, string | undefined>, _o?: { replace?: boolean }) => void
}) {
  const { t, i18n } = useTranslation()
  const token = useAccessToken()
  const catalog = useEventCatalog()
  const channels = useChannelList()
  const rulesQ = useQuery({ queryKey: opsKeys.rules(), queryFn: () => listRules(token), enabled: !!token, retry: shouldRetry, staleTime: 60_000 })
  const rules = Array.isArray(rulesQ.data) ? rulesQ.data : []
  const page = Math.max(1, Number(values.page) || 1)
  // Org names seen in the async picker, so the chip shows a name, not an id.
  const [orgNames, setOrgNames] = React.useState<Record<string, string>>({})

  const query = React.useMemo(
    () => ({
      page,
      limit: PAGE_SIZE,
      status: values.status,
      channel: values.channel_uuid,
      rule: values.rule_uuid,
      event: values.event,
      org_id: values.org_id,
      org_plan: values.org_plan,
      since: resolveDate(values.since),
      until: resolveDate(values.until, true),
    }),
    [page, values.status, values.channel_uuid, values.rule_uuid, values.event, values.org_id, values.org_plan, values.since, values.until]
  )
  const q = useQuery({
    queryKey: opsKeys.deliveries(query),
    queryFn: () => listDeliveries(token, query),
    enabled: !!token,
    retry: shouldRetry,
    placeholderData: (prev) => prev,
  })
  const items: Delivery[] = Array.isArray(q.data?.items) ? q.data!.items : []
  const total = q.data?.total ?? 0
  const statusCounts = facetList(q.data?.facets?.status)

  const defs: FilterDef[] = [
    {
      key: 'status',
      kind: 'select',
      label: t('admin.notifications.deliveries.status'),
      icon: <Pulse size={14} />,
      options: DELIVERY_STATUSES.map((s) => ({ value: s, label: t(`admin.notifications.status.${s}`), count: statusCounts.find((f) => f.value === s)?.count })),
    },
    {
      key: 'channel_uuid',
      kind: 'select',
      label: t('admin.notifications.deliveries.channel'),
      icon: <Plugs size={14} />,
      options: channels.channels.map((c) => ({ value: c.channel_uuid, label: c.name })),
    },
    {
      key: 'rule_uuid',
      kind: 'select',
      label: t('admin.notifications.deliveries.rule'),
      icon: <ListChecks size={14} />,
      options: rules.map((r) => ({ value: r.rule_uuid, label: r.name })),
    },
    { key: 'event', kind: 'text', label: t('admin.notifications.deliveries.event'), icon: <Lightning size={14} />, placeholder: 'poc.*' },
    {
      key: 'org_id',
      kind: 'async',
      label: t('admin.notifications.deliveries.org'),
      icon: <Buildings size={14} />,
      placeholder: t('admin.notifications.deliveries.org_search'),
      load: async (text: string) => {
        const res = await listOrgs(token, { q: text, limit: 10, page: 1 })
        const opts = (Array.isArray(res?.items) ? res.items : []).map((o) => ({ value: String(o.id), label: o.name }))
        setOrgNames((prev) => ({ ...prev, ...Object.fromEntries(opts.map((o) => [o.value, o.label])) }))
        return opts
      },
      describe: (v: string) => orgNames[v] ?? `#${v}`,
    },
    {
      key: 'org_plan',
      kind: 'select',
      label: t('admin.notifications.deliveries.org_plan'),
      icon: <CreditCard size={14} />,
      options: ['free', 'paid', 'standard', 'pro', 'enterprise'].map((p) => ({ value: p, label: p === 'paid' ? t('admin.users.paid_plans') : t(`admin.plans.${p}`) })),
    },
    { key: 'date', kind: 'date', label: t('admin.notifications.deliveries.date'), icon: <CalendarBlank size={14} />, sinceKey: 'since', untilKey: 'until' },
  ]
  const filtered = filterKeys(defs).some((k) => !!values[k])
  const openRow = (d: Delivery) => setValues({ delivery: String(d.id) })
  const kb = useListKeyboard(items, openRow)

  return (
    <div className="space-y-4">
      <FilterBar values={values} onChange={setValues} defs={defs} savedViewsKey="lh:admin:views:deliveries" />

      {q.isLoading ? (
        <ListSkeleton rows={6} />
      ) : q.error ? (
        <QueryError error={q.error} onRetry={() => q.refetch()} />
      ) : items.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<Tray size={22} />}
            title={t('admin.notifications.deliveries.empty_title')}
            description={filtered ? t('admin.notifications.deliveries.no_match') : t('admin.notifications.deliveries.empty_desc')}
            action={
              filtered ? (
                <Button
                  size="sm"
                  onClick={() => {
                    const u: Record<string, undefined> = { page: undefined }
                    for (const k of filterKeys(defs)) u[k] = undefined
                    setValues(u)
                  }}
                >
                  {t('admin.users.clear_filters')}
                </Button>
              ) : (
                <Button size="sm" variant="primary" onClick={() => setValues({ tab: 'rules', rule: 'new' })}>
                  {t('admin.notifications.rules.add')}
                </Button>
              )
            }
          />
        </Panel>
      ) : (
        <>
          <Panel divided className={q.isFetching ? 'opacity-70 transition-opacity' : 'transition-opacity'}>
            <div className={`${recipes.tableHead} hidden md:grid ${GRID}`}>
              <span>{t('admin.notifications.deliveries.event')}</span>
              <span>{t('admin.notifications.deliveries.org')}</span>
              <span>{t('admin.notifications.deliveries.channel')}</span>
              <span>{t('admin.notifications.deliveries.status')}</span>
              <span className="text-end">{t('admin.notifications.deliveries.when')}</span>
            </div>
            {items.map((d, i) => (
              <div
                key={d.id}
                {...kb.rowProps(i)}
                onClick={() => openRow(d)}
                className={`${GRID} items-center gap-y-1.5 px-5 py-3 cursor-pointer hover:bg-neutral-50 data-[active=true]:bg-neutral-50`}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-neutral-900">{catalog.label(d.event_key)}</p>
                  <p className="truncate text-xs text-neutral-400">
                    {d.rule_name || t('admin.notifications.deliveries.no_rule')}
                    {(d.attempts ?? 0) > 1 && ` · ${t('admin.notifications.deliveries.attempts', { count: d.attempts ?? 0 })}`}
                  </p>
                </div>
                <div className="hidden md:block min-w-0">
                  <OrgCell id={d.org_id} name={d.org_name} />
                </div>
                <div className="hidden md:flex items-center gap-2 min-w-0">
                  <KindIcon kind={d.channel_kind || (d.recipient_user_id ? 'inbox' : null)} size="sm" />
                  <span className="truncate text-xs text-neutral-600">{d.channel_name || t('admin.notifications.deliveries.inbox')}</span>
                </div>
                <span className="flex justify-end md:justify-start">
                  <DeliveryStatusPill status={d.status} />
                </span>
                <span className="col-span-2 md:col-span-1 text-xs text-neutral-400 md:text-end" title={formatDate(d.created_at, i18n.language, true)}>
                  {formatRelative(d.created_at, i18n.language)}
                  {d.org_name && <span className="md:hidden"> · {d.org_name}</span>}
                </span>
              </div>
            ))}
          </Panel>
          <Pagination page={page} total={total} limit={PAGE_SIZE} onPage={(p) => setValues({ page: p === 1 ? undefined : String(p) })} />
        </>
      )}

      <DeliveryDrawer id={values.delivery ?? null} fallback={items.find((d) => String(d.id) === values.delivery) ?? null} onClose={() => setValues({ delivery: undefined })} />
    </div>
  )
}

function DeliveryDrawer({ id, fallback, onClose }: { id: string | null; fallback: Delivery | null; onClose: () => void }) {
  const { t, i18n } = useTranslation()
  const token = useAccessToken()
  const queryClient = useQueryClient()
  const catalog = useEventCatalog()
  const [retrying, setRetrying] = React.useState(false)
  const q = useQuery({
    queryKey: opsKeys.delivery(id ?? ''),
    queryFn: () => getDelivery(token, id!),
    enabled: !!token && !!id,
    retry: false,
  })
  const d: Delivery | null = q.data ? { ...(fallback ?? {}), ...q.data } : fallback

  const retry = async () => {
    if (!d) return
    setRetrying(true)
    try {
      await retryDelivery(token, d.id)
      toast.success(t('admin.notifications.deliveries.retry_queued'))
      queryClient.invalidateQueries({ queryKey: opsKeys.deliveries() })
      queryClient.invalidateQueries({ queryKey: opsKeys.delivery(d.id) })
    } catch (err) {
      toast.error(errorMessage(err, t('admin.common.error_desc')))
    } finally {
      setRetrying(false)
    }
  }
  const canRetry = d && (d.status === 'failed' || d.status === 'skipped')

  return (
    <SideDrawer
      open={!!id}
      onClose={onClose}
      icon={<KindIcon kind={d?.channel_kind || (d?.recipient_user_id ? 'inbox' : null)} size="lg" />}
      title={d ? catalog.label(d.event_key) : t('admin.notifications.deliveries.title', { id: id ?? '' })}
      subtitle={
        d ? (
          <>
            <DeliveryStatusPill status={d.status} />
            <span>#{d.id}</span>
            <span>{formatRelative(d.created_at, i18n.language)}</span>
          </>
        ) : undefined
      }
      footer={
        canRetry ? (
          <Button variant="primary" icon={<ArrowClockwise size={13} />} onClick={retry} loading={retrying}>
            {t('admin.notifications.deliveries.retry')}
          </Button>
        ) : undefined
      }
    >
      {!d && q.isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-4 w-64" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : !d ? (
        q.error ? <QueryError error={q.error} compact /> : <p className="text-sm text-neutral-500">{t('admin.notifications.deliveries.not_found')}</p>
      ) : (
        <>
          {d.error && (
            <p className="flex items-start gap-2 rounded-xl bg-rose-50 px-3 py-2.5 text-sm text-rose-700">
              <WarningCircle size={16} weight="fill" className="mt-0.5 shrink-0" />
              <span className="min-w-0 break-words">{d.error}</span>
            </p>
          )}
          <DetailRows
            rows={[
              { label: t('admin.notifications.deliveries.event'), value: <code dir="ltr" className="font-mono text-xs">{d.event_key}</code> },
              {
                label: t('admin.notifications.deliveries.rule'),
                value: d.rule_uuid ? (
                  <Link href={`/admin/notifications?tab=rules&rule=${d.rule_uuid}`} className="hover:underline underline-offset-2">
                    {d.rule_name || d.rule_uuid}
                  </Link>
                ) : (
                  t('admin.notifications.deliveries.no_rule')
                ),
              },
              {
                label: t('admin.notifications.deliveries.channel'),
                value: d.channel_uuid ? (
                  <Link href={`/admin/notifications?tab=channels&channel=${d.channel_uuid}`} className="hover:underline underline-offset-2">
                    {d.channel_name || d.channel_uuid}
                  </Link>
                ) : d.recipient_user_id ? (
                  <Link href={adminPath.user(d.recipient_user_id)} className="hover:underline underline-offset-2">
                    {t('admin.notifications.deliveries.inbox_of', { id: d.recipient_user_id })}
                  </Link>
                ) : (
                  t('admin.notifications.deliveries.inbox')
                ),
              },
              { label: t('admin.notifications.deliveries.org'), value: <OrgCell id={d.org_id} name={d.org_name} />, hidden: !d.org_id },
              { label: t('admin.notifications.deliveries.attempts_label'), value: <span className="tabular-nums">{d.attempts ?? 0}</span> },
              { label: t('admin.notifications.deliveries.created'), value: formatDate(d.created_at, i18n.language, true) },
              { label: t('admin.notifications.deliveries.sent'), value: formatDate(d.sent_at, i18n.language, true), hidden: !d.sent_at },
              { label: t('admin.notifications.deliveries.next_attempt'), value: formatDate(d.next_attempt_at, i18n.language, true), hidden: !d.next_attempt_at },
            ]}
          />
          {d.payload && (
            <section className="space-y-2">
              <h3 className="text-xs font-semibold text-neutral-500">{t('admin.notifications.deliveries.payload')}</h3>
              <pre dir="ltr" className="max-h-96 overflow-auto rounded-xl bg-neutral-100 p-3 font-mono text-[11px] leading-relaxed text-neutral-700 whitespace-pre-wrap break-all">
                {JSON.stringify(d.payload, null, 2)}
              </pre>
            </section>
          )}
        </>
      )}
    </SideDrawer>
  )
}
