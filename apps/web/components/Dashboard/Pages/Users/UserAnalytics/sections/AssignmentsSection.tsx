'use client'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Activity, ChevronDown, ChevronRight } from 'lucide-react'
import { fmtDate } from '../format'
import { Card, SectionTitle, StatusBadge, Empty, P } from './primitives'
import TaskAnswer from './TaskAnswer'

function TaskRow({ task }: { task: any }) {
  const { t } = useTranslation()
  const typeLabel = t(`${P}.task_types.${task.type}`, { defaultValue: task.type_label || task.type })

  return (
    <div className="text-xs border border-gray-100 rounded p-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="flex-none text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-lg bg-slate-100 text-slate-600">
            {typeLabel}
          </span>
          {task.title && <span className="font-semibold truncate">{task.title}</span>}
        </div>
        <span className="flex-none text-gray-600">
          {task.submitted
            ? `${task.points_summary || task.grade} pts${task.manually_graded ? ' · manual' : ''}`
            : t(`${P}.answer.not_submitted`, { defaultValue: 'Not submitted' })}
        </span>
      </div>
      {task.feedback && <div className="text-gray-500 mt-1">{task.feedback}</div>}
      {/* Where the raw submission JSON used to be dumped. */}
      <TaskAnswer answer={task.answer} />
    </div>
  )
}

function AssignmentRow({ a }: { a: any }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const tasks = a.tasks || []
  const hasTasks = tasks.length > 0

  return (
    <div className="border border-gray-100 rounded-lg">
      <button
        type="button"
        onClick={() => hasTasks && setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-3 p-4 text-start"
      >
        <div className="flex items-center gap-2 min-w-0">
          {hasTasks ? (open ? <ChevronDown size={16} /> : <ChevronRight size={16} />) : <span className="w-4" />}
          <div className="min-w-0">
            <span className="font-semibold truncate block">{a.title || a.assignment_uuid}</span>
            {(a.course_name || a.activity_name) && (
              <span className="text-xs text-gray-400 truncate block">
                {[a.course_name, a.activity_name].filter(Boolean).join(' · ')}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          {/* Server-computed and grading-type aware, so an ALPHABET assignment shows
              its letter rather than a made-up "/100". */}
          <span className="text-sm font-semibold" title={a.points_summary || undefined}>
            {a.grade_display || (a.grade != null ? `${a.grade}` : '—')}
          </span>
          <span className="text-xs text-gray-400">{t(`${P}.assignments.attempt`, { number: a.attempt_number })}</span>
          <StatusBadge status={a.status} />
        </div>
      </button>
      {open && hasTasks && (
        <div className="px-4 pb-4 space-y-2">
          <div className="flex flex-wrap gap-3 text-[11px] text-gray-400">
            <span>
              {t(`${P}.assignments.tasks`, {
                done: a.tasks_submitted ?? 0,
                total: a.tasks_total ?? tasks.length,
                defaultValue: '{{done}}/{{total}} tasks submitted',
              })}
            </span>
            {a.submitted_at && <span>{fmtDate(a.submitted_at)}</span>}
          </div>
          {a.overall_feedback && (
            <div className="text-xs text-gray-600 bg-gray-50 rounded p-2">
              <span className="font-semibold">{t(`${P}.assignments.feedback`)} </span>{a.overall_feedback}
            </div>
          )}
          {tasks.map((task: any, i: number) => <TaskRow key={i} task={task} />)}
        </div>
      )}
    </div>
  )
}

export default function AssignmentsSection({ assignments }: { assignments: any[] }) {
  const { t } = useTranslation()
  return (
    <Card>
      <SectionTitle icon={<Activity size={18} />} title={t(`${P}.assignments.title`)} count={assignments.length} />
      {assignments.length === 0 ? (
        <Empty label={t(`${P}.assignments.empty`)} />
      ) : (
        <div className="space-y-3">
          {assignments.map((a, i) => <AssignmentRow key={i} a={a} />)}
        </div>
      )}
    </Card>
  )
}
