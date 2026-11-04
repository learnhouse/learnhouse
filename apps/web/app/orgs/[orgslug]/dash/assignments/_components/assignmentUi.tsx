import React from 'react'
import { ALargeSmall, ClipboardCheck, GraduationCap, Hash, Percent, ThumbsUp } from 'lucide-react'
import { formatDate } from '@/lib/format'

// Shared look for the teacher-side assignment screens (list, detail header,
// submissions, grading modal). Kept in one place so the chips and buttons
// read as one set across tabs.

export const BTN_PRIMARY =
  'inline-flex items-center justify-center gap-1.5 h-10 px-4 rounded-xl bg-neutral-900 text-white text-sm font-semibold hover:bg-neutral-800 transition-colors whitespace-nowrap disabled:opacity-50 disabled:pointer-events-none'
export const BTN_SECONDARY =
  'inline-flex items-center justify-center gap-1.5 h-10 px-4 rounded-xl bg-neutral-100 text-neutral-800 text-sm font-semibold hover:bg-neutral-200 transition-colors whitespace-nowrap disabled:opacity-50 disabled:pointer-events-none'
export const BTN_PRIMARY_SM =
  'inline-flex items-center justify-center gap-1.5 h-8 px-3 rounded-lg bg-neutral-900 text-white text-xs font-semibold hover:bg-neutral-800 transition-colors whitespace-nowrap'
export const BTN_SECONDARY_SM =
  'inline-flex items-center justify-center gap-1.5 h-8 px-3 rounded-lg bg-neutral-100 text-neutral-800 text-xs font-semibold hover:bg-neutral-200 transition-colors whitespace-nowrap'

export type ChipTone = 'neutral' | 'amber' | 'emerald' | 'rose' | 'sky' | 'violet'

const CHIP_TONES: Record<ChipTone, string> = {
  neutral: 'bg-neutral-100 text-neutral-600',
  amber: 'bg-amber-50 text-amber-700',
  emerald: 'bg-emerald-50 text-emerald-700',
  rose: 'bg-rose-50 text-rose-700',
  sky: 'bg-sky-50 text-sky-700',
  violet: 'bg-violet-50 text-violet-700',
}

export function Chip({
  tone = 'neutral',
  icon,
  children,
  className = '',
  title,
}: {
  tone?: ChipTone
  icon?: React.ReactNode
  children: React.ReactNode
  className?: string
  title?: string
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap ${CHIP_TONES[tone]} ${className}`}
    >
      {icon}
      {children}
    </span>
  )
}

export const GRADING_TYPE_META: Record<string, { Icon: React.ComponentType<{ size?: number; className?: string }>; labelKey: string }> = {
  ALPHABET: { Icon: ALargeSmall, labelKey: 'dashboard.assignments.modals.edit.form.grading_types.alphabet' },
  NUMERIC: { Icon: Hash, labelKey: 'dashboard.assignments.modals.edit.form.grading_types.numeric' },
  PERCENTAGE: { Icon: Percent, labelKey: 'dashboard.assignments.modals.edit.form.grading_types.percentage' },
  PASS_FAIL: { Icon: ThumbsUp, labelKey: 'dashboard.assignments.modals.edit.form.grading_types.pass_fail' },
  GPA_SCALE: { Icon: GraduationCap, labelKey: 'dashboard.assignments.modals.edit.form.grading_types.gpa_scale' },
}

// What the grading line should say for an assignment. A formative (ungraded)
// assignment still carries a grading_type on the row; it is never used, so
// we say "Not graded" instead of advertising a scale.
export function gradingMetaFor(assignment: any): { Icon: React.ComponentType<{ size?: number; className?: string }>; labelKey: string } | null {
  if (!assignment) return null
  if (assignment.ungraded) return { Icon: ClipboardCheck, labelKey: 'assignments.ungraded_badge' }
  return assignment.grading_type ? GRADING_TYPE_META[assignment.grading_type] ?? null : null
}

// Dates arrive as ISO strings; show them as a short local date.
export function formatShortDate(value: string | null | undefined, locale: string): string | null {
  if (!value) return null
  const date = new Date(value)
  if (isNaN(date.getTime())) return value
  return formatDate(date, locale, { dateStyle: 'medium' })
}

export function formatShortTime(value: string | null | undefined, locale: string): string | null {
  if (!value) return null
  const date = new Date(value)
  if (isNaN(date.getTime())) return null
  return formatDate(date, locale, { dateStyle: undefined, hour: '2-digit', minute: '2-digit' })
}

// True when the given date is already behind us. Kept out of render bodies so
// components stay pure in the linter's eyes.
export function isPastDate(value: string | null | undefined): boolean {
  if (!value) return false
  const time = new Date(value).getTime()
  return !isNaN(time) && time < Date.now()
}
