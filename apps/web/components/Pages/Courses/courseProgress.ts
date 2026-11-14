'use client'
import { useMemo } from 'react'
import { getUriWithOrg } from '@services/config/config'

// One model of "where the learner is in the course", shared by the progress
// indicator, its outline popover and the phone bottom bar, so they always
// agree on what is done, current and locked.

export type ProgressActivity = {
  activity: any
  done: boolean
  current: boolean
  locked: boolean
  href: string
}

export type ProgressChapter = {
  chapter: any
  index: number
  activities: ProgressActivity[]
  completed: number
  total: number
  current: boolean
  locked: boolean
  firstHref?: string
}

const cleanActivity = (uuid?: string) => uuid?.replace('activity_', '') ?? ''

export function useCourseProgress({
  course,
  trailData,
  orgslug,
  currentActivityId,
}: {
  course: any
  trailData?: any
  orgslug: string
  currentActivityId?: string
}) {
  return useMemo(() => {
    const courseUuid = String(course?.course_uuid ?? '').replace('course_', '')
    const base = getUriWithOrg(orgslug, '') + `/course/${courseUuid}`
    const currentId = cleanActivity(currentActivityId)

    const run = (Array.isArray(trailData?.runs) ? trailData.runs : []).find(
      (r: any) => String(r?.course?.course_uuid ?? '').replace('course_', '') === courseUuid
    )
    const doneIds = new Set<number>(
      (Array.isArray(run?.steps) ? run.steps : []).filter((s: any) => s?.complete === true).map((s: any) => s.activity_id)
    )

    const flat: ProgressActivity[] = []
    const chapters: ProgressChapter[] = (Array.isArray(course?.chapters) ? course.chapters : []).map(
      (chapter: any, index: number) => {
        const chapterLocked = !!chapter?.is_locked || !!chapter?.drip_locked
        const activities: ProgressActivity[] = (Array.isArray(chapter?.activities) ? chapter.activities : []).map(
          (activity: any) => {
            const item: ProgressActivity = {
              activity,
              done: doneIds.has(activity.id),
              current: !!currentId && cleanActivity(activity.activity_uuid) === currentId,
              locked: chapterLocked || !!activity?.is_locked,
              href: `${base}/activity/${cleanActivity(activity.activity_uuid)}`,
            }
            flat.push(item)
            return item
          }
        )
        return {
          chapter,
          index,
          activities,
          completed: activities.filter((a) => a.done).length,
          total: activities.length,
          current: activities.some((a) => a.current),
          locked: chapterLocked,
          firstHref: activities[0]?.href,
        }
      }
    )

    const currentIndex = flat.findIndex((a) => a.current)
    // Without a current activity (the course page), focus the chapter the
    // learner would resume in: the first one with something left to do.
    let focusChapterIndex = chapters.findIndex((c) => c.current)
    if (focusChapterIndex < 0) focusChapterIndex = Math.max(0, chapters.findIndex((c) => c.completed < c.total))
    const focusChapter = chapters[focusChapterIndex]
    const positionInChapter = focusChapter ? focusChapter.activities.findIndex((a) => a.current) : -1

    const completedCount = flat.filter((a) => a.done).length
    const total = flat.length
    const prev = currentIndex > 0 ? flat[currentIndex - 1] : null
    const next = currentIndex >= 0 && currentIndex < total - 1 ? flat[currentIndex + 1] : null

    return {
      chapters,
      flat,
      currentIndex,
      focusChapterIndex,
      focusChapter,
      positionInChapter,
      completedCount,
      total,
      percent: total > 0 ? (completedCount / total) * 100 : 0,
      isCourseCompleted: total > 0 && completedCount === total,
      prev,
      next,
      isLast: currentIndex >= 0 && currentIndex === total - 1,
      endHref: `${base}/activity/end`,
    }
  }, [course, trailData, orgslug, currentActivityId])
}

export type CourseProgressModel = ReturnType<typeof useCourseProgress>
