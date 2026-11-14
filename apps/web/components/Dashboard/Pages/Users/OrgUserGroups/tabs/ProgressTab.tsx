'use client'
import React, { useState } from 'react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { ChartBar, CheckCircle, DownloadSimple, EnvelopeSimple, Pulse, UsersThree, Warning } from '@phosphor-icons/react'
import { Button, Chip, EmptyState, SectionCard, StatCard } from '@components/Dashboard/Shared/DashKit/DashKit'
import { getAPIUrl } from '@services/config/config'
import { PersonCell, RowSkeleton } from '../../usersUi'
import { formatDate, ugKeys, useUG, type GroupDetail } from '../groupsApi'

export default function ProgressTab({ group }: { group: GroupDetail }) {
  const { t, i18n } = useTranslation()
  const { call, orgId, token } = useUG()
  const [sending, setSending] = useState(false)
  const { data, isLoading } = useQuery({ queryKey: ugKeys.progress(group.id), queryFn: () => call<any>('GET', `${group.id}/progress`) })

  const exportCsv = async () => {
    try {
      const res = await fetch(`${getAPIUrl()}usergroups/${group.id}/progress.csv?org_id=${orgId}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: 'include',
      })
      if (!res.ok) throw new Error(res.statusText)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = (res.headers.get('content-disposition') || '').match(/filename="([^"]+)"/)?.[1] || 'progress.csv'
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error(t('groups.errors.generic'))
    }
  }
  const digest = async () => {
    setSending(true)
    try {
      const out = await call<any>('POST', `${group.id}/digest`)
      toast.success(t('groups.progress.digest_sent', { count: out.sent ?? 0 }))
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSending(false)
    }
  }

  if (isLoading || !data) return <div className="bg-white rounded-2xl nice-shadow"><RowSkeleton rows={5} /></div>
  const s = data.summary
  const maxActive = Math.max(1, ...data.activity.map((a: any) => a.active))

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {group.features.messaging && group.managers.some((m) => m.digest) && (
          <Button icon={<EnvelopeSimple size={14} className="text-violet-600" />} loading={sending} onClick={digest}>
            {t('groups.progress.send_digest')}
          </Button>
        )}
        <Button icon={<DownloadSimple size={14} className="text-emerald-600" />} onClick={exportCsv} data-testid="export-csv">
          {t('groups.progress.export')}
        </Button>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard icon={<UsersThree size={16} />} iconClass="bg-sky-50 text-sky-600" label={t('groups.progress.members')} value={s.members} />
        <StatCard icon={<Pulse size={16} />} iconClass="bg-emerald-50 text-emerald-600" label={t('groups.progress.active_7d')} value={s.active_7d} />
        <StatCard icon={<Warning size={16} />} iconClass="bg-amber-50 text-amber-600" label={t('groups.progress.at_risk')} value={s.at_risk} />
        <StatCard icon={<CheckCircle size={16} />} iconClass="bg-violet-50 text-violet-600" label={t('groups.progress.completion')} value={`${s.completion_rate}%`} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 items-start">
        <SectionCard icon={<ChartBar size={18} className="text-sky-600" />} title={t('groups.progress.by_course')} description={t('groups.progress.by_course_desc')} bodyClassName="px-5 pb-5 pt-3">
          {data.courses.length === 0 ? (
            <p className="text-sm text-neutral-400">{t('groups.progress.no_courses')}</p>
          ) : (
            <ul className="flex flex-col gap-3.5">
              {data.courses.map((c: any) => (
                <li key={c.course_uuid}>
                  <div className="flex items-center justify-between gap-3 mb-1.5">
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="text-sm font-medium text-neutral-900 truncate" dir="auto">
                        {c.name}
                      </span>
                      {c.linked && <Chip tone="sky" className="!py-0 !text-[10px]">{t('groups.progress.unlocked')}</Chip>}
                    </span>
                    <span className="text-xs text-neutral-500 tabular-nums shrink-0">
                      {t('groups.progress.completed_of', { done: c.completed, total: c.enrolled })}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-neutral-100 overflow-hidden" role="progressbar" aria-valuenow={c.completion_rate} aria-valuemin={0} aria-valuemax={100}>
                    <div className="h-full rounded-full bg-emerald-500" style={{ width: `${c.completion_rate}%` }} />
                  </div>
                  <p className="mt-1 text-[11px] text-neutral-400">
                    {t('groups.progress.avg', { pct: c.avg_progress })}
                    {c.not_started ? ` · ${t('groups.progress.not_started', { count: c.not_started })}` : ''}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard icon={<Pulse size={18} className="text-emerald-600" />} title={t('groups.progress.activity')} description={t('groups.progress.activity_desc')} bodyClassName="px-5 pb-5 pt-4">
          {data.activity.length === 0 ? (
            <p className="text-sm text-neutral-400">{t('groups.progress.no_activity')}</p>
          ) : (
            <div className="flex items-end gap-1.5 h-36" role="img" aria-label={t('groups.progress.activity')}>
              {data.activity.map((a: any) => (
                <div key={a.week} className="flex-1 flex flex-col items-center justify-end gap-1 h-full min-w-0" title={`${formatDate(a.week, i18n.language)}: ${a.active}`}>
                  <span className="text-[10px] text-neutral-400 tabular-nums">{a.active || ''}</span>
                  <div className="w-full rounded-t-md bg-emerald-400/80" style={{ height: `${Math.max(3, (a.active / maxActive) * 100)}%` }} />
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      <SectionCard
        icon={<Warning size={18} className="text-amber-600" />}
        title={t('groups.progress.members_title')}
        description={t('groups.progress.members_desc')}
        bodyClassName="pt-3"
      >
        {data.members.length === 0 ? (
          <EmptyState icon={<UsersThree size={22} />} title={t('groups.members.empty')} />
        ) : (
          <ul className="divide-y divide-neutral-100 border-t border-neutral-100">
            {data.members.slice(0, 100).map((m: any) => (
              <li key={m.id} className="flex items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <PersonCell
                    user={m}
                    size={32}
                    secondary={m.last_active ? t('groups.progress.last_active', { date: formatDate(m.last_active, i18n.language) }) : t('groups.progress.never_active')}
                  />
                </div>
                <span className="hidden sm:block text-xs text-neutral-500 tabular-nums w-28 text-end">
                  {t('groups.progress.courses_done', { done: m.completed, total: m.enrolled })}
                </span>
                <span className="hidden sm:block w-24">
                  <span className="block h-1.5 rounded-full bg-neutral-100 overflow-hidden">
                    <span className="block h-full bg-sky-500 rounded-full" style={{ width: `${m.avg_progress}%` }} />
                  </span>
                </span>
                {m.at_risk ? <Chip tone="amber">{t('groups.progress.at_risk_chip')}</Chip> : <Chip tone="emerald">{t('groups.progress.on_track')}</Chip>}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  )
}
