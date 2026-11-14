import React from 'react'
import { TextAa, ClipboardText, GraduationCap, Hash, Percent, ThumbsUp } from '@phosphor-icons/react'
import { formatDate } from '@/lib/format'

// Shared look for the teacher-side assignment screens (list, detail header,
// submissions, grading modal). Buttons and chips come from the dashboard kit
// so assignments, courses and paths read as one set.

export {
  BTN_PRIMARY,
  BTN_SECONDARY,
  BTN_PRIMARY_SM,
  BTN_SECONDARY_SM,
  Chip,
} from '@components/Dashboard/Shared/DashKit/DashKit'
export type { ChipTone } from '@components/Dashboard/Shared/DashKit/DashKit'

export const GRADING_TYPE_META: Record<string, { Icon: React.ComponentType<{ size?: number; className?: string }>; labelKey: string }> = {
  ALPHABET: { Icon: TextAa, labelKey: 'dashboard.assignments.modals.edit.form.grading_types.alphabet' },
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
  if (assignment.ungraded) return { Icon: ClipboardText, labelKey: 'assignments.ungraded_badge' }
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

// Where an assignment stands against its deadline. "Soon" is the next three
// days, which is when a nudge to learners (or a grading push) still helps.
export type DueState = 'overdue' | 'soon' | 'upcoming' | null
const DUE_SOON_MS = 3 * 24 * 60 * 60 * 1000
export function dueStateOf(value: string | null | undefined, now: number = Date.now()): DueState {
  if (!value) return null
  const time = new Date(value).getTime()
  if (isNaN(time)) return null
  if (time < now) return 'overdue'
  if (time - now <= DUE_SOON_MS) return 'soon'
  return 'upcoming'
}
