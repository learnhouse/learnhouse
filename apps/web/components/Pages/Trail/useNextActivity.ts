'use client'
import { useQueries } from '@tanstack/react-query'
import { getCourseMetadata } from '@services/courses/courses'
import { queryKeys } from '@/lib/query/keys'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import type { RunSummary } from './trailStats'

export type NextActivity = {
  activity: any
  chapter: any
  chapterIndex: number
  // Clean activity uuid, for the /activity/<id> link.
  activityId: string
}

// The first activity each learner hasn't finished, per course. Uses the same
// slim course-meta cache as the course page, so opening a course afterwards
// is instant. Capped so a learner with dozens of courses doesn't fan out.
export function useNextActivities(summaries: RunSummary[], limit = 12): Record<string, NextActivity | null> {
  const session = useLHSession() as any
  const token = session?.data?.tokens?.access_token
  const targets = summaries.filter((s) => !s.completed).slice(0, limit)

  const results = useQueries({
    queries: targets.map((s) => {
      const uuid = s.courseUuid.replace('course_', '')
      return {
        queryKey: queryKeys.courses.meta(uuid),
        queryFn: () => getCourseMetadata(uuid, {}, token, { slim: true }),
        enabled: !!token,
        staleTime: 60_000,
      }
    }),
  })

  const out: Record<string, NextActivity | null> = {}
  targets.forEach((s, i) => {
    const course = results[i]?.data as any
    if (!course || !Array.isArray(course.chapters)) return
    const doneIds = new Set<number>((Array.isArray(s.run.steps) ? s.run.steps : []).map((st: any) => st.activity_id))
    let found: NextActivity | null = null
    course.chapters.some((chapter: any, chapterIndex: number) =>
      (Array.isArray(chapter.activities) ? chapter.activities : []).some((activity: any) => {
        if (doneIds.has(activity.id) || activity.is_locked) return false
        found = {
          activity,
          chapter,
          chapterIndex,
          activityId: String(activity.activity_uuid).replace('activity_', ''),
        }
        return true
      })
    )
    out[s.courseUuid] = found
  })
  return out
}
