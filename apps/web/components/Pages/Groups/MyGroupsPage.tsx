'use client'
import React from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import {
  ArrowSquareOut,
  CalendarBlank,
  ChartLineUp,
  CheckCircle,
  Megaphone,
  ShieldCheck,
  Ticket,
  UsersThree,
  Warning,
} from '@phosphor-icons/react'
import GeneralWrapperStyled from '@components/Objects/StyledElements/Wrappers/GeneralWrapper'
import { Button, Chip, DashPageHeader, StatCard } from '@components/Dashboard/Shared/DashKit/DashKit'
import { getUriWithOrg } from '@services/config/config'
import { RowSkeleton } from '@components/Dashboard/Pages/Users/usersUi'
import GroupDetailView from '@components/Dashboard/Pages/Users/OrgUserGroups/GroupDetail'
import { useOpenGroup } from '@components/Dashboard/Pages/Users/OrgUserGroups/OrgUserGroups'
import { formatDate, useUG } from '@components/Dashboard/Pages/Users/OrgUserGroups/groupsApi'
import { GroupTile } from '@components/Dashboard/Pages/Users/OrgUserGroups/ugUi'
import { useMyGroups, type MineResponse } from './myGroupsQuery'

type Frame = 'dash' | 'learner'
export type { MineResponse }
export { useMyGroups }

/** "My groups": the groups a person manages (cards with numbers and quick
 *  actions) and the groups they belong to. In the dashboard shell for staff,
 *  in the learner frame for everyone else. */
export default function MyGroupsPage({ frame = 'learner' }: { frame?: Frame }) {
  const { t } = useTranslation()
  const { org } = useUG()
  const [openId, open] = useOpenGroup()
  const { data, isLoading, isError } = useMyGroups()

  const body = openId ? (
    <GroupDetailView id={openId} onBack={() => open(null)} backLabel={t('groups.mine.title')} />
  ) : (
    <MyGroupsBody data={data} loading={isLoading} error={isError} onOpen={open} frame={frame} />
  )

  if (frame === 'dash') {
    return (
      <div className="px-4 sm:px-10 pb-16 flex flex-col gap-6">
        {!openId && (
          <DashPageHeader
            breadcrumbs={[{ label: t('groups.mine.title'), href: getUriWithOrg(org?.slug, '/dash/my-groups') }]}
            title={t('groups.mine.title')}
            subtitle={t('groups.mine.subtitle')}
            atlas={false}
          />
        )}
        <div className={openId ? 'pt-6' : ''}>{body}</div>
      </div>
    )
  }
  return (
    <GeneralWrapperStyled>
      <div className="flex flex-col gap-6 pt-2 pb-12">
        {!openId && (
          <div className="pt-4">
            <h1 className="text-3xl font-bold tracking-tight text-gray-900">{t('groups.mine.title')}</h1>
            {(data?.manages?.length ?? 0) > 0 && <p className="mt-1 text-gray-500">{t('groups.mine.subtitle_learner')}</p>}
          </div>
        )}
        {body}
      </div>
    </GeneralWrapperStyled>
  )
}

