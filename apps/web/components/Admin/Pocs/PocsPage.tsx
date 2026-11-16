'use client'
import React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { ArrowCounterClockwise, CalendarBlank, CalendarX, CreditCard, Flag, Handshake, Hourglass, Plus, Target, Timer, Trophy, UserCircle, XCircle } from '@phosphor-icons/react'
import { Button, DashPage, EmptyState, Panel, Skeleton, StatCard, recipes } from '@/design'
import { saRequest } from '@services/ee/platform/api'
import { platformKeys } from '@services/ee/platform/keys'
import type { PocOrg } from '@services/ee/platform/types'
import { useAccessToken, useListKeyboard, usePlatformMe, useUrlQuery, shouldRetry } from '@components/Admin/hooks'
import FilterBar, { filterKeys, resolveDate, type FilterDef, type FilterValues } from '@components/Admin/Shared/FilterBar'
import { useTeamMembers } from '@components/Admin/OrgDetail/orgQueries'
import { AdminHeader, Avatar, CopyLinkButton, NoAccess, OrgLogo, PlanChip, QueryError, adminPath, daysUntil, formatDate } from '@components/Admin/Shared/AdminKit'
import { ENDING_WINDOW_DAYS, PocDaysLeft, PocOutcomeChip, PocProgress } from './pocUi'
import { PocActionButtons, PocActionDialog, type PocActionKind } from './PocActions'
import StartPocDialog from './StartPocDialog'

// POC pipeline: what is running, what ends this week, and how past POCs
// ended. Grouped client-side from GET /pocs?status=all.

type Column = 'active' | 'ending' | 'ended'
const PLAN_KEYS = ['free', 'standard', 'pro', 'enterprise'] as const

function ownerId(p: PocOrg): number | undefined {
  return (p as { account_owner_user_id?: number | null }).account_owner_user_id ?? p.account_owner?.user_id ?? p.account_owner?.id ?? undefined
}

/**
 * Applies the URL filters in the browser too: the server may not know every
 * parameter yet, and applying them twice is harmless.
 */
function matches(p: PocOrg, f: FilterValues): boolean {
  if (f.q) {
    const hay = `${p.name} ${p.slug} ${p.poc_contact_name ?? ''} ${p.poc_contact_email ?? ''} ${p.poc_goal ?? ''}`.toLowerCase()
    if (!hay.includes(f.q.toLowerCase())) return false
  }
  if (f.status && pocColumn(p) !== f.status) return false
  if (f.outcome && p.poc_outcome !== f.outcome) return false
  if (f.plan && !f.plan.split(',').includes(String(p.poc_plan ?? p.plan ?? ''))) return false
  if (f.previous_plan && !f.previous_plan.split(',').includes(String(p.poc_previous_plan ?? 'free'))) return false
  if (f.owner && String(ownerId(p) ?? '') !== f.owner) return false
  if (f.ending_within) {
    const left = daysUntil(p.poc_ends_at)
    if (p.lifecycle !== 'poc' || left === null || left > Number(f.ending_within)) return false
  }
  const since = resolveDate(f.started_since)
  const until = resolveDate(f.started_until, true)
  if (since || until) {
    if (!p.poc_started_at) return false
    const t = new Date(p.poc_started_at).getTime()
    if (since && t < new Date(since).getTime()) return false
    if (until && t > new Date(until).getTime()) return false
  }
  const endedSince = resolveDate(f.ended_since)
  const endedUntil = resolveDate(f.ended_until, true)
  if (endedSince || endedUntil) {
    const when = pocColumn(p) === 'ended' ? p.poc_ended_at || p.closed_at || p.poc_ends_at : null
    if (!when) return false
    const t = new Date(when).getTime()
    if (endedSince && t < new Date(endedSince).getTime()) return false
    if (endedUntil && t > new Date(endedUntil).getTime()) return false
  }
  return true
}

