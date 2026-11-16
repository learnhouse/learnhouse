'use client'
import React from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { CalendarBlank, CaretDown, ClockCountdown, GearSix, Lifebuoy, Robot, Skull, Trash } from '@phosphor-icons/react'
import { Button, DashPage, EmptyState, Panel, SearchInput, Skeleton, StatusPill, SubTabPanel, SubTabs, ToolbarSelect, buttonClass, formatRelative } from '@/design'
import { listDeletions, opsKeys, type PendingDeletion, type Tombstone } from '@services/ee/platform/ops'
import { shouldRetry, useAccessToken, useDebounced, useListKeyboard, usePlatformMe } from '@components/Admin/hooks'
import { AdminHeader, CopyLinkButton, ListSkeleton, NoAccess, QueryError, formatDate } from '@components/Admin/Shared/AdminKit'
import { IconTile, OrgCell, useUrlTab } from '@components/Admin/Shared/OpsKit'
import { AdminEmailChips, Countdown, GuardsList, ReasonList, RequestedBy, ScoreBar, ScorePill, useSignals } from './deletionUi'
import { DeleteNowDialog, KeepDialog, type DeletionTarget } from './DeletionDialogs'

// Guarded org deletion (§11.2): the pending queue (countdown, why, Keep or
// Delete now) and tombstones of orgs already deleted. `?org=<id>` opens that
// org's row (inbox links point here).

const TABS = ['pending', 'deleted'] as const
type Tab = (typeof TABS)[number]
const SINCE = ['all', '7', '30', '90', '365'] as const