function MyGroupsBody({
  data,
  loading,
  error,
  onOpen,
  frame,
}: {
  data?: MineResponse
  loading: boolean
  error: boolean
  onOpen: (_id: number | null, _section?: string, _extra?: Record<string, string>) => void
  frame: Frame
}) {
  const { t } = useTranslation()
  const { org } = useUG()
  if (loading) {
    return (
      <div className="bg-white rounded-2xl nice-shadow">
        <RowSkeleton rows={3} />
      </div>
    )
  }
  const manages = error ? [] : data?.manages ?? []
  const memberOf = error ? [] : (data?.member_of ?? []).filter((g) => !manages.some((m) => m.id === g.id))
  if (!manages.length && !memberOf.length) return <EmptyGroups frame={frame} />

  const withStats = manages.filter((m) => m.stats)
  const sum = (k: string) => withStats.reduce((n, m) => n + (m.stats?.[k] ?? 0), 0)
  const avg = withStats.length ? Math.round(sum('completion_rate') / withStats.length) : null

  return (
    <div className="flex flex-col gap-8">
      {manages.length > 0 && (
        <section className="flex flex-col gap-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard icon={<ShieldCheck size={16} />} iconClass="bg-emerald-50 text-emerald-600" label={t('groups.mine.stats.managed')} value={data?.managed_total ?? manages.length} />
            <StatCard icon={<UsersThree size={16} />} iconClass="bg-sky-50 text-sky-600" label={t('groups.mine.stats.members')} value={withStats.length ? sum('members') : '—'} />
            <StatCard icon={<Warning size={16} />} iconClass="bg-amber-50 text-amber-600" label={t('groups.mine.stats.at_risk')} value={withStats.length ? sum('at_risk') : '—'} />
            <StatCard icon={<CheckCircle size={16} />} iconClass="bg-violet-50 text-violet-600" label={t('groups.mine.stats.completion')} value={avg === null ? '—' : `${avg}%`} />
          </div>
          <h2 className="text-base font-semibold text-neutral-900 mt-2">{t('groups.mine.managed_title')}</h2>
          <ul className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {manages.map((g) => (
              <ManagedCard key={g.id} g={g} messaging={!!data?.features?.messaging} onOpen={onOpen} />
            ))}
          </ul>
        </section>
      )}
      {memberOf.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-base font-semibold text-neutral-900">{t('groups.mine.member_title')}</h2>
          <ul className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {memberOf.map((g) => {
              const inner = (
                <div className="flex items-center gap-3 bg-white rounded-2xl nice-shadow px-4 py-3.5 h-full">
                  <GroupTile color={g.color} kind={g.kind} size={36} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-neutral-900 truncate" dir="auto">
                      {g.name}
                    </span>
                    <span className="block text-xs text-neutral-500">
                      {g.space_enabled ? t('groups.mine.open_space') : t('groups.mine.no_space')}
                    </span>
                  </span>
                  {g.space_enabled && <ArrowSquareOut size={16} className="text-neutral-400 rtl:-scale-x-100" />}
                </div>
              )
              return (
                <li key={g.id}>
                  {g.space_enabled ? (
                    <Link href={getUriWithOrg(org?.slug, `/groups/${String(g.usergroup_uuid).replace('usergroup_', '')}`)} className="block h-full hover:opacity-90">
                      {inner}
                    </Link>
                  ) : (
                    inner
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </div>
  )
}

function ManagedCard({ g, messaging, onOpen }: { g: any; messaging: boolean; onOpen: (_id: number | null, _section?: string, _extra?: Record<string, string>) => void }) {
  const { t, i18n } = useTranslation()
  const s = g.stats
  const nd = s?.next_deadline
  const deadlineText = nd
    ? nd.kind === 'assignment'
      ? t('groups.mine.deadline_assignment', { title: nd.title, date: formatDate(nd.at, i18n.language) })
      : nd.kind === 'access_ends'
        ? t('groups.mine.deadline_access', { title: nd.title, date: formatDate(nd.at, i18n.language) })
        : t('groups.mine.deadline_membership', { date: formatDate(nd.at, i18n.language) })
    : t('groups.mine.no_deadline')
  return (
    <li className="bg-white rounded-2xl nice-shadow p-5 flex flex-col gap-4" data-testid={`my-group-${g.id}`}>
      <button type="button" onClick={() => onOpen(g.id)} className="flex items-start gap-3 text-start min-w-0 group">
        <GroupTile color={g.color} kind={g.kind} size={40} />
        <span className="min-w-0 flex-1">
          <span className="block text-base font-semibold text-neutral-900 truncate group-hover:underline underline-offset-2" dir="auto">
            {g.name}
          </span>
          {g.description && <span className="block text-sm text-neutral-500 truncate" dir="auto">{g.description}</span>}
          <span className="flex flex-wrap gap-1 mt-2">
            {g.rights.members && <Chip tone="sky" className="!py-0.5 !text-[11px]">{t('groups.managers.rights.members')}</Chip>}
            {g.rights.progress && <Chip tone="violet" className="!py-0.5 !text-[11px]">{t('groups.managers.rights.progress')}</Chip>}
            {g.rights.post && <Chip tone="emerald" className="!py-0.5 !text-[11px]">{t('groups.managers.rights.post')}</Chip>}
          </span>
        </span>
      </button>

      {s ? (
        <div className="grid grid-cols-3 gap-3 rounded-xl bg-neutral-50 ring-1 ring-inset ring-neutral-200/60 px-4 py-3">
          <div>
            <p className="text-xs text-neutral-500">{t('groups.progress.members')}</p>
            <p className="text-lg font-bold text-neutral-900 tabular-nums">{s.members}</p>
          </div>
          <div>
            <p className="text-xs text-neutral-500">{t('groups.progress.completion')}</p>
            <p className="text-lg font-bold text-neutral-900 tabular-nums">{s.completion_rate}%</p>
            <span className="mt-1 block h-1.5 rounded-full bg-neutral-200/80 overflow-hidden">
              <span className="block h-full bg-emerald-500 rounded-full" style={{ width: `${s.completion_rate}%` }} />
            </span>
          </div>
          <div>
            <p className="text-xs text-neutral-500">{t('groups.progress.at_risk')}</p>
            <p className={`text-lg font-bold tabular-nums ${s.at_risk ? 'text-amber-600' : 'text-neutral-900'}`}>{s.at_risk}</p>
          </div>
        </div>
      ) : (
        <p className="text-sm text-neutral-500">{t('groups.mine.no_progress_right')}</p>
      )}

      {s && (
        <p className="flex items-start gap-2 text-sm text-neutral-600 min-w-0">
          <CalendarBlank size={16} className="mt-0.5 shrink-0 text-sky-600" />
          <span className="min-w-0 truncate" dir="auto">{deadlineText}</span>
        </p>
      )}

      <div className="flex flex-wrap gap-2 border-t border-neutral-100 -mx-5 px-5 pt-4">
        <Button size="sm" icon={<UsersThree size={13} className="text-sky-600" />} onClick={() => onOpen(g.id, 'members')}>
          {t('groups.tabs.members')}
        </Button>
        {g.rights.progress && (
          <Button size="sm" icon={<ChartLineUp size={13} className="text-violet-600" />} onClick={() => onOpen(g.id, 'progress')}>
            {t('groups.tabs.progress')}
          </Button>
        )}
        {g.rights.post && messaging && (
          <Button size="sm" icon={<Megaphone size={13} className="text-emerald-600" />} onClick={() => onOpen(g.id, 'members', { announce: '1' })}>
            {t('groups.announce.button')}
          </Button>
        )}
      </div>
    </li>
  )
}

function EmptyGroups({ frame }: { frame: Frame }) {
  const { t } = useTranslation()
  const { org } = useUG()
  return (
    <div className="flex flex-col items-center justify-center text-center py-14 px-6 border-2 border-dashed border-neutral-200/80 rounded-2xl bg-white/60">
      <div className="relative mb-5">
        <span className="w-16 h-16 rounded-2xl bg-sky-50 text-sky-600 flex items-center justify-center">
          <UsersThree size={30} weight="duotone" />
        </span>
        <span className="absolute -bottom-2 -end-2 w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 ring-4 ring-white flex items-center justify-center">
          <Ticket size={16} weight="duotone" />
        </span>
      </div>
      <h2 className="text-lg font-bold text-neutral-900">{t('groups.mine.empty')}</h2>
      <p className="mt-1 text-sm text-neutral-500 max-w-sm">{frame === 'dash' ? t('groups.mine.empty_desc') : t('groups.mine.empty_desc_learner')}</p>
      <Link href={getUriWithOrg(org?.slug, '/groups/join')} className="mt-5">
        <Button variant="primary" icon={<Ticket size={14} />}>{t('groups.mine.join_with_code')}</Button>
      </Link>
    </div>
  )
}
