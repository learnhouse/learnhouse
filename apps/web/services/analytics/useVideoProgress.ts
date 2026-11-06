'use client'
import { useCallback, useEffect, useRef } from 'react'
import { useLHAnalytics } from './useLHAnalytics'
import { AnalyticsEvent } from './events'
import { VIDEO_MILESTONES, reachedMilestones } from './rules'

/**
 * Reports `video_progress` at 25/50/75/100% of a video activity, each at
 * most once per activity while the component is mounted. Feed it the
 * player's position with `report(currentTime, duration)`; `complete()` marks
 * the video as watched to the end (e.g. on `ended`).
 */
export function useVideoProgress(courseUuid?: string, activityUuid?: string, activityType = 'TYPE_VIDEO') {
  const { track } = useLHAnalytics('learner')
  const fired = useRef<Set<number>>(new Set())

  // A new activity in the same player starts from zero.
  useEffect(() => {
    fired.current = new Set()
  }, [activityUuid])

  const emit = useCallback(
    (milestones: number[]) => {
      if (!courseUuid || !activityUuid) return
      for (const percent of milestones) {
        fired.current.add(percent)
        track(AnalyticsEvent.VideoProgress, {
          course_uuid: courseUuid,
          activity_uuid: activityUuid,
          activity_type: activityType,
          percent,
        })
      }
    },
    [courseUuid, activityUuid, activityType, track],
  )

  const report = useCallback(
    (currentTime: number, duration: number) => {
      const reached = reachedMilestones(currentTime, duration, fired.current)
      if (reached.length) emit(reached)
    },
    [emit],
  )

  const complete = useCallback(() => {
    emit(VIDEO_MILESTONES.filter((m) => !fired.current.has(m)))
  }, [emit])

  return { report, complete }
}