export function pocColumn(p: PocOrg): Column {
  if (p.lifecycle !== 'poc' || p.poc_outcome) return 'ended'
  const left = daysUntil(p.poc_ends_at)
  return left !== null && left <= ENDING_WINDOW_DAYS ? 'ending' : 'active'
}

// Kept for older imports; the chips live in ./pocUi now.
export { PocDaysLeft, PocOutcomeChip }

function PocCard({
  poc,
  canManage,
  onAction,
  rowProps,
}: {
  poc: PocOrg
  canManage: boolean
  onAction: (_k: PocActionKind, _p: PocOrg) => void
  rowProps: Record<string, unknown>
}) {
  const { t, i18n } = useTranslation()
  const ended = pocColumn(poc) === 'ended'
  const won = poc.poc_outcome === 'won'
  const endedAt = poc.poc_ended_at || poc.closed_at || (poc.poc_ends_at && new Date(poc.poc_ends_at).getTime() <= Date.now() ? poc.poc_ends_at : null)
  const owner = poc.account_owner
  const ownerUserId = ownerId(poc)
  return (
    <article
      {...rowProps}
      className="group bg-white rounded-2xl nice-shadow p-4 flex flex-col gap-3 min-w-0 transition-shadow data-[active=true]:ring-2 data-[active=true]:ring-neutral-300"
    >
      <div className="flex items-start gap-3 min-w-0">
        <Link href={adminPath.org(poc.id, 'poc')} tabIndex={-1} aria-hidden="true">
          <OrgLogo org={poc} size={32} />
        </Link>
        <div className="min-w-0 flex-1">
          <Link href={adminPath.org(poc.id, 'poc')} className="block text-sm font-semibold text-neutral-900 truncate hover:underline underline-offset-2">
            {poc.name}
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <PlanChip plan={poc.poc_plan || poc.plan} />
            {ended && <PocOutcomeChip outcome={poc.poc_outcome || (poc.lifecycle === 'closed' ? 'expired' : null)} />}
          </div>
        </div>
      </div>
      {!ended && <PocProgress startedAt={poc.poc_started_at} endsAt={poc.poc_ends_at} />}
      {poc.poc_goal && (
        <p className="text-xs text-neutral-600 line-clamp-2 flex gap-1.5">
          <Target size={13} className="mt-px shrink-0 text-neutral-400" />
          <span className="min-w-0">{poc.poc_goal}</span>
        </p>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-neutral-400">
        {ended && poc.poc_started_at && <span>{t('admin.pocs.started_on', { date: formatDate(poc.poc_started_at, i18n.language) })}</span>}
        {ended && won && (
          <span>
            {poc.poc_ended_at ? t('admin.pocs.converted_on', { date: formatDate(poc.poc_ended_at, i18n.language) }) : t('admin.pocs.converted_label')}
          </span>
        )}
        {/* Won POCs have no closed_at; the planned end date would read as a future close. */}
        {ended && !won && endedAt && <span>{t('admin.pocs.closed_on', { date: formatDate(endedAt, i18n.language) })}</span>}
        {!!poc.poc_extensions && <span>{t('admin.pocs.extensions', { count: poc.poc_extensions })}</span>}
        {poc.poc_previous_plan && !won && (
          <span>{t('admin.pocs.restores', { plan: t(`admin.plans.${poc.poc_previous_plan}`, { defaultValue: poc.poc_previous_plan }) })}</span>
        )}
        {(poc.poc_contact_name || poc.poc_contact_email) && <span className="truncate">{poc.poc_contact_name || poc.poc_contact_email}</span>}
      </div>
      {ended && poc.closed_reason && <p className="text-xs text-neutral-500 italic line-clamp-2">{poc.closed_reason}</p>}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-neutral-100">
        {owner && ownerUserId ? (
          <Link href={adminPath.user(ownerUserId)} className="flex items-center gap-1.5 min-w-0 hover:underline underline-offset-2" title={t('admin.pocs.owner')}>
            <Avatar user={owner} size={20} />
            <span className="text-xs text-neutral-600 truncate">{owner.username}</span>
          </Link>
        ) : (
          <span className="text-xs text-neutral-400">{t('admin.pocs.no_owner')}</span>
        )}
        {canManage && <PocActionButtons org={poc} onAction={(k) => onAction(k, poc)} />}
      </div>
    </article>
  )
}

const COLUMN_DOT: Record<Column, string> = { active: 'bg-violet-500', ending: 'bg-amber-500', ended: 'bg-neutral-400' }

export default function PocsPage() {
  const { t } = useTranslation()
  const token = useAccessToken()
  const me = usePlatformMe()
  const canManage = me.can('pocs.manage')
  const [url, setUrl] = useUrlQuery()
  const [startOpen, setStartOpen] = React.useState(false)
  const [action, setAction] = React.useState<{ kind: PocActionKind; poc: PocOrg } | null>(null)

  const router = useRouter()
  const team = useTeamMembers(me.can('platform.read'))
  const f: FilterValues = {
    q: url.q,
    status: url.status,
    outcome: url.outcome,
    plan: url.plan,
    previous_plan: url.previous_plan,
    owner: url.owner,
    ending_within: url.ending_within,
    started_since: url.started_since,
    started_until: url.started_until,
    ended_since: url.ended_since,
    ended_until: url.ended_until,
  }
  const serverQuery = {
    status: f.status || 'all',
    q: f.q,
    outcome: f.outcome,
    plan: f.plan,
    previous_plan: f.previous_plan,
    account_owner_user_id: f.owner,
    // §10.1 name, plus the earlier draft name.
    ends_within_days: f.ending_within,
    ending_within_days: f.ending_within,
    ended_since: resolveDate(f.ended_since),
    ended_until: resolveDate(f.ended_until, true),
    started_since: resolveDate(f.started_since),
    started_until: resolveDate(f.started_until, true),
  }
  const q = useQuery({
    queryKey: [...platformKeys.pocs(f.status || 'all'), serverQuery],
    queryFn: () => saRequest<PocOrg[]>('/pocs', token, { query: serverQuery }),
    enabled: !!token && me.can('platform.read'),
    retry: shouldRetry,
    placeholderData: (prev) => prev,
  })

  const all = React.useMemo(() => (Array.isArray(q.data) ? q.data : []), [q.data])
  const fKey = JSON.stringify(f)
  const filtered = React.useMemo(() => all.filter((p) => matches(p, JSON.parse(fKey) as FilterValues)), [all, fKey])
  const columns = React.useMemo(() => {
    const c: Record<Column, PocOrg[]> = { active: [], ending: [], ended: [] }
    for (const p of filtered) c[pocColumn(p)].push(p)
    const ends = (p: PocOrg) => new Date(p.poc_ends_at || 0).getTime()
    c.active.sort((a, b) => ends(a) - ends(b))
    c.ending.sort((a, b) => ends(a) - ends(b))
    c.ended.sort((a, b) => new Date(b.closed_at || b.poc_ends_at || 0).getTime() - new Date(a.closed_at || a.poc_ends_at || 0).getTime())
    return c
  }, [filtered])
  // j/k walks the cards column by column; Enter opens the org's POC tab.
  const ordered = React.useMemo(() => [...columns.active, ...columns.ending, ...columns.ended], [columns])
  const kb = useListKeyboard(ordered, (p) => router.push(adminPath.org(p.id, 'poc')))
  const counts = React.useMemo(() => {
    const won = filtered.filter((p) => p.poc_outcome === 'won').length
    const lostOrExpired = filtered.filter((p) => p.poc_outcome === 'lost' || p.poc_outcome === 'expired').length
    return {
      active: filtered.filter((p) => pocColumn(p) !== 'ended').length,
      ending: filtered.filter((p) => pocColumn(p) === 'ending').length,
      won,
      lost: lostOrExpired,
    }
  }, [filtered])

  if (!me.isLoading && !me.can('platform.read')) {
    return (
      <DashPage>
        <AdminHeader title={t('admin.pocs.title')} />
        <NoAccess />
      </DashPage>
    )
  }

  const ALL_COLS: { key: Column; label: string; hint: string }[] = [
    { key: 'active', label: t('admin.pocs.col_active'), hint: t('admin.pocs.col_active_hint') },
    { key: 'ending', label: t('admin.pocs.col_ending'), hint: t('admin.pocs.col_ending_hint') },
    { key: 'ended', label: t('admin.pocs.col_ended'), hint: t('admin.pocs.col_ended_hint') },
  ]
  // A status filter narrows the board to that column.
  const COLS = f.status ? ALL_COLS.filter((c) => c.key === f.status) : ALL_COLS
  const members = Array.isArray(team.data?.members) ? team.data!.members : []
  const defs: FilterDef[] = [
    {
      key: 'status',
      kind: 'select',
      label: t('admin.pocs.f_status'),
      icon: <Flag size={14} />,
      options: ALL_COLS.map((c) => ({ value: c.key, label: c.label })),
    },
    {
      key: 'outcome',
      kind: 'select',
      label: t('admin.pocs.outcome'),
      icon: <Trophy size={14} />,
      options: (['won', 'lost', 'expired'] as const).map((o) => ({ value: o, label: t(`admin.pocs.outcome_${o}`) })),
    },
    {
      key: 'plan',
      kind: 'select',
      label: t('admin.pocs.f_poc_plan'),
      icon: <CreditCard size={14} />,
      options: PLAN_KEYS.filter((p) => p !== 'free').map((p) => ({ value: p, label: t(`admin.plans.${p}`) })),
    },
    {
      key: 'previous_plan',
      kind: 'select',
      label: t('admin.pocs.f_previous_plan'),
      icon: <ArrowCounterClockwise size={14} />,
      options: PLAN_KEYS.map((p) => ({ value: p, label: t(`admin.plans.${p}`) })),
    },
    {
      key: 'owner',
      kind: 'select',
      label: t('admin.pocs.owner'),
      icon: <UserCircle size={14} />,
      hidden: members.length === 0 && !f.owner,
      options: members.map((m) => ({ value: String(m.user_id), label: m.username })),
    },
    { key: 'ending_within', kind: 'number', label: t('admin.pocs.f_ending_within'), icon: <Timer size={14} />, suffix: t('admin.pocs.f_days_suffix'), min: 0, max: 365 },
    { key: 'started', kind: 'date', sinceKey: 'started_since', untilKey: 'started_until', label: t('admin.pocs.f_started'), icon: <CalendarBlank size={14} /> },
    { key: 'ended', kind: 'date', sinceKey: 'ended_since', untilKey: 'ended_until', label: t('admin.pocs.f_ended'), icon: <CalendarX size={14} /> },
  ]
  const anyFilter = Object.values(f).some(Boolean)
  const clearFilters = () => {
    const u: FilterValues = { q: undefined }
    for (const k of filterKeys(defs)) u[k] = undefined
    setUrl(u)
  }

  return (
    <DashPage bottom="lg">
      <AdminHeader
        title={t('admin.pocs.title')}
        subtitle={t('admin.pocs.subtitle')}
        actions={
          canManage ? (
            <Button variant="primary" icon={<Plus size={14} weight="bold" />} onClick={() => setStartOpen(true)}>
              {t('admin.pocs.start')}
            </Button>
          ) : undefined
        }
      />

      <div className={recipes.statGrid}>
        <StatCard icon={<Handshake size={18} />} iconClass="bg-violet-50 text-violet-600" label={t('admin.pocs.stat_running')} value={q.isLoading ? null : counts.active} />
        <StatCard icon={<Hourglass size={18} />} iconClass="bg-amber-50 text-amber-600" label={t('admin.pocs.stat_ending')} value={q.isLoading ? null : counts.ending} />
        <StatCard icon={<Trophy size={18} />} iconClass="bg-emerald-50 text-emerald-600" label={t('admin.pocs.stat_won')} value={q.isLoading ? null : counts.won} />
        <StatCard icon={<XCircle size={18} />} iconClass="bg-rose-50 text-rose-600" label={t('admin.pocs.stat_lost')} value={q.isLoading ? null : counts.lost} />
      </div>

      {q.error ? (
        <QueryError error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <>
          <FilterBar values={url} onChange={setUrl} defs={defs} search={{ key: 'q', placeholder: t('admin.pocs.search') }} savedViewsKey="lh:admin:views:pocs" end={<CopyLinkButton size="sm" />} />

          {!q.isLoading && all.length === 0 && !anyFilter ? (
            <Panel>
              <EmptyState
                icon={<Handshake size={22} />}
                title={t('admin.pocs.empty_title')}
                description={t('admin.pocs.empty_desc')}
                action={
                  canManage ? (
                    <Button variant="primary" icon={<Plus size={14} weight="bold" />} onClick={() => setStartOpen(true)}>
                      {t('admin.pocs.start')}
                    </Button>
                  ) : undefined
                }
              />
            </Panel>
          ) : !q.isLoading && anyFilter && filtered.length === 0 ? (
            <Panel>
              <EmptyState
                icon={<Handshake size={22} />}
                title={t('admin.pocs.no_match_title')}
                description={t('admin.pocs.no_match_desc')}
                action={
                  <Button size="sm" onClick={clearFilters}>
                    {t('admin.org.clear_filters')}
                  </Button>
                }
              />
            </Panel>
          ) : (
            <div className={`grid grid-cols-1 gap-5 items-start ${COLS.length === 3 ? 'lg:grid-cols-3' : ''}`}>
              {COLS.map((col) => (
                <section key={col.key} aria-label={col.label} className="flex flex-col gap-3 min-w-0">
                  <div className="px-1">
                    <div className="flex items-center justify-between gap-2">
                      <h2 className="flex items-center gap-2 text-sm font-semibold text-neutral-900">
                        <span className={`h-2 w-2 rounded-full ${COLUMN_DOT[col.key]}`} aria-hidden="true" />
                        {col.label}
                      </h2>
                      <span className="text-xs font-semibold tabular-nums text-neutral-400">{q.isLoading ? '' : columns[col.key].length}</span>
                    </div>
                    <p className="mt-0.5 text-xs text-neutral-500">{col.hint}</p>
                  </div>
                  {q.isLoading ? (
                    Array.from({ length: 2 }).map((_, i) => (
                      <div key={i} className="bg-white rounded-2xl nice-shadow p-4 space-y-2">
                        <Skeleton className="h-4 w-32" />
                        <Skeleton className="h-3 w-24" />
                      </div>
                    ))
                  ) : columns[col.key].length === 0 ? (
                    <p className="rounded-2xl border border-dashed border-neutral-200 px-3 py-8 text-center text-xs text-neutral-400">
                      {anyFilter ? t('admin.pocs.col_no_match') : t('admin.pocs.col_empty')}
                    </p>
                  ) : (
                    columns[col.key].map((p) => (
                      <PocCard
                        key={p.id}
                        poc={p}
                        canManage={canManage}
                        onAction={(kind, poc) => setAction({ kind, poc })}
                        rowProps={kb.rowProps(ordered.indexOf(p))}
                      />
                    ))
                  )}
                </section>
              ))}
            </div>
          )}
        </>
      )}

      <StartPocDialog open={startOpen} onOpenChange={setStartOpen} />
      <PocActionDialog kind={action?.kind ?? null} org={action?.poc ?? null} onClose={() => setAction(null)} />
    </DashPage>
  )
}
