'use client'
import React from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { ArrowRight, Exam, WarningCircle } from '@phosphor-icons/react'
import { Button, Chip, formatRelative } from '@components/Dashboard/Shared/DashKit/DashKit'
import { AIChip, StatusPill, type Status } from '@/design'
import { getUriWithOrg } from '@services/config/config'
import type { MemberSubmission } from '@services/organizations/memberPanel'
import { ListSkeleton, P, PanelSection, QuietEmpty } from '../panelUi'
import { useMemberAssignments } from '../panelState'

const STATUS: Record<MemberSubmission['status'], Status> = {
  GRADED: 'success',
  SUBMITTED: 'info',
  LATE: 'warning',
  PENDING: 'neutral',
  NOT_SUBMITTED: 'neutral',
}

export default function AssignmentsTab({ userId }: { userId: number }) {
  const { t } = useTranslation()
  const { data, isLoading, isError, refetch } = useMemberAssignments(userId)

  if (isLoading) return <ListSkeleton rows={3} />
  if (isError || !data) {
    return (
      <QuietEmpty
        icon={<WarningCircle size={18} />}
        title={t(`${P}.load_error`)}
        action={
          <Button size="sm" onClick={() => refetch()}>
            {t(`${P}.retry`)}
          </Button>
        }
      />
    )
  }

  const toGrade = data.items.filter((s) => s.status === 'SUBMITTED' || s.status === 'LATE')
  const rest = data.items.filter((s) => !(s.status === 'SUBMITTED' || s.status === 'LATE'))

  if (data.items.length === 0) {
    return (
      <div className="bg-white rounded-2xl nice-shadow">
        <QuietEmpty icon={<Exam size={18} />} title={t(`${P}.assignments.empty`)} hint={t(`${P}.assignments.empty_hint`)} />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      {toGrade.length > 0 && (
        <PanelSection title={t(`${P}.assignments.to_grade`, { count: toGrade.length })} flush>
          <ul className="divide-y divide-neutral-100">
            {toGrade.map((s) => (
              <SubmissionRow key={s.assignment_uuid} submission={s} />
            ))}
          </ul>
        </PanelSection>
      )}
      {rest.length > 0 && (
        <PanelSection title={t(`${P}.assignments.history`)} flush>
          <ul className="divide-y divide-neutral-100">
            {rest.map((s) => (
              <SubmissionRow key={s.assignment_uuid} submission={s} />
            ))}
          </ul>
        </PanelSection>
      )}
    </div>
  )
}

function SubmissionRow({ submission: s }: { submission: MemberSubmission }) {
  const { t, i18n } = useTranslation()
  const params = useParams() as any
  const gradeHref = getUriWithOrg(params?.orgslug, `/dash/assignments/${s.assignment_uuid}?subpage=submissions`)
  const needsGrade = s.status === 'SUBMITTED' || s.status === 'LATE'
  const aiDraft = s.ai_grade?.status === 'DRAFT'

  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <span
        className={`w-8 h-8 rounded-[10px] flex items-center justify-center shrink-0 ${
          needsGrade ? 'bg-amber-50 text-amber-600' : s.grade?.passed === false ? 'bg-rose-50 text-rose-600' : 'bg-sky-50 text-sky-600'
        }`}
      >
        <Exam size={16} weight="duotone" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-neutral-900 truncate" dir="auto">
          {s.title}
        </p>
        <p className="text-[11px] text-neutral-400 truncate" dir="auto">
          {s.course_name}
          {s.submitted_at ? ` · ${formatRelative(s.submitted_at, i18n.language)}` : ''}
          {s.attempt_number > 1 ? ` · ${t(`${P}.assignments.attempt`, { count: s.attempt_number })}` : ''}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <StatusPill status={STATUS[s.status]} dot>
            {t(`${P}.assignments.status.${s.status.toLowerCase()}`)}
          </StatusPill>
          {s.grade && (
            <Chip tone={s.grade.passed ? 'emerald' : 'rose'} className="tabular-nums">
              {s.grade.display}
            </Chip>
          )}
          {aiDraft && (
            <AIChip tone="soft" title={s.ai_grade?.confidence ? t(`${P}.assignments.ai_confidence.${s.ai_grade.confidence}`) : undefined}>
              {t(`${P}.assignments.ai_draft`)}
            </AIChip>
          )}
        </div>
      </div>
      <Link
        href={gradeHref}
        className={`inline-flex items-center gap-1 h-7 px-2.5 rounded-lg text-xs font-semibold shrink-0 transition-colors ${
          needsGrade ? 'bg-neutral-900 text-white hover:bg-neutral-800' : 'text-neutral-600 hover:bg-neutral-100'
        }`}
      >
        {needsGrade ? t(`${P}.assignments.grade`) : t(`${P}.assignments.view`)}
        <ArrowRight size={12} className="rtl:rotate-180" />
      </Link>
    </li>
  )
}
