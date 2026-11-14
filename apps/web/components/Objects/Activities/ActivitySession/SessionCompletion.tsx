'use client'

// The activity's own control in a session, the same pills the lesson page's
// bar shows (navControlClass): "Mark as complete" then "Completed", a play's
// read-only status, and an assignment's submit / grading / grade. Unlike the
// lesson page nothing here navigates: completing keeps the learner where they
// are (a board, a panel) and only updates their trail.

import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { useQueryClient } from '@tanstack/react-query'
import { CheckCircle, Circle, CircleNotch, ClipboardText, Hourglass } from '@phosphor-icons/react'
import { queryKeys } from '@/lib/query/keys'
import { markActivityAsComplete, unmarkActivityAsComplete } from '@services/courses/activity'
import { getFinalGrade, submitAssignmentForGrading } from '@services/courses/assignments'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useAssignmentSubmission } from '@components/Contexts/Assignments/AssignmentSubmissionContext'
import { useAssignmentDirtyTasks } from '@components/Contexts/Assignments/AssignmentDirtyTasksContext'
import ConfirmationModal from '@components/Objects/StyledElements/ConfirmationModal/ConfirmationModal'
import { ASSIGNMENT_SUBMIT_EVENT } from '@components/Objects/Activities/Assignment/assignmentUI'
import { isAssignmentPastDue } from '@components/Objects/Activities/Assignment/AssignmentStudentActivity'
import { navControlClass } from '@components/Pages/Activity/ActivityNavBar'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'
import { cleanCourseUuid } from './activityTypes'

const opts = { compact: false }
const controlClass = (tone: Parameters<typeof navControlClass>[0]) => `${navControlClass(tone, opts)} h-9! rounded-lg! px-3!`

/** Mark complete / completed, for every kind but assignments and plays. */
export function CompletionToggle({
  activity,
  course,
  orgId,
  orgslug,
  completed,
  onChange,
}: {
  activity: any
  course: any
  orgId: number
  orgslug: string
  completed: boolean
  onChange?: (_completed: boolean) => void
}) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const token = session?.data?.tokens?.access_token
  const queryClient = useQueryClient()
  const { track } = useLHAnalytics('learner')
  const [busy, setBusy] = useState(false)
  const trailKey = queryKeys.trail.org(orgId)

  const mark = async () => {
    if (busy) return
    setBusy(true)
    await queryClient.cancelQueries({ queryKey: trailKey })
    const previous = queryClient.getQueryData(trailKey)
    const courseKey = cleanCourseUuid(course.course_uuid)
    // Done right away; the server's trail replaces this when it answers.
    queryClient.setQueryData(trailKey, (trail: any) => {
      if (!trail) return trail
      const runs = Array.isArray(trail.runs) ? trail.runs : []
      const has = runs.some((r: any) => cleanCourseUuid(String(r?.course?.course_uuid ?? '')) === courseKey)
      const step = { activity_id: activity.id, course_id: course.id, complete: true }
      return {
        ...trail,
        runs: has
          ? runs.map((r: any) => (cleanCourseUuid(String(r?.course?.course_uuid ?? '')) === courseKey ? { ...r, steps: [...(r.steps || []), step] } : r))
          : [...runs, { course: { course_uuid: course.course_uuid }, course_id: course.id, steps: [step] }],
      }
    })
    try {
      const trail = await markActivityAsComplete(orgslug, course.course_uuid, activity.activity_uuid, token)
      if (trail?.runs) queryClient.setQueryData(trailKey, trail)
      else await queryClient.invalidateQueries({ queryKey: trailKey })
      track(AnalyticsEvent.ActivityMarkedComplete, {
        activity_uuid: activity.activity_uuid,
        course_uuid: course.course_uuid,
        activity_type: activity.activity_type,
        will_complete_course: false,
        has_next_activity: true,
      })
      onChange?.(true)
    } catch {
      queryClient.setQueryData(trailKey, previous)
      toast.error(t('activities.failed_mark_complete'))
    } finally {
      setBusy(false)
    }
  }

  const unmark = async () => {
    if (busy) return
    setBusy(true)
    try {
      const trail = await unmarkActivityAsComplete(orgslug, course.course_uuid, activity.activity_uuid, token)
      if (trail?.runs) queryClient.setQueryData(trailKey, trail)
      else await queryClient.invalidateQueries({ queryKey: trailKey })
      onChange?.(false)
      toast(
        (tt) => (
          <span className="flex items-center gap-3 text-sm">
            {t('activities.nav.marked_not_done')}
            <button
              type="button"
              className="font-semibold text-neutral-900 underline underline-offset-2"
              onClick={() => {
                toast.dismiss(tt.id)
                void mark()
              }}
            >
              {t('activities.nav.undo')}
            </button>
          </span>
        ),
        { duration: 5000 },
      )
    } catch {
      toast.error(t('activities.failed_unmark_complete'))
    } finally {
      setBusy(false)
    }
  }

  return completed ? (
    <button
      type="button"
      role="checkbox"
      aria-checked="true"
      onClick={unmark}
      disabled={busy}
      title={t('activities.nav.undo_hint')}
      className={controlClass('done')}
      data-session-complete="done"
    >
      {busy ? <CircleNotch size={16} className="animate-spin" /> : <CheckCircle size={16} weight="fill" className="lh-t-accent shrink-0" />}
      {t('common.completed')}
    </button>
  ) : (
    <button type="button" role="checkbox" aria-checked="false" onClick={mark} disabled={busy} className={controlClass('todo')} data-session-complete="todo">
      {busy ? (
        <CircleNotch size={16} className="shrink-0 animate-spin" />
      ) : (
        <CheckCircle size={16} className="shrink-0 text-neutral-400 transition-colors group-hover:text-neutral-700" />
      )}
      {busy ? t('activities.marking') : t('activities.mark_as_complete')}
    </button>
  )
}

