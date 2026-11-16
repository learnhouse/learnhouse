'use client'
import React, { useMemo, useState } from 'react'
import Link from 'next/link'
import { useQueries, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ArrowCounterClockwise, ArrowSquareOut, Check, Eye, Lightning, Tray } from '@phosphor-icons/react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { AssignmentProvider } from '@components/Contexts/Assignments/AssignmentContext'
import UserAvatar from '@components/Objects/UserAvatar'
import { getAPIUrl } from '@services/config/config'
import { getUserAvatarMediaDirectory } from '@services/media/media'
import { apiFetch } from '@services/utils/ts/requests'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'
import { Button, SegmentedControl, buttonClass, formatRelative } from '@components/Dashboard/Shared/DashKit/DashKit'
import { Chip } from './assignmentUi'
import {
  EvaluateDialog,
  rowDisplayName,
  submissionStatus,
} from '../[assignmentuuid]/subpages/AssignmentSubmissionsSubPage'

// The submissions of one assignment, opened in place from the assignments
// list: learners with status chips, and one click into the same evaluate
// dialog the Submissions tab uses (previous / next stepping included).

export type SubmissionCounts = { total: number; to_grade: number; graded: number; late: number }

const needsGrading = (s: any) => s?.submission_status === 'SUBMITTED' || s?.submission_status === 'LATE'
const keyOf = (s: any) => String(s?.assignmentusersubmission_uuid || s?.id)
const dateMs = (s: any) => {
  const time = new Date(s?.creation_date).getTime()
  return isNaN(time) ? 0 : time
}

export function countsFromSubmissions(submissions: any[]): SubmissionCounts {
  const list = Array.isArray(submissions) ? submissions : []
  return {
    total: list.length,
    to_grade: list.filter(needsGrading).length,
    graded: list.filter((s) => s?.submission_status === 'GRADED').length,
    late: list.filter((s) => s?.submission_status === 'LATE').length,
  }
}

type Tab = 'to_grade' | 'graded' | 'all'

