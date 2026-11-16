'use client'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowsClockwise,
  CalendarX,
  ClockCounterClockwise,
  EnvelopeSimple,
  GearSix,
  Key,
  Megaphone,
  ShieldCheck,
  Ticket,
  UserMinus,
  UserPlus,
} from '@phosphor-icons/react'
import { EmptyState, formatRelative } from '@components/Dashboard/Shared/DashKit/DashKit'
import { ListPager, RowSkeleton } from '../../usersUi'
import { personName, ugKeys, useUG, type GroupDetail } from '../groupsApi'

const ICONS: Record<string, { icon: React.ReactNode; tile: string }> = {
  members_added: { icon: <UserPlus size={15} />, tile: 'bg-emerald-50 text-emerald-600' },
  members_imported: { icon: <UserPlus size={15} />, tile: 'bg-sky-50 text-sky-600' },
  members_scheduled: { icon: <UserPlus size={15} />, tile: 'bg-sky-50 text-sky-600' },
  member_joined_with_code: { icon: <Ticket size={15} />, tile: 'bg-emerald-50 text-emerald-600' },
  members_removed: { icon: <UserMinus size={15} />, tile: 'bg-rose-50 text-rose-600' },
  members_moved_out: { icon: <UserMinus size={15} />, tile: 'bg-rose-50 text-rose-600' },
  members_expired: { icon: <CalendarX size={15} />, tile: 'bg-amber-50 text-amber-600' },
  rules_synced: { icon: <ArrowsClockwise size={15} />, tile: 'bg-violet-50 text-violet-600' },
  access_added: { icon: <Key size={15} />, tile: 'bg-sky-50 text-sky-600' },
  access_updated: { icon: <Key size={15} />, tile: 'bg-sky-50 text-sky-600' },
  access_removed: { icon: <Key size={15} />, tile: 'bg-rose-50 text-rose-600' },
  manager_added: { icon: <ShieldCheck size={15} />, tile: 'bg-emerald-50 text-emerald-600' },
  manager_updated: { icon: <ShieldCheck size={15} />, tile: 'bg-emerald-50 text-emerald-600' },
  manager_removed: { icon: <ShieldCheck size={15} />, tile: 'bg-rose-50 text-rose-600' },
  announcement_posted: { icon: <Megaphone size={15} />, tile: 'bg-violet-50 text-violet-600' },
  group_emailed: { icon: <EnvelopeSimple size={15} />, tile: 'bg-violet-50 text-violet-600' },
  code_created: { icon: <Ticket size={15} />, tile: 'bg-emerald-50 text-emerald-600' },
  code_revoked: { icon: <Ticket size={15} />, tile: 'bg-rose-50 text-rose-600' },
}
const KNOWN = new Set([
  ...Object.keys(ICONS),
  'settings_updated', 'member_updated', 'schedule_cancelled', 'code_updated', 'announcement_deleted', 'digest_sent',
])

export default function HistoryTab({ group }: { group: GroupDetail }) {
  const { t, i18n } = useTranslation()
  const { call } = useUG()
  const [page, setPage] = useState(1)
  const { data, isLoading } = useQuery({
    queryKey: ugKeys.history(group.id, page),
    queryFn: () => call<any>('GET', `${group.id}/history?page=${page}`),
    placeholderData: (p) => p,
  })
  const items: any[] = data?.items ?? []
  const names: Record<string, string> = data?.names ?? {}

  const who = (e: any) => (e.actor ? personName(e.actor) : t(`groups.history.via.${e.via || 'system'}`, { defaultValue: t('groups.history.via.system') }))
  const people = (e: any) => {
    const ids: number[] = e.details?.user_ids || e.details?.added || (e.details?.user_id ? [e.details.user_id] : [])
    const shown = ids.slice(0, 3).map((i) => names[String(i)]).filter(Boolean)
    return shown.join(', ')
  }

  return (
    <div className="bg-white rounded-2xl nice-shadow overflow-hidden">
      {isLoading && !data ? (
        <RowSkeleton rows={5} />
      ) : items.length === 0 ? (
        <EmptyState icon={<ClockCounterClockwise size={22} />} title={t('groups.history.empty')} />
      ) : (
        <ol className="divide-y divide-neutral-100">
          {items.map((e) => {
            const meta = ICONS[e.action] ?? { icon: <GearSix size={15} />, tile: 'bg-neutral-100 text-neutral-600' }
            const count = e.details?.count ?? e.details?.added_count ?? (e.details?.user_ids?.length || 0)
            const action = KNOWN.has(e.action) ? e.action : 'other'
            const names_ = people(e)
            return (
              <li key={e.id} className="flex items-start gap-3 px-4 sm:px-5 py-3">
                <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${meta.tile}`}>{meta.icon}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-neutral-800">
                    <span className="font-semibold">{who(e)}</span>{' '}
                    {t(`groups.history.actions.${action}`, {
                      count,
                      added: e.details?.added_count ?? 0,
                      removed: e.details?.removed_count ?? 0,
                      title: e.details?.title ?? '',
                    })}
                  </p>
                  {names_ && <p className="text-xs text-neutral-500 truncate" dir="auto">{names_}</p>}
                </div>
                <time className="text-xs text-neutral-400 whitespace-nowrap shrink-0" dateTime={e.created_at} title={e.created_at}>
                  {formatRelative(e.created_at, i18n.language)}
                </time>
              </li>
            )
          })}
        </ol>
      )}
      <ListPager page={page} total={data?.total ?? 0} pageSize={data?.per_page ?? 30} onPage={setPage} />
    </div>
  )
}
