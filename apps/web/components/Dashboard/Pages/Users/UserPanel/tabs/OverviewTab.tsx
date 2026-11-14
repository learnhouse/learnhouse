'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { BookOpen, Certificate, ClockCounterClockwise, Exam, Lightning, Pulse, TrendUp, Warning } from '@phosphor-icons/react'
import { formatRelative } from '@components/Dashboard/Shared/DashKit/DashKit'
import { Skeleton } from '@/design'
import type { MemberSummary } from '@services/organizations/memberPanel'
import { ActivityStrip, EventRow, Metric, P, PanelSection, QuietEmpty } from '../panelUi'
import { usePanelAuth, type PanelTab } from '../panelState'
import { PanelBlocks } from '../slots'
import { RiskReasonList } from '../risk'

export default function OverviewTab({
  userId,
  summary,
  canManage,
  onTab,
}: {
  userId: number
  summary?: MemberSummary
  canManage: boolean
  onTab: (_t: PanelTab) => void
}) {
  const { t, i18n } = useTranslation()
  const { orgId } = usePanelAuth()
  if (!summary) return <OverviewSkeleton />
  const s = summary.stats
  const lastActive = s.last_active_at ? formatRelative(s.last_active_at, i18n.language) : null

  return (
    <div className="flex flex-col gap-5">
      {summary.at_risk && (
        <div className="rounded-2xl bg-amber-50/80 ring-1 ring-inset ring-amber-600/15 p-3 @[880px]:flex @[880px]:items-start @[880px]:gap-4">
          <div className="flex items-center gap-2.5 px-1 pb-1.5 @[880px]:w-56 @[880px]:shrink-0 @[880px]:pt-1">
            <span className="w-7 h-7 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
              <Warning size={15} weight="fill" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-amber-900">{t(`${P}.at_risk.title`)}</p>
              <p className="text-[11px] text-amber-800/70">{t(`${P}.risk.hint`)}</p>
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <RiskReasonList reasons={summary.risk_reasons} onTab={onTab} tone="amber" />
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 @[560px]:grid-cols-3 @[960px]:grid-cols-6 gap-px bg-neutral-100 rounded-2xl overflow-hidden nice-shadow">
        <Metric
          icon={<BookOpen size={16} weight="duotone" />}
          tone="bg-sky-50 text-sky-600"
          label={t(`${P}.stats.courses`)}
          value={s.courses_enrolled}
          sub={t(`${P}.stats.completed`, { count: s.courses_completed })}
        />
        <Metric
          icon={<TrendUp size={16} weight="duotone" />}
          tone="bg-emerald-50 text-emerald-600"
          label={t(`${P}.stats.avg_progress`)}
          value={`${s.avg_progress}%`}
        />
        <Metric
          icon={<Exam size={16} weight="duotone" />}
          tone="bg-amber-50 text-amber-600"
          label={t(`${P}.stats.assignments`)}
          value={s.assignments_submitted}
          sub={
            s.assignments_to_grade > 0
              ? t(`${P}.stats.to_grade`, { count: s.assignments_to_grade })
              : t(`${P}.stats.graded`, { count: s.assignments_graded })
          }
        />
        <Metric
          icon={<Certificate size={16} weight="duotone" />}
          tone="bg-rose-50 text-rose-600"
          label={t(`${P}.stats.certificates`)}
          value={s.certificates}
        />
        <Metric
          icon={<Lightning size={16} weight="duotone" />}
          tone="bg-neutral-100 text-neutral-600"
          label={t(`${P}.stats.active_days`)}
          value={s.active_days_30}
          sub={t(`${P}.stats.last_30_days`)}
        />
        <Metric
          icon={<ClockCounterClockwise size={16} weight="duotone" />}
          tone="bg-neutral-100 text-neutral-600"
          label={t(`${P}.stats.last_active`)}
          value={<span className="text-sm font-semibold">{lastActive ?? t(`${P}.stats.never`)}</span>}
        />
      </div>

      {/* Feature blocks (profile & manager, required training…), see ../slots.tsx */}
      <PanelBlocks area="overview" userId={userId} orgId={orgId ?? 0} summary={summary} canManage={canManage} />

      <PanelSection title={t(`${P}.overview.activity_title`)} end={<span className="text-[11px] text-neutral-400">{t(`${P}.stats.last_30_days`)}</span>}>
        <ActivityStrip days={summary.activity} label={t(`${P}.overview.activity_title`)} />
        <div className="mt-2 flex items-center gap-4 text-[11px] text-neutral-500">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-sm bg-emerald-500" />
            {t(`${P}.overview.legend_events`)}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-sm bg-emerald-200" />
            {t(`${P}.overview.legend_visit`)}
          </span>
        </div>
      </PanelSection>

      <PanelSection
        title={t(`${P}.overview.recent_title`)}
        flush
        end={
          summary.recent.length > 0 ? (
            <button type="button" onClick={() => onTab('activity')} className="text-xs font-semibold text-neutral-500 hover:text-neutral-900">
              {t(`${P}.overview.see_all`)}
            </button>
          ) : undefined
        }
      >
        {summary.recent.length === 0 ? (
          <QuietEmpty icon={<Pulse size={18} />} title={t(`${P}.overview.recent_empty`)} hint={t(`${P}.overview.recent_empty_hint`)} />
        ) : (
          <ul className="divide-y divide-neutral-100 py-1">
            {summary.recent.slice(0, 5).map((e) => (
              <EventRow key={e.id} event={e} />
            ))}
          </ul>
        )}
      </PanelSection>
    </div>
  )
}

function OverviewSkeleton() {
  return (
    <div className="flex flex-col gap-5" aria-hidden>
      <div className="bg-white rounded-2xl nice-shadow grid grid-cols-2 sm:grid-cols-3 gap-px p-4 gap-y-5">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex gap-3 items-center">
            <Skeleton className="w-8 h-8 rounded-[10px]" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-2.5 w-16" />
              <Skeleton className="h-4 w-10" />
            </div>
          </div>
        ))}
      </div>
      <Skeleton className="h-28 w-full rounded-2xl" />
      <Skeleton className="h-48 w-full rounded-2xl" />
    </div>
  )
}
