'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import {
  BookOpen,
  Certificate,
  ChatsCircle,
  CheckCircle,
  Exam,
  PaperPlaneTilt,
  Pulse,
  SealCheck,
  SignIn,
  SignOut,
} from '@phosphor-icons/react'
import { Skeleton } from '@/design'
import { formatRelative } from '@components/Dashboard/Shared/DashKit/DashKit'
import type { MemberEvent } from '@services/organizations/memberPanel'

export const P = 'dashboard.users.panel'

/** A titled block inside a tab: sentence-case title, optional end slot, white card. */
export function PanelSection({
  title,
  end,
  children,
  flush = false,
}: {
  title: string
  end?: React.ReactNode
  children: React.ReactNode
  flush?: boolean
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3 min-h-6 px-0.5">
        <h3 className="text-sm font-semibold text-neutral-900">{title}</h3>
        {end}
      </div>
      <div className={`bg-white rounded-2xl nice-shadow ${flush ? 'overflow-hidden' : 'p-4'}`}>{children}</div>
    </section>
  )
}

/** A number with a tinted icon square, the panel's take on StatCard (denser). */
export function Metric({
  icon,
  tone,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode
  tone: string
  label: string
  value: React.ReactNode
  sub?: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-3 min-w-0 px-4 py-3.5 bg-white">
      <span className={`w-8 h-8 rounded-[10px] flex items-center justify-center shrink-0 ${tone}`}>{icon}</span>
      <div className="min-w-0">
        <p className="text-[11px] text-neutral-500 truncate">{label}</p>
        <p className="text-lg font-bold text-neutral-900 tabular-nums leading-tight">{value}</p>
        {sub && <p className="text-[11px] text-neutral-400 truncate mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

/** Progress as a thin bar with its value; green once complete. */
export function ProgressBar({ value, done }: { value: number; done?: boolean }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)))
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className="h-1.5 flex-1 rounded-full bg-neutral-100 overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className={`h-full rounded-full ${done ? 'bg-emerald-500' : 'bg-sky-500'}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[11px] font-semibold tabular-nums text-neutral-600 w-8 text-end">{pct}%</span>
    </div>
  )
}

/**
 * Thirty days as columns: height is the learning events of the day, a muted
 * stub marks a day the member was around without a recorded event. Pure SVG,
 * mirrored in RTL so time still runs toward the reading end.
 */
export function ActivityStrip({ days, label }: { days: { date: string; events: number; active: boolean }[]; label: string }) {
  const { i18n } = useTranslation()
  const max = Math.max(1, ...days.map((d) => d.events))
  const W = 300
  const H = 44
  const gap = 2
  const bw = (W - gap * (days.length - 1)) / Math.max(days.length, 1)
  const fmt = new Intl.DateTimeFormat(i18n.language, { month: 'short', day: 'numeric' })
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-11 rtl:-scale-x-100" role="img" aria-label={label} preserveAspectRatio="none">
      {days.map((d, i) => {
        const h = d.events ? Math.max(4, (d.events / max) * (H - 2)) : d.active ? 4 : 2
        return (
          <rect
            key={d.date}
            x={i * (bw + gap)}
            y={H - h}
            width={bw}
            height={h}
            rx={1.5}
            className={d.events ? 'fill-emerald-500' : d.active ? 'fill-emerald-200' : 'fill-neutral-200'}
          >
            <title>{`${fmt.format(new Date(`${d.date}T12:00:00`))} · ${d.events}`}</title>
          </rect>
        )
      })}
    </svg>
  )
}

const EVENT_STYLE: Record<string, { icon: React.ReactNode; tone: string }> = {
  login: { icon: <SignIn />, tone: 'bg-neutral-100 text-neutral-500' },
  logout: { icon: <SignOut />, tone: 'bg-neutral-100 text-neutral-500' },
  course_enrolled: { icon: <BookOpen />, tone: 'bg-sky-50 text-sky-600' },
  activity_completed: { icon: <CheckCircle />, tone: 'bg-emerald-50 text-emerald-600' },
  course_completed: { icon: <SealCheck />, tone: 'bg-emerald-50 text-emerald-600' },
  assignment_submitted: { icon: <PaperPlaneTilt />, tone: 'bg-amber-50 text-amber-600' },
  assignment_graded: { icon: <Exam />, tone: 'bg-sky-50 text-sky-600' },
  certificate_claimed: { icon: <Certificate />, tone: 'bg-emerald-50 text-emerald-600' },
  discussion_posted: { icon: <ChatsCircle />, tone: 'bg-neutral-100 text-neutral-500' },
}

const EVENT_LABELS: Record<string, string> = {
  login: 'Signed in',
  logout: 'Signed out',
  course_enrolled: 'Enrolled in a course',
  activity_completed: 'Completed an activity',
  course_completed: 'Completed a course',
  assignment_submitted: 'Submitted an assignment',
  assignment_graded: 'Assignment graded',
  certificate_claimed: 'Earned a certificate',
}

export function eventLabel(t: (_k: string, _o?: any) => string, type: string): string {
  return t(`${P}.events.${type}`, { defaultValue: EVENT_LABELS[type] ?? type.replace(/_/g, ' ') })
}

/** One learning event: tinted icon, sentence, detail line, relative time. */
export function EventRow({ event }: { event: MemberEvent }) {
  const { t, i18n } = useTranslation()
  const style = EVENT_STYLE[event.event_type] ?? { icon: <Pulse />, tone: 'bg-neutral-100 text-neutral-500' }
  const m = event.metadata || {}
  const detail = [m.activity_name, m.course_name, m.display_grade].filter(Boolean).join(' · ')
  return (
    <li className="flex items-start gap-3 px-4 py-2.5">
      <span className={`mt-0.5 w-7 h-7 rounded-full flex items-center justify-center shrink-0 [&>svg]:size-3.5 ${style.tone}`}>{style.icon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-[13px] font-medium text-neutral-800 truncate">{eventLabel(t, event.event_type)}</p>
          <time
            className="text-[11px] text-neutral-400 tabular-nums shrink-0"
            dateTime={event.at}
            title={new Date(event.at).toLocaleString(i18n.language)}
          >
            {formatRelative(event.at, i18n.language)}
          </time>
        </div>
        {detail && (
          <p className="text-xs text-neutral-500 truncate" dir="auto">
            {detail}
          </p>
        )}
      </div>
    </li>
  )
}

export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3" aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-14 w-full rounded-2xl" />
      ))}
    </div>
  )
}

/** A quiet in-card empty line (the full EmptyState is too tall inside a tab). */
export function QuietEmpty({ icon, title, hint, action }: { icon: React.ReactNode; title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center text-center gap-2 px-6 py-8">
      <span className="w-10 h-10 rounded-xl bg-neutral-100 text-neutral-400 flex items-center justify-center">{icon}</span>
      <p className="text-sm font-semibold text-neutral-800">{title}</p>
      {hint && <p className="text-xs text-neutral-500 max-w-xs">{hint}</p>}
      {action}
    </div>
  )
}

export function dateOnly(value: string | null | undefined, locale: string): string {
  if (!value) return '—'
  const d = new Date(value)
  return isNaN(d.getTime()) ? '—' : new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(d)
}
