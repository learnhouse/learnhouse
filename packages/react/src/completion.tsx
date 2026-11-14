import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { useLearnHouseInternal } from './context'
import type { LearnHouseActivityData } from './types'

interface Trail {
  runs?: { course_id?: number; steps?: { activity_id?: number }[] }[]
}

/** Whether `activityId` is completed in `courseId` according to a trail. */
export function isCompletedInTrail(trail: Trail | null | undefined, courseId: number, activityId: number): boolean {
  const run = trail?.runs?.find((r) => r.course_id === courseId)
  return !!run?.steps?.some((s) => s.activity_id === activityId)
}

export interface CompletionProps {
  activity: LearnHouseActivityData
  course: any
  mode: 'button' | 'scroll'
  /** Increments each time the end of the activity comes into view. */
  reachedEnd: number
}

/**
 * The signed-in learner's completion of one activity: read from their trail,
 * toggled with the same API calls as the activity page's "Mark as complete".
 */
export function Completion({ activity, course, mode, reachedEnd }: CompletionProps) {
  const { t } = useTranslation()
  const { client, emit } = useLearnHouseInternal()
  const orgId: number | undefined = course?.org_id ?? activity.org_id
  const courseId: number | undefined = course?.id ?? activity.course_id
  const activityId: number | undefined = activity.id
  const [completed, setCompleted] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const ready = !!client && orgId != null && courseId != null && activityId != null

  useEffect(() => {
    if (!ready) return
    let alive = true
    client.trail
      .getForOrg(orgId!)
      .then((trail: Trail) => alive && setCompleted(isCompletedInTrail(trail, courseId!, activityId!)))
      // Not enrolled yet, or progress unavailable: start from "not completed".
      .catch(() => alive && setCompleted(false))
    return () => {
      alive = false
    }
  }, [client, ready, orgId, courseId, activityId])

  const busyRef = useRef(false)
  const setCompletion = useCallback(
    async (next: boolean) => {
      if (!ready || busyRef.current) return
      busyRef.current = true
      setBusy(true)
      try {
        const trail: Trail = next
          ? await client.trail.completeActivity(activity.activity_uuid)
          : await client.trail.uncompleteActivity(activity.activity_uuid)
        const now = trail?.runs ? isCompletedInTrail(trail, courseId!, activityId!) : next
        setCompleted(now)
        emit({ type: 'progress', activityId: activity.activity_uuid, completed: now })
      } catch (error) {
        toast.error(t(next ? 'activities.failed_mark_complete' : 'activities.failed_unmark_complete'))
        emit({ type: 'error', error: error instanceof Error ? error : new Error(String(error)) })
      } finally {
        busyRef.current = false
        setBusy(false)
      }
    },
    [client, ready, activity.activity_uuid, courseId, activityId, emit, t],
  )

  useEffect(() => {
    if (mode === 'scroll' && reachedEnd > 0 && completed === false) void setCompletion(true)
  }, [mode, reachedEnd, completed, setCompletion])

  if (!ready || mode !== 'button' || completed === null) return null

  return (
    <div className="lh-completion">
      <button
        type="button"
        className={`lh-completion-button${completed ? ' is-complete' : ''}`}
        aria-pressed={completed}
        disabled={busy}
        onClick={() => setCompletion(!completed)}
        title={completed ? t('activities.unmark_activity') : undefined}
      >
        <span aria-hidden className="lh-completion-icon">
          {completed ? '✓' : ''}
        </span>
        {busy ? t('activities.marking') : completed ? t('common.completed') : t('activities.mark_as_complete')}
      </button>
    </div>
  )
}
