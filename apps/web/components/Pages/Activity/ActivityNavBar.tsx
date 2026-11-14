'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { CaretLeft, CaretRight, Flag } from '@phosphor-icons/react'

/*
  The course reader's bottom navigation: one slim bar with the previous
  activity, the activity's own control (mark complete, submit, its status) and
  the next activity. Used below the content on desktop and as the floating
  dock in focus mode; phones use MobileActivityBar, which shares the control
  styles below (`navControlClass`).
*/

// Same recipe as buttonClass('primary'): follows the org accent via lh-t-btn.
const buttonPrimary =
  'lh-t-btn text-white bg-neutral-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_1px_1px_rgba(0,0,0,0.08),0_0_0_1px_rgba(0,0,0,0.9)] hover:bg-neutral-800'

export type NavControlTone = 'todo' | 'done' | 'neutral' | 'warn' | 'danger' | 'primary'

/**
 * The center control. `todo` is the outline "Mark as complete" button, `done`
 * a soft success pill (it follows the org accent through `lh-t-chip`),
 * `primary` the one solid action (submit an assignment), the rest read-only
 * statuses.
 */
export function navControlClass(tone: NavControlTone, { dark = false, compact = false }: { dark?: boolean; compact?: boolean } = {}) {
  const base = `group inline-flex items-center justify-center gap-2 whitespace-nowrap font-semibold select-none transition-[background-color,box-shadow,color,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${
    dark ? 'focus-visible:ring-white/40 focus-visible:ring-offset-[#1c1c1e]' : 'focus-visible:ring-neutral-900/20'
  } disabled:cursor-wait disabled:opacity-60 ${
    compact ? 'lh-press h-11 w-full rounded-full px-4 text-sm' : 'h-10 rounded-xl px-3.5 text-[13px] active:scale-[0.98]'
  }`
  const tones: Record<NavControlTone, string> = dark
    ? {
        todo: 'bg-white/[0.06] text-white ring-1 ring-inset ring-white/15 hover:bg-white/10',
        done: 'bg-emerald-400/15 text-emerald-300 ring-1 ring-inset ring-emerald-400/25 hover:bg-emerald-400/20',
        neutral: 'bg-white/[0.06] text-white/70 ring-1 ring-inset ring-white/10',
        warn: 'bg-amber-400/15 text-amber-200 ring-1 ring-inset ring-amber-400/25',
        danger: 'bg-rose-400/15 text-rose-200 ring-1 ring-inset ring-rose-400/25',
        primary: 'bg-white text-neutral-900 hover:bg-white/90',
      }
    : {
        todo: 'bg-white text-neutral-800 ring-1 ring-inset ring-neutral-200 hover:bg-neutral-50 hover:ring-neutral-300',
        done: 'lh-t-chip bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200/80 hover:bg-emerald-100/70',
        neutral: 'bg-neutral-100 text-neutral-600 ring-1 ring-inset ring-neutral-200/70',
        warn: 'bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200/80',
        danger: 'bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200/80',
        primary: buttonPrimary,
      }
  return `${base} ${tones[tone]}`
}

/** The bar itself: white, hairline ring, soft shadow; a dark glass on the video stage. */
export function ActivityNavBar({ dark = false, className = '', children }: { dark?: boolean; className?: string; children: React.ReactNode }) {
  const { t } = useTranslation()
  return (
    <nav
      aria-label={t('activities.nav.label', 'Activity navigation')}
      className={`lh-activity-nav flex h-[52px] max-w-full min-w-0 items-center gap-1 rounded-2xl p-1.5 ${
        dark
          ? 'bg-[#1c1c1e]/90 text-white ring-1 ring-white/10 shadow-[0_12px_32px_rgba(0,0,0,0.45)] backdrop-blur-xl'
          : 'bg-white nice-shadow ring-1 ring-black/[0.04]'
      } ${className}`}
    >
      {children}
    </nav>
  )
}

export function NavDivider({ dark = false }: { dark?: boolean }) {
  return <span aria-hidden className={`lh-nav-div mx-1 h-5 w-px shrink-0 ${dark ? 'bg-white/10' : 'bg-neutral-200/80'}`} />
}

/** Previous / next: a quiet button with a chevron and the activity title. */
export function NavStepButton({
  direction,
  title,
  finish = false,
  onClick,
  dark = false,
}: {
  direction: 'prev' | 'next'
  title: string
  /** Last activity: Next becomes "Finish course" with a flag. */
  finish?: boolean
  onClick: () => void
  dark?: boolean
}) {
  const { t } = useTranslation()
  const caption = direction === 'prev' ? t('common.previous') : t('common.next')
  const label = finish ? t('course.finish_course', 'Finish course') : title
  const chevron =
    direction === 'prev' ? (
      <CaretLeft size={15} weight="bold" className="shrink-0 transition-transform duration-150 group-hover:-translate-x-0.5 rtl:rotate-180 rtl:group-hover:translate-x-0.5" />
    ) : finish ? (
      <Flag size={14} weight="fill" className="shrink-0" />
    ) : (
      <CaretRight size={15} weight="bold" className="shrink-0 transition-transform duration-150 group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5" />
    )
  return (
    <button
      type="button"
      onClick={onClick}
      title={finish ? label : `${caption}: ${label}`}
      aria-label={finish ? label : `${caption}: ${label}`}
      className={`group inline-flex h-10 min-w-0 items-center gap-1.5 rounded-xl px-3 text-[13px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 active:scale-[0.98] ${
        dark
          ? 'text-white/70 hover:bg-white/10 hover:text-white focus-visible:ring-white/40'
          : `${finish ? 'lh-t-accent text-neutral-900' : 'text-neutral-600'} hover:bg-neutral-100 hover:text-neutral-900 focus-visible:ring-neutral-900/20`
      }`}
    >
      {direction === 'prev' && chevron}
      <span className="truncate max-w-[120px] lg:max-w-[200px]">{label}</span>
      {direction === 'next' && chevron}
    </button>
  )
}

/** "3 / 8": where this activity sits in the course. */
export function NavProgressHint({ current, total, dark = false }: { current: number; total: number; dark?: boolean }) {
  const { t } = useTranslation()
  return (
    <span
      className={`shrink-0 px-2 text-xs font-medium tabular-nums ${dark ? 'text-white/45' : 'text-neutral-400'}`}
      title={t('activities.nav.position', { defaultValue: 'Activity {{current}} of {{total}}', current, total })}
    >
      {current}
      <span className={dark ? 'text-white/25' : 'text-neutral-300'}> / </span>
      {total}
    </span>
  )
}
