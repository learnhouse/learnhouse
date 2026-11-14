'use client'

import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { AssignmentProvider } from '@components/Contexts/Assignments/AssignmentContext'
import { AssignmentsTaskProvider } from '@components/Contexts/Assignments/AssignmentsTaskContext'
import AssignmentSubmissionProvider from '@components/Contexts/Assignments/AssignmentSubmissionContext'
import { AssignmentDirtyTasksProvider } from '@components/Contexts/Assignments/AssignmentDirtyTasksContext'
import { StandaloneCourseProvider } from '@components/Objects/Activities/ActivityRenderer/ActivityRenderer'
import AssignmentStudentActivity from '@components/Objects/Activities/Assignment/AssignmentStudentActivity'
import AssignmentTools from '@components/Objects/Activities/Assignment/AssignmentTools'
import { getAssignmentFromActivityUUID } from '@services/courses/assignments'

export interface StandaloneAssignmentProps {
  activity: any
  course: any
  /** Shown while the assignment loads. */
  fallback?: React.ReactNode
  /** Called when the assignment can't be loaded (no access, not found). */
  onError?: (_error: Error) => void
}

type LoadState = { uuid: string; assignment: any; failed: boolean }

/**
 * A learner's view of an assignment outside the course player: the tasks with
 * their answers, then the submit / retry / grade controls. Same components as
 * the activity page. Needs a signed-in session (useLHSession).
 */
export default function StandaloneAssignment({ activity, course, fallback = null, onError }: StandaloneAssignmentProps) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const accessToken: string | undefined = session?.data?.tokens?.access_token
  const activityUuid: string | undefined = activity?.activity_uuid
  const [state, setState] = useState<LoadState | null>(null)
  const onErrorRef = useRef(onError)
  useEffect(() => {
    onErrorRef.current = onError
  }, [onError])

  // A refreshed token for the same learner must not reload the assignment,
  // so the effect only reruns when a session appears or the activity changes.
  const hasToken = !!accessToken
  const tokenRef = useRef(accessToken)
  useEffect(() => {
    tokenRef.current = accessToken
  }, [accessToken])

  useEffect(() => {
    const token = tokenRef.current
    if (!hasToken || !token || !activityUuid) return
    let alive = true
    const fail = (error: Error) => {
      if (!alive) return
      setState({ uuid: activityUuid, assignment: null, failed: true })
      onErrorRef.current?.(error)
    }
    getAssignmentFromActivityUUID(activityUuid, token)
      .then((res: any) => {
        if (!alive) return
        if (res?.success && res.data?.assignment_uuid) {
          setState({ uuid: activityUuid, assignment: res.data, failed: false })
        } else {
          fail(new Error(res?.data?.detail?.message ?? res?.data?.detail ?? 'Assignment not available'))
        }
      })
      .catch(fail)
    return () => {
      alive = false
    }
  }, [activityUuid, hasToken])

  const current = state?.uuid === activityUuid ? state : null
  const failed = !!current?.failed
  const assignment = current?.assignment ?? null

  if (failed) {
    return (
      <div role="alert" className="lh-assignment-error p-4 text-sm text-gray-500">
        {t('assignments.not_available', { defaultValue: 'This assignment is not available.' })}
      </div>
    )
  }
  if (!assignment) return <>{fallback}</>

  const uuid = assignment.assignment_uuid
  return (
    <div className="lh-assignment">
    <StandaloneCourseProvider course={course}>
      <AssignmentDirtyTasksProvider>
        <AssignmentSubmissionProvider assignment_uuid={uuid}>
          <AssignmentProvider assignment_uuid={uuid}>
            <AssignmentsTaskProvider>
              <AssignmentStudentActivity />
            </AssignmentsTaskProvider>
          </AssignmentProvider>
          <div className="lh-assignment-tools mt-4 flex justify-end">
            <AssignmentTools
              assignment={assignment}
              activity={activity}
              activityid={activity.activity_uuid}
              course={course}
              orgslug=""
            />
          </div>
        </AssignmentSubmissionProvider>
      </AssignmentDirtyTasksProvider>
    </StandaloneCourseProvider>
    </div>
  )
}
