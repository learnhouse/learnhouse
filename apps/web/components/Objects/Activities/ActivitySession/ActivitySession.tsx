'use client'

// A real learner session for one activity, anywhere: the activity rendered by
// the lesson page's own components, with the viewer's own session, progress
// saved to their trail, and the same completion control as the lesson bar.
// It fills its parent (a flex column): the content scrolls in its own
// container and the control sits in a bar at the bottom. The host draws the
// frame and the title (see the board activity block); `useActivitySummary`
// gives it the title, kind and progress without loading the content.
//
// Access: a viewer who can't read the course (private, restricted to a user
// group, not enrolled, paid) gets SessionLocked with a link to the course page
// instead of the content.

import React, { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { ArrowSquareOut, Certificate } from '@phosphor-icons/react'
import { CourseProvider } from '@components/Contexts/CourseContext'
import { AssignmentDirtyTasksProvider } from '@components/Contexts/Assignments/AssignmentDirtyTasksContext'
import AssignmentSubmissionProvider from '@components/Contexts/Assignments/AssignmentSubmissionContext'
import { buttonClass } from '@components/Dashboard/Shared/DashKit/DashKit'
import { getAssignmentFromActivityUUID } from '@services/courses/assignments'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'
import SessionOrgProvider from './SessionOrgProvider'
import SessionLocked from './SessionLocked'
import SessionContent, { SessionSkeleton } from './SessionContent'
import { AssignmentStatus, CompletionToggle, PlayStatus } from './SessionCompletion'
import { useActivitySummary, useSessionActivity, useSessionToken } from './useActivitySession'
import { fullActivityUuid, rememberOpened } from './activityTypes'

export { useActivitySummary } from './useActivitySession'
export type { ActivitySummary, SessionAccess } from './useActivitySession'
export { activityKind, type ActivityKind, type ActivityProgress } from './activityTypes'
export { default as SessionLocked } from './SessionLocked'

export interface ActivitySessionProps {
  activityUuid: string
  courseUuid: string
  orgslug: string
  /** Fallback when the session context has no token yet. */
  token?: string
  /** `compact` for a small window (a block on a canvas), `comfortable` for a focused view. */
  density?: 'compact' | 'comfortable'
  /** The viewer's completion changed (marked, unmarked, handed in). */
  onProgressChange?: (_completed: boolean) => void
  className?: string
}

const SURFACE: Record<string, string> = {
  TYPE_DYNAMIC: 'bg-white',
  TYPE_SCORM: 'bg-white',
  TYPE_VIDEO: 'bg-neutral-950',
  TYPE_DOCUMENT: 'bg-neutral-100',
}

export default function ActivitySession(props: ActivitySessionProps) {
  return (
    <SessionOrgProvider orgslug={props.orgslug}>
      <SessionInner {...props} />
    </SessionOrgProvider>
  )
}

function SessionInner({ activityUuid, courseUuid, orgslug, token: tokenProp, density = 'comfortable', onProgressChange, className = '' }: ActivitySessionProps) {
  const { t } = useTranslation()
  const token = useSessionToken(tokenProp)
  const summary = useActivitySummary({ activityUuid, courseUuid, orgslug, token })
  const detail = useSessionActivity(activityUuid, token, summary.access === 'ok')
  const access = summary.access !== 'ok' ? summary.access : detail.access
  const activity = detail.activity
  const course = summary.course
  const isAssignment = activity?.activity_type === 'TYPE_ASSIGNMENT'
  const { track } = useLHAnalytics('learner')

  const { data: assignment } = useQuery({
    queryKey: ['assignment', 'by-activity', fullActivityUuid(activityUuid)],
    queryFn: async () => (await getAssignmentFromActivityUUID(fullActivityUuid(activityUuid), token as string))?.data ?? null,
    enabled: isAssignment && access === 'ok' && !!token,
    staleTime: 60_000,
  })

  const ready = access === 'ok' && !!activity && !!course
  const activityKey = activity?.activity_uuid
  const courseKey = course?.course_uuid
  const activityType = activity?.activity_type
  useEffect(() => {
    if (!activityKey || !courseKey) return
    rememberOpened(activityKey)
    track(AnalyticsEvent.ActivityViewed, { activity_uuid: activityKey, course_uuid: courseKey, activity_type: activityType })
  }, [activityKey, courseKey, activityType, track])

  if (access === 'loading') {
    return (
      <div className={`flex min-h-0 flex-1 flex-col p-5 ${className}`}>
        <SessionSkeleton />
      </div>
    )
  }

  if (!ready) {
    return (
      <div className={`flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto ${className}`} data-scrollable>
        <SessionLocked
          access={access === 'ok' ? 'error' : access}
          orgslug={orgslug}
          courseHref={summary.courseHref}
          unlockAt={activity?.drip_unlock_at ?? summary.entry?.drip_unlock_at}
          onRetry={() => void detail.refetch()}
          compact={density === 'compact'}
        />
      </div>
    )
  }

  const completed = summary.progress === 'completed'
  const pad =
    activity.activity_type === 'TYPE_VIDEO'
      ? density === 'compact' ? 'p-2' : 'p-4'
      : density === 'compact' ? 'px-4 py-4' : 'px-5 py-6 sm:px-8'
  const isPlay = activity.activity_type === 'TYPE_PLAY' && activity.play_available !== false
  const orgId: number | undefined = summary.org?.id

  let control: React.ReactNode = null
  if (isAssignment) {
    control = assignment ? (
      <AssignmentSubmissionProvider assignment_uuid={assignment.assignment_uuid}>
        <AssignmentStatus assignment={assignment} lessonHref={summary.activityHref} onSubmitted={() => onProgressChange?.(true)} />
      </AssignmentSubmissionProvider>
    ) : null
  } else if (isPlay) {
    control = <PlayStatus completed={completed} />
  } else if (orgId) {
    control = (
      <CompletionToggle activity={activity} course={course} orgId={orgId} orgslug={orgslug} completed={completed} onChange={onProgressChange} />
    )
  }

  return (
    <CourseProvider courseuuid={course.course_uuid} initialCourseStructure={course}>
      <AssignmentDirtyTasksProvider>
        <div className={`flex min-h-0 flex-1 flex-col ${className}`} data-activity-session={activity.activity_uuid}>
          <div
            className={`min-h-0 flex-1 overflow-y-auto overscroll-contain ${SURFACE[activity.activity_type] ?? 'bg-[#f8f8f8]'}`}
            data-scrollable
            data-interactive
          >
            <div className={pad}>
              <SessionContent activity={activity} course={course} orgslug={orgslug} orgUuid={course.org_uuid || summary.org?.org_uuid} assignment={assignment} />
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-neutral-100 bg-white px-3 py-2" data-interactive>
            {control}
            {summary.courseDone && (
              <a href={summary.endHref} target="_blank" rel="noopener noreferrer" className={buttonClass('ghost', 'sm')}>
                <Certificate size={14} weight="duotone" className="text-amber-600" />
                {t('activity_session.course_done')}
              </a>
            )}
            <a
              href={summary.activityHref}
              target="_blank"
              rel="noopener noreferrer"
              className={`${buttonClass('ghost', 'sm')} ms-auto`}
              title={t('activity_session.open_lesson_hint')}
              aria-label={t('activity_session.open_lesson')}
            >
              <span className="max-[420px]:hidden">{t('activity_session.open_lesson')}</span>
              <ArrowSquareOut size={13} />
            </a>
          </div>
        </div>
      </AssignmentDirtyTasksProvider>
    </CourseProvider>
  )
}
