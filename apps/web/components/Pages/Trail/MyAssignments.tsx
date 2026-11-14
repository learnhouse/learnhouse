'use client'
import React from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { Backpack, CalendarBlank, CaretRight, CheckCircle, Hourglass, PaperPlaneTilt, Warning } from '@phosphor-icons/react'
import { getUriWithOrg } from '@services/config/config'
import { Chip, formatRelative, type ChipTone } from '@components/Dashboard/Shared/DashKit/DashKit'
import type { MyAssignment } from '@services/courses/assignments'
import { TrailSection } from './trailUi'

const clean = (uuid: string, prefix: string) => uuid.replace(prefix, '')

// The date part of a due date, in the reader's language. Date-only values
// ("2026-11-20") are shown as written, without a timezone shift.
function dueLabel(due: string, locale: string) {
  const d = new Date(due.length === 10 ? `${due}T12:00:00` : due)
  if (isNaN(d.getTime())) return due
  return d.toLocaleDateString(locale, { month: 'short', day: 'numeric' })
}

function dueDate(due: string) {
  const d = new Date(due.length === 10 ? `${due}T23:59:59` : due)
  return isNaN(d.getTime()) ? null : d
}

function StatusChip({ item }: { item: MyAssignment }) {
  const { t } = useTranslation()
  const map: Record<string, { tone: ChipTone; icon: React.ReactNode; label: string }> = {
    overdue: { tone: 'rose', icon: <Warning size={11} weight="bold" />, label: t('trail.assignments.status.overdue', 'Overdue') },
    not_started: { tone: 'neutral', icon: undefined as any, label: t('trail.assignments.status.not_started', 'Not started') },
    in_progress: { tone: 'sky', icon: <Hourglass size={11} />, label: t('trail.assignments.status.in_progress', 'In progress') },
    submitted: { tone: 'violet', icon: <PaperPlaneTilt size={11} />, label: t('trail.assignments.status.submitted', 'Submitted') },
    late: { tone: 'amber', icon: <PaperPlaneTilt size={11} />, label: t('trail.assignments.status.late', 'Submitted late') },
  }
  const entry = item.overdue ? map.overdue : map[item.status] ?? map.not_started
  return <Chip tone={entry.tone} icon={entry.icon}>{entry.label}</Chip>
}

function Row({ item, orgslug, children }: { item: MyAssignment; orgslug: string; children: React.ReactNode }) {
  const href = getUriWithOrg(
    orgslug,
    `/course/${clean(item.course.course_uuid, 'course_')}/activity/${clean(item.activity_uuid, 'activity_')}`
  )
  return (
    <li>
      <Link href={href} className="group flex items-center gap-3 px-4 py-3 hover:bg-neutral-50 transition-colors">
        <span className="w-8 h-8 shrink-0 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
          <Backpack size={15} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-neutral-900 truncate">{item.title}</span>
          <span className="block text-xs text-neutral-500 truncate">{item.course.name}</span>
        </span>
        {children}
        <CaretRight size={13} className="shrink-0 text-neutral-300 group-hover:text-neutral-500 rtl:rotate-180" />
      </Link>
    </li>
  )
}

// Learner assignments on the Progress page: open work (overdue first, then
// by due date) and the most recently graded.
export default function MyAssignments({
  items,
  loading,
  orgslug,
}: {
  items: MyAssignment[] | undefined
  loading: boolean
  orgslug: string
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language || 'en'
  const open = (items ?? []).filter((i) => i.status !== 'graded')
  const graded = (items ?? []).filter((i) => i.status === 'graded').slice(0, 5)

  return (
    <TrailSection
      id="trail-assignments"
      icon={<Backpack size={18} />}
      title={t('trail.assignments.title', 'Assignments')}
      description={t('trail.assignments.description', 'What is due and what was graded recently.')}
      count={open.length || undefined}
    >
      <div className="bg-white rounded-2xl nice-shadow overflow-hidden">
        {loading ? (
          <ul className="divide-y divide-neutral-100 animate-pulse">
            {[0, 1, 2].map((i) => (
              <li key={i} className="flex items-center gap-3 px-4 py-3">
                <span className="w-8 h-8 rounded-lg bg-neutral-100" />
                <span className="flex-1 space-y-1.5">
                  <span className="block h-3.5 w-2/3 rounded bg-neutral-100" />
                  <span className="block h-3 w-1/3 rounded bg-neutral-100" />
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <>
            <p className="px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
              {t('trail.assignments.due', 'Due soon')}
            </p>
            {open.length === 0 ? (
              <div className="flex items-center gap-2.5 px-4 pb-4 pt-1 text-sm text-neutral-500">
                <CheckCircle size={18} weight="fill" className="text-emerald-500 shrink-0" />
                {t('trail.assignments.all_clear', 'Nothing due. You are all caught up!')}
              </div>
            ) : (
              <ul className="divide-y divide-neutral-100">
                {open.slice(0, 6).map((item) => {
                  const due = item.due_date ? dueDate(item.due_date) : null
                  return (
                    <Row key={item.assignment_uuid} item={item} orgslug={orgslug}>
                      <span className="hidden sm:flex flex-col items-end gap-1 shrink-0">
                        <StatusChip item={item} />
                        {item.due_date && (
                          <span
                            className={`inline-flex items-center gap-1 text-[11px] tabular-nums ${item.overdue ? 'text-rose-600' : 'text-neutral-400'}`}
                            title={due ? due.toLocaleString(locale) : undefined}
                          >
                            <CalendarBlank size={11} />
                            {dueLabel(item.due_date, locale)}
                            {due && ` · ${formatRelative(due.toISOString(), locale)}`}
                          </span>
                        )}
                      </span>
                      <span className="sm:hidden shrink-0">
                        <StatusChip item={item} />
                      </span>
                    </Row>
                  )
                })}
              </ul>
            )}

            {graded.length > 0 && (
              <>
                <p className="px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-400 border-t border-neutral-100">
                  {t('trail.assignments.graded', 'Recently graded')}
                </p>
                <ul className="divide-y divide-neutral-100">
                  {graded.map((item) => (
                    <Row key={item.assignment_uuid} item={item} orgslug={orgslug}>
                      {item.grade ? (
                        <Chip tone={item.grade.passed ? 'emerald' : 'rose'}>{item.grade.display_grade}</Chip>
                      ) : (
                        <Chip tone="neutral" icon={<CheckCircle size={11} />}>
                          {item.ungraded ? t('trail.assignments.reviewed', 'Reviewed') : t('trail.assignments.status.graded', 'Graded')}
                        </Chip>
                      )}
                    </Row>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </div>
    </TrailSection>
  )
}