export default function SubmissionsPanel({
  assignment,
  submissions,
  submissionsHref,
}: {
  assignment: any
  submissions: any[] | undefined
  submissionsHref: { pathname: string; query: Record<string, string> }
}) {
  const { t, i18n } = useTranslation()
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const queryClient = useQueryClient()
  const { track } = useLHAnalytics('dashboard')
  const shortUuid = String(assignment.assignment_uuid).replace('assignment_', '')
  const list = useMemo(() => (Array.isArray(submissions) ? submissions : []), [submissions])
  const counts = countsFromSubmissions(list)

  // Start on "To grade" when there's anything to grade; that's why a teacher
  // opens this. `null` = not chosen yet, so it follows the data until clicked.
  const [chosenTab, setChosenTab] = useState<Tab | null>(null)
  const tab: Tab = chosenTab ?? (counts.to_grade > 0 ? 'to_grade' : 'all')

  // Same per-user query key as the Submissions tab, so names are shared.
  const userQueries = useQueries({
    queries: list.map((s: any) => ({
      queryKey: ['users', 'id', s.user_id],
      queryFn: () => apiFetch(`${getAPIUrl()}users/id/${s.user_id}`, access_token),
      enabled: !!(s.user_id && access_token),
      staleTime: 60_000,
    })),
  })
  const usersById = new Map<any, any>()
  list.forEach((s: any, i: number) => {
    const u = userQueries[i]?.data
    if (u) usersById.set(s.user_id, u)
  })

  // Waiting longest first while grading; most recent first otherwise.
  const visible = useMemo(() => {
    const rows = list.filter((s: any) =>
      tab === 'to_grade' ? needsGrading(s) : tab === 'graded' ? s.submission_status === 'GRADED' : true
    )
    return [...rows].sort((a: any, b: any) => {
      if (tab === 'all' && needsGrading(a) !== needsGrading(b)) return needsGrading(a) ? -1 : 1
      return tab === 'graded' ? dateMs(b) - dateMs(a) : dateMs(a) - dateMs(b)
    })
  }, [list, tab])

  // The dialog steps through a snapshot of the list as it was when opened.
  // Grading someone moves them out of "To grade" on the next poll; without
  // the snapshot the index would jump to a different learner mid-review.
  const [dialog, setDialog] = useState<{ keys: string[]; index: number } | null>(null)
  const byKey = useMemo(() => new Map(list.map((s: any) => [keyOf(s), s])), [list])
  const dialogSubs = dialog ? dialog.keys.map((k) => byKey.get(k)).filter(Boolean) : []

  const openAt = (index: number) => {
    const submission = visible[index]
    track(AnalyticsEvent.SubmissionEvaluateOpened, {
      submission_status: submission?.submission_status,
      attempt_number: submission?.attempt_number ?? 1,
    })
    setDialog({ keys: visible.map(keyOf), index })
  }
  const closeDialog = () => {
    setDialog(null)
    // Refresh the per-row counts that came with the listing.
    queryClient.invalidateQueries({ queryKey: ['assignments-all'] })
  }

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: 'to_grade', label: t('dashboard.assignments.submissions.stats.to_grade'), count: counts.to_grade },
    { key: 'graded', label: t('dashboard.assignments.submissions.status.graded'), count: counts.graded },
    { key: 'all', label: t('dashboard.assignments.submissions.filters.all'), count: counts.total },
  ]

  return (
    <div className='rounded-xl bg-white ring-1 ring-neutral-200/70 overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150'>
      <div className='flex flex-wrap items-center justify-between gap-2 px-3 sm:px-4 py-2.5 border-b border-neutral-100'>
        <div className='overflow-x-auto scrollbar-hide max-w-full'>
          <SegmentedControl value={tab} onChange={setChosenTab} options={tabs} ariaLabel={t('common.status')} />
        </div>
        <div className='flex items-center gap-1.5'>
          {tab === 'to_grade' && visible.length > 0 && (
            <Button size='sm' variant='primary' icon={<Lightning size={13} />} onClick={() => openAt(0)}>
              {t('dashboard.assignments.list.panel.start_grading')}
            </Button>
          )}
          <Link href={submissionsHref} prefetch className={buttonClass('ghost', 'sm')}>
            <ArrowSquareOut size={13} />
            {t('dashboard.assignments.list.panel.open_full')}
          </Link>
        </div>
      </div>

      {!submissions ? (
        <div className='animate-pulse divide-y divide-neutral-100'>
          {[1, 2, 3].map((i) => (
            <div key={i} className='flex items-center gap-3 px-4 py-3'>
              <div className='w-8 h-8 rounded-full bg-neutral-100' />
              <div className='flex-1 space-y-1.5'>
                <div className='h-3 bg-neutral-100 rounded w-1/4' />
                <div className='h-2.5 bg-neutral-100 rounded w-1/6' />
              </div>
              <div className='h-6 w-16 bg-neutral-100 rounded-full' />
            </div>
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className='flex items-center justify-center gap-2 px-4 py-8 text-sm text-neutral-500'>
          <Tray size={16} className='text-neutral-400' />
          {list.length === 0
            ? t('dashboard.assignments.submissions.empty_description')
            : tab === 'to_grade'
              ? t('dashboard.assignments.list.panel.all_caught_up')
              : t('dashboard.assignments.submissions.empty')}
        </div>
      ) : (
        <ul className='divide-y divide-neutral-100 max-h-[420px] overflow-y-auto overscroll-contain'>
          {visible.map((submission: any, index: number) => {
            const user = usersById.get(submission.user_id)
            const status = submissionStatus(t, submission.submission_status)
            const toGrade = needsGrading(submission)
            const attempt = submission.attempt_number || 1
            const grade = submission.submission_status === 'GRADED'
              ? submission.grade_display?.display_grade ?? submission.grade
              : null
            return (
              <li key={keyOf(submission)} className='flex items-center gap-3 px-3 sm:px-4 py-2.5 hover:bg-neutral-50/70'>
                <UserAvatar
                  avatar_url={getUserAvatarMediaDirectory(user?.user_uuid, user?.avatar_image)}
                  predefined_avatar={user?.avatar_image ? undefined : 'empty'}
                  width={32}
                  rounded='rounded-full'
                />
                <button type='button' onClick={() => openAt(index)} className='min-w-0 flex-1 text-start'>
                  <p className='text-sm font-semibold text-neutral-900 truncate hover:underline underline-offset-2'>{rowDisplayName(user)}</p>
                  <p className='text-xs text-neutral-500 tabular-nums truncate'>
                    {formatRelative(submission.creation_date, i18n.language)}
                  </p>
                </button>
                <div className='hidden sm:flex items-center gap-1.5 shrink-0'>
                  {attempt > 1 && (
                    <Chip tone='sky' icon={<ArrowCounterClockwise size={12} />} className='tabular-nums'>
                      {t('assignments.attempt_count', { current: attempt })}
                    </Chip>
                  )}
                  {grade !== null && grade !== undefined && (
                    <Chip
                      tone={submission.grade_display ? (submission.grade_display.passed ? 'emerald' : 'rose') : 'neutral'}
                      className='tabular-nums'
                    >
                      {grade}
                    </Chip>
                  )}
                </div>
                <Chip tone={status.tone} icon={status.icon} className='shrink-0'>{status.label}</Chip>
                <Button
                  size='sm'
                  variant={toGrade ? 'primary' : 'secondary'}
                  icon={toGrade ? <Check size={13} /> : <Eye size={13} />}
                  onClick={() => openAt(index)}
                  className='shrink-0'
                >
                  <span className='max-sm:hidden'>
                    {toGrade ? t('dashboard.assignments.submissions.evaluate') : t('dashboard.assignments.submissions.review')}
                  </span>
                </Button>
              </li>
            )
          })}
        </ul>
      )}

      {/* The evaluate dialog reads the assignment from context, exactly as on
          the Submissions tab. Mounted with the panel, so the assignment and
          its tasks are already loading by the time a learner is clicked. */}
      <AssignmentProvider assignment_uuid={assignment.assignment_uuid}>
        <EvaluateDialog
          submissions={dialogSubs}
          index={dialog && dialogSubs.length ? Math.min(dialog.index, dialogSubs.length - 1) : null}
          usersById={usersById}
          assignment_uuid={shortUuid}
          onIndexChange={(index) => (index === null ? closeDialog() : setDialog((d) => (d ? { ...d, index } : d)))}
        />
      </AssignmentProvider>
    </div>
  )
}
