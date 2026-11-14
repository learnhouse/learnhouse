'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { Backpack, BookOpen, Certificate, CheckCircle, Fire, Lightning, ListChecks, Medal } from '@phosphor-icons/react'

export type TrailStats = {
  inProgress: number
  completed: number
  activitiesDone: number
  certificates: number | null
  streak: number
  playBadges: number | null
  playStreak: number | null
  // Open assignments due in the next 7 days or overdue; null when the
  // assignments feature is off or still loading.
  dueThisWeek: number | null
}

function MiniStat({ icon, tone, label, value }: { icon: React.ReactNode; tone: string; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 bg-white rounded-xl nice-shadow ps-2 pe-3.5 h-12 min-w-0 shrink-0 max-sm:min-w-[132px]">
      <span className={`w-8 h-8 shrink-0 rounded-lg flex items-center justify-center ${tone}`}>{icon}</span>
      <span className="min-w-0 leading-tight">
        <span className="block text-base font-bold tabular-nums text-neutral-900">{value}</span>
        <span className="block text-[11px] text-neutral-500 truncate">{label}</span>
      </span>
    </div>
  )
}

// The page's first band: greeting on one side, the headline numbers as a
// single row of small tiles, so the courses start right below.
export default function TrailOverview({ firstName, stats }: { firstName?: string; stats: TrailStats | null }) {
  const { t } = useTranslation()
  const hour = new Date().getHours()
  const name = firstName ? `, ${firstName}` : ''
  const greeting =
    hour < 12
      ? t('trail.greeting.morning', { defaultValue: 'Good morning{{name}}', name })
      : hour < 18
        ? t('trail.greeting.afternoon', { defaultValue: 'Good afternoon{{name}}', name })
        : t('trail.greeting.evening', { defaultValue: 'Good evening{{name}}', name })
  const skeleton = <span className="inline-block h-4 w-6 rounded bg-neutral-100 animate-pulse" />
  const v = (n: number | null | undefined) => (stats ? (n ?? '–') : skeleton)

  return (
    <div className="flex flex-col gap-5">
      <div className="min-w-0 shrink-0">
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900">{greeting}</h1>
        <p className="mt-1 text-sm text-neutral-500">{t('trail.subtitle', 'Your courses, progress and achievements in one place.')}</p>
      </div>
      {/* Phones: one swipeable row, so the courses stay near the top. */}
      <div className="flex gap-3 overflow-x-auto scrollbar-hide -mx-4 px-4 py-1 -my-1 sm:mx-0 sm:px-0 sm:grid sm:grid-cols-4 sm:overflow-visible lg:flex lg:flex-wrap">
        <MiniStat icon={<BookOpen size={16} />} tone="bg-sky-50 text-sky-600" label={t('trail.stats.in_progress', 'In progress')} value={v(stats?.inProgress)} />
        <MiniStat icon={<CheckCircle size={16} />} tone="bg-emerald-50 text-emerald-600" label={t('trail.stats.completed', 'Completed')} value={v(stats?.completed)} />
        {stats?.dueThisWeek !== null && stats?.dueThisWeek !== undefined && (
          <MiniStat icon={<Backpack size={16} />} tone="bg-amber-50 text-amber-600" label={t('trail.stats.due_week', 'Due this week')} value={stats.dueThisWeek} />
        )}
        <MiniStat icon={<ListChecks size={16} />} tone="bg-violet-50 text-violet-600" label={t('trail.stats.activities', 'Activities done')} value={v(stats?.activitiesDone)} />
        <MiniStat icon={<Certificate size={16} />} tone="bg-amber-50 text-amber-600" label={t('trail.stats.certificates', 'Certificates')} value={v(stats?.certificates)} />
        <MiniStat
          icon={<Fire size={16} weight="fill" />}
          tone="bg-orange-50 text-orange-500"
          label={t('trail.stats.streak', 'Learning streak')}
          value={stats ? t('trail.stats.days', { defaultValue_one: '{{count}} day', defaultValue_other: '{{count}} days', count: stats.streak }) : skeleton}
        />
        {stats?.playBadges !== null && stats?.playBadges !== undefined ? (
          <MiniStat icon={<Medal size={16} />} tone="bg-rose-50 text-rose-600" label={t('trail.stats.play_badges', 'Play badges')} value={stats.playBadges} />
        ) : stats?.playStreak ? (
          <MiniStat icon={<Lightning size={16} weight="fill" />} tone="bg-rose-50 text-rose-600" label={t('trail.stats.play_streak', 'Play streak')} value={stats.playStreak} />
        ) : null}
      </div>
    </div>
  )
}