export default function DeletionsPage() {
  const { t } = useTranslation()
  const token = useAccessToken()
  const me = usePlatformMe()
  const [tab, setTab, values, setValues] = useUrlTab<Tab>(TABS, 'pending', ['q', 'since'])
  const [draft, setDraft] = React.useState(values.q ?? '')
  const q = useDebounced(draft.trim(), 300)
  React.useEffect(() => {
    if (q !== (values.q ?? '')) setValues({ q: q || undefined }, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])
  const isOwner = me.role === 'owner' || me.legacy

  const query = { status: 'all', q: values.q || undefined, limit: 100 }
  const res = useQuery({
    queryKey: opsKeys.deletions(query),
    queryFn: () => listDeletions(token, query),
    enabled: !!token && me.can('platform.read'),
    retry: shouldRetry,
    placeholderData: (prev) => prev,
  })

  if (!me.isLoading && !me.can('platform.read')) {
    return (
      <DashPage>
        <AdminHeader title={t('admin.deletions.title')} />
        <NoAccess />
      </DashPage>
    )
  }

  const pending = Array.isArray(res.data?.pending) ? res.data!.pending : []
  const deleted = Array.isArray(res.data?.deleted) ? res.data!.deleted : []
  const settings = res.data?.settings
  const limits = settings?.limits ?? {}

  return (
    <DashPage>
      <AdminHeader
        title={t('admin.deletions.title')}
        subtitle={t('admin.deletions.subtitle')}
        actions={
          <>
            <CopyLinkButton label="" />
            {isOwner && (
              <Link href="/admin/settings" className={buttonClass('secondary', 'md')}>
                <GearSix size={14} />
                {t('admin.deletions.settings_link')}
              </Link>
            )}
          </>
        }
      />

      {settings ? (
        <Panel padded className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-5">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <IconTile icon={<Robot size={18} />} tone={settings.auto_delete_effective ? 'rose' : 'neutral'} />
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-neutral-900">
                {t('admin.deletions.auto_delete')}
                <StatusPill status={settings.auto_delete_effective ? 'danger' : 'neutral'} dot>
                  {settings.auto_delete_effective ? t('admin.settings.state_on') : t('admin.settings.state_off')}
                </StatusPill>
              </p>
              <p className="text-xs text-neutral-500">
                {settings.env_kill_switch
                  ? t('admin.deletions.kill_switch_on')
                  : settings.auto_delete_enabled
                    ? t('admin.deletions.auto_on_desc')
                    : t('admin.deletions.auto_off_desc')}
              </p>
            </div>
          </div>
          <div className="text-sm text-neutral-600 tabular-nums">
            {t('admin.deletions.today', { count: res.data?.today ?? 0, max: limits.max_executions_per_day ?? 100 })}
          </div>
        </Panel>
      ) : res.isLoading ? (
        <Skeleton className="h-[74px] w-full rounded-2xl" />
      ) : null}

      <SubTabs
        items={[
          { key: 'pending' as const, label: t('admin.deletions.tab_pending'), icon: <ClockCountdown size={15} className="text-amber-600" />, badge: res.data ? <span className="text-xs tabular-nums text-neutral-400">{pending.length}</span> : undefined },
          { key: 'deleted' as const, label: t('admin.deletions.tab_deleted'), icon: <Skull size={15} className="text-rose-600" />, badge: res.data ? <span className="text-xs tabular-nums text-neutral-400">{deleted.length}</span> : undefined },
        ]}
        value={tab}
        onChange={setTab}
        ariaLabel={t('admin.deletions.title')}
      >
        <div className="flex flex-col sm:flex-row gap-2.5 sm:items-center">
          <SearchInput className="sm:max-w-md" value={draft} onChange={setDraft} placeholder={t('admin.deletions.search')} />
          {tab === 'deleted' && (
            <div className="sm:ms-auto">
              <ToolbarSelect
                ariaLabel={t('admin.deletions.deleted_within')}
                icon={<CalendarBlank size={14} />}
                value={values.since ?? 'all'}
                onChange={(v) => setValues({ since: v === 'all' ? undefined : v })}
                options={SINCE.map((s) => ({ value: s, label: s === 'all' ? t('admin.deletions.any_time') : t('admin.deletions.last_days', { count: Number(s) }) }))}
              />
            </div>
          )}
        </div>
        <SubTabPanel tab="pending" unmountWhenHidden>
          {res.isLoading ? (
            <ListSkeleton rows={3} />
          ) : res.error ? (
            <QueryError error={res.error} onRetry={() => res.refetch()} />
          ) : pending.length === 0 ? (
            <Panel>
              <EmptyState icon={<ClockCountdown size={22} />} title={t('admin.deletions.no_pending')} description={values.q ? t('admin.deletions.no_match') : t('admin.deletions.no_pending_desc')} />
            </Panel>
          ) : (
            <PendingList items={pending} focusOrg={values.org} canKeep={me.can('notes.write')} isOwner={isOwner} />
          )}
        </SubTabPanel>
        <SubTabPanel tab="deleted" unmountWhenHidden>
          {res.isLoading ? (
            <ListSkeleton rows={3} />
          ) : res.error ? (
            <QueryError error={res.error} onRetry={() => res.refetch()} />
          ) : (
            <TombstoneList items={deleted} sinceDays={values.since ? Number(values.since) : null} />
          )}
        </SubTabPanel>
      </SubTabs>
    </DashPage>
  )
}

function PendingList({ items, focusOrg, canKeep, isOwner }: { items: PendingDeletion[]; focusOrg?: string; canKeep: boolean; isOwner: boolean }) {
  const [open, setOpen] = React.useState<number | null>(focusOrg ? Number(focusOrg) : null)
  const [keep, setKeep] = React.useState<DeletionTarget | null>(null)
  const [del, setDel] = React.useState<DeletionTarget | null>(null)
  const kb = useListKeyboard(items, (p) => setOpen((cur) => (cur === p.org_id ? null : p.org_id)))
  React.useEffect(() => {
    if (!focusOrg) return
    setOpen(Number(focusOrg))
    requestAnimationFrame(() => document.getElementById(`deletion-${focusOrg}`)?.scrollIntoView({ block: 'center' }))
  }, [focusOrg])
  return (
    <>
      <Panel divided>
        {items.map((p, i) => (
          <PendingRow
            key={p.org_id}
            item={p}
            rowProps={kb.rowProps(i)}
            highlighted={String(p.org_id) === focusOrg}
            open={open === p.org_id}
            onToggle={() => setOpen((cur) => (cur === p.org_id ? null : p.org_id))}
            onKeep={canKeep ? () => setKeep({ id: p.org_id, name: p.name, slug: p.slug }) : undefined}
            onDelete={isOwner ? () => setDel({ id: p.org_id, name: p.name, slug: p.slug }) : undefined}
          />
        ))}
      </Panel>
      <KeepDialog org={keep} open={!!keep} onOpenChange={(o) => !o && setKeep(null)} />
      <DeleteNowDialog org={del} open={!!del} onOpenChange={(o) => !o && setDel(null)} />
    </>
  )
}

function PendingRow({
  item: p,
  rowProps,
  highlighted,
  open,
  onToggle,
  onKeep,
  onDelete,
}: {
  item: PendingDeletion
  rowProps: Record<string, unknown>
  highlighted: boolean
  open: boolean
  onToggle: () => void
  onKeep?: () => void
  onDelete?: () => void
}) {
  const { t, i18n } = useTranslation()
  const signals = useSignals(p.org_id)
  const s = signals.data
  return (
    <div id={`deletion-${p.org_id}`} {...rowProps} className={`px-5 py-3.5 data-[active=true]:bg-neutral-50 ${highlighted ? 'bg-amber-50/40' : ''}`}>
      <div className="flex flex-col md:flex-row md:items-center gap-3">
        <div className="min-w-0 flex-1">
          <OrgCell org={{ id: p.org_id, name: p.name, slug: p.slug, org_uuid: p.org_uuid, logo_image: p.logo_image, plan: p.plan }} sub={<span dir="ltr">{p.slug}</span>} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Countdown at={p.deletion_scheduled_at} />
          {s ? <ScorePill score={s.test_org_score} /> : signals.isLoading ? <Skeleton className="h-5 w-16 rounded-full" /> : null}
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            aria-label={t('admin.deletions.details')}
            className="h-7 px-2 inline-flex items-center gap-1 rounded-lg text-xs font-semibold text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100"
          >
            {t('admin.deletions.details')}
            <CaretDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>
          {onKeep && (
            <Button size="sm" icon={<Lifebuoy size={13} />} onClick={onKeep}>
              {t('admin.deletions.keep')}
            </Button>
          )}
          {onDelete && (
            <Button size="sm" variant="danger-ghost" icon={<Trash size={13} />} onClick={onDelete}>
              {t('admin.deletions.delete_now')}
            </Button>
          )}
        </div>
      </div>
      <p className="mt-1.5 md:ps-[38px] text-xs text-neutral-500 break-words">
        {p.deletion_reason || t('admin.deletions.no_reason')} · <RequestedBy value={p.deletion_requested_by} /> · {formatRelative(p.deletion_requested_at ?? null, i18n.language) ?? '–'}
      </p>
      {open && (
        <div className="mt-3 md:ps-[38px] grid grid-cols-1 lg:grid-cols-2 gap-4">
          {signals.isLoading ? (
            <Skeleton className="h-20 w-full" />
          ) : s ? (
            <>
              <div className="space-y-2 min-w-0">
                <p className="text-xs font-semibold text-neutral-400">{t('admin.deletions.why_score', { score: s.test_org_score })}</p>
                <ScoreBar score={s.test_org_score} />
                <ReasonList reasons={s.reasons} />
              </div>
              <div className="space-y-2 min-w-0">
                <p className="text-xs font-semibold text-neutral-400">{t('admin.deletions.admins')}</p>
                {(Array.isArray(s.admins) ? s.admins : []).map((a) => (
                  <div key={a.email} className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-neutral-700 truncate" dir="ltr">
                      {a.email}
                    </span>
                    <AdminEmailChips admin={a} />
                  </div>
                ))}
                <GuardsList guards={s.guards} />
                <p className="text-xs text-neutral-400">{t('admin.deletions.scheduled_for', { date: formatDate(p.deletion_scheduled_at, i18n.language, true) })}</p>
              </div>
            </>
          ) : (
            <p className="text-xs text-neutral-400">{t('admin.deletions.signals_unavailable')}</p>
          )}
        </div>
      )}
    </div>
  )
}

function TombstoneList({ items, sinceDays }: { items: Tombstone[]; sinceDays: number | null }) {
  const { t, i18n } = useTranslation()
  const [open, setOpen] = React.useState<number | null>(null)
  const cutoff = sinceDays ? Date.now() - sinceDays * 86_400_000 : null
  const list = cutoff ? items.filter((x) => new Date(x.deleted_at).getTime() >= cutoff) : items
  const kb = useListKeyboard(list, (x) => setOpen((cur) => (cur === x.id ? null : x.id)))
  if (list.length === 0) {
    return (
      <Panel>
        <EmptyState icon={<Skull size={22} />} title={t('admin.deletions.no_deleted')} description={t('admin.deletions.no_deleted_desc')} />
      </Panel>
    )
  }
  return (
    <Panel divided>
      {list.map((x, i) => {
        const emails = Array.isArray(x.admin_emails) ? x.admin_emails : []
        const isOpen = open === x.id
        return (
          <div key={x.id} {...kb.rowProps(i)} className="px-5 py-3.5 data-[active=true]:bg-neutral-50">
            <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-4">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <IconTile icon={<Skull size={15} />} tone="rose" size="sm" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-neutral-900">
                    {x.name} <span className="font-mono text-xs font-normal text-neutral-400">#{x.org_id}</span>
                  </p>
                  <p className="truncate text-xs text-neutral-400" dir="ltr">
                    {x.slug} · {emails.join(', ') || '–'}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500">
                <span className="tabular-nums">{t('admin.deletions.members', { count: x.member_count ?? 0 })}</span>
                <ScorePill score={x.test_org_score} />
                <span title={formatDate(x.deleted_at, i18n.language, true)}>{t('admin.deletions.deleted_ago', { when: formatRelative(x.deleted_at, i18n.language) })}</span>
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : x.id)}
                  aria-expanded={isOpen}
                  className="h-7 px-2 inline-flex items-center gap-1 rounded-lg text-xs font-semibold text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100"
                >
                  {t('admin.deletions.details')}
                  <CaretDown size={12} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                </button>
              </div>
            </div>
            {isOpen && (
              <div className="mt-3 md:ps-10 grid grid-cols-1 lg:grid-cols-2 gap-4 text-xs text-neutral-600">
                <div className="space-y-2">
                  <p className="font-semibold text-neutral-400">{t('admin.deletions.reason')}</p>
                  <p className="break-words">{x.reason || t('admin.deletions.no_reason')}</p>
                  <p>
                    {t('admin.deletions.requested')}: <RequestedBy value={x.requested_by} />
                  </p>
                  <p>
                    {t('admin.deletions.executed')}: <RequestedBy value={x.executed_by} />
                  </p>
                  <p>{t('admin.deletions.org_created', { date: formatDate(x.org_created_at ?? null, i18n.language) })}</p>
                </div>
                <div className="space-y-2">
                  <p className="font-semibold text-neutral-400">{t('admin.deletions.score_reasons')}</p>
                  {typeof x.test_org_score === 'number' && <ScoreBar score={x.test_org_score} />}
                  <ReasonList reasons={x.score_reasons} />
                </div>
              </div>
            )}
          </div>
        )
      })}
    </Panel>
  )
}