/** A play is completed by passing it, never by hand. */
export function PlayStatus({ completed }: { completed: boolean }) {
  const { t } = useTranslation()
  return (
    <span role="status" className={controlClass(completed ? 'done' : 'neutral')}>
      {completed ? <CheckCircle size={16} weight="fill" className="lh-t-accent shrink-0" /> : <Circle size={15} className="shrink-0" />}
      {completed ? t('common.completed') : t('play_activity.learner.status_pending')}
    </span>
  )
}

/**
 * An assignment's hand-in, inside AssignmentSubmissionProvider: submit (after
 * saving pending answers), then "grading in progress", then the grade.
 * Retrying and the grade breakdown stay on the lesson page (`lessonHref`).
 */
export function AssignmentStatus({ assignment, lessonHref, onSubmitted }: { assignment: any; lessonHref: string; onSubmitted?: () => void }) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const token = session?.data?.tokens?.access_token
  const queryClient = useQueryClient()
  const submission = useAssignmentSubmission() as any
  const dirtyTasks = useAssignmentDirtyTasks()
  const [submitting, setSubmitting] = useState(false)
  const [grade, setGrade] = useState<any>(null)
  const uuid = assignment?.assignment_uuid
  const status: string | undefined = Array.isArray(submission) ? submission[0]?.submission_status : undefined

  useEffect(() => {
    if (status !== 'GRADED' || !uuid || !session?.data?.user?.id) return
    let alive = true
    getFinalGrade(session.data.user.id, uuid, token).then((res: any) => {
      if (alive && res?.success) setGrade(res.data)
    })
    return () => {
      alive = false
    }
  }, [status, uuid, token, session?.data?.user?.id])

  const submit = async () => {
    if (!uuid || submitting) return
    setSubmitting(true)
    try {
      if (!(await dirtyTasks.flushAll())) {
        toast.error(t('assignments.failed_submit_assignment'))
        return
      }
      const res = await submitAssignmentForGrading(uuid, token)
      if (res?.success) {
        toast.success(t('assignments.assignment_submitted_success'))
        for (const key of [
          queryKeys.assignments.submission(uuid),
          queryKeys.assignments.taskSubmission(uuid),
          queryKeys.assignments.tasks(uuid),
          queryKeys.assignments.detail(uuid),
        ]) {
          queryClient.invalidateQueries({ queryKey: key })
        }
        onSubmitted?.()
      } else {
        toast.error(t('assignments.failed_submit_assignment'))
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (!assignment) return null
  const ungraded = !!assignment.ungraded

  if (!status || status === 'PENDING' || status === 'NOT_SUBMITTED') {
    if (isAssignmentPastDue(assignment.due_date)) {
      return (
        <span role="status" className={controlClass('danger')}>
          <ClipboardText size={16} className="shrink-0" />
          {t('assignments.past_due')}
        </span>
      )
    }
    if (submitting) {
      return (
        <span role="status" aria-busy="true" className={controlClass('neutral')}>
          <CircleNotch size={16} className="shrink-0 animate-spin" />
          {t('assignments.submitting')}
        </span>
      )
    }
    return (
      <ConfirmationModal
        confirmationButtonText={t('assignments.submit_assignment')}
        pendingButtonText={t('assignments.submitting')}
        confirmationMessage={ungraded ? t('assignments.hand_in_confirm') : t('assignments.submit_assignment_confirm')}
        dialogTitle={ungraded ? t('assignments.hand_in_title') : t('assignments.submit_assignment_title')}
        dialogTrigger={
          <button type="button" className={controlClass('primary')} data-session-complete="submit">
            <ClipboardText size={16} className="shrink-0" />
            {ungraded ? t('assignments.hand_in') : t('assignments.submit_for_grading')}
          </button>
        }
        functionToExecute={submit}
        status="info"
        openOnEvent={ASSIGNMENT_SUBMIT_EVENT}
      />
    )
  }

  if (status === 'SUBMITTED') {
    return ungraded ? (
      <span role="status" className={controlClass('done')}>
        <CheckCircle size={16} weight="fill" className="lh-t-accent shrink-0" />
        {t('assignments.handed_in')}
      </span>
    ) : (
      <span role="status" className={controlClass('warn')}>
        <Hourglass size={16} className="shrink-0" />
        {t('assignments.grading_in_progress')}
      </span>
    )
  }

  if (status === 'GRADED') {
    const passing = grade?.passed !== false
    const display = grade?.display_grade ?? (grade ? `${grade.grade}/${grade.max_grade}` : '…')
    return (
      <a href={lessonHref} target="_blank" rel="noopener noreferrer" className={controlClass(passing ? 'done' : 'danger')} data-session-complete="graded">
        <CheckCircle size={16} weight={passing ? 'fill' : 'regular'} className={`shrink-0 ${passing ? 'lh-t-accent' : ''}`} />
        {t('assignments.graded')}
        <span className="rounded-md bg-white/80 px-1.5 py-0.5 text-[11px] font-bold tabular-nums ring-1 ring-inset ring-black/[0.06]">{display}</span>
      </a>
    )
  }
  return null
}
