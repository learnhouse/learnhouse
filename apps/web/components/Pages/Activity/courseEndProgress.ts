// Progress numbers for the course-end screen (CourseEndView), computed from
// the course structure and the learner's trail the activity page already
// loads. Pure, so it is unit-tested without rendering.

export interface CourseEndChapter {
  id: number | string
  name: string
  done: number
  total: number
}

export interface CourseEndNext {
  name: string
  chapterName: string
  chapterIndex: number
  // Clean activity uuid, for the /activity/<id> link.
  activityId: string
}

export interface CourseEndProgress {
  done: number
  total: number
  percent: number
  completed: boolean
  chapters: CourseEndChapter[]
  // First unfinished activity the learner can open; null when none is left
  // (or every remaining one is locked by drip).
  next: CourseEndNext | null
  // When the last activity was finished, from the trail timestamps.
  completedAt: Date | null
}

const stripCourse = (uuid: unknown) => String(uuid ?? '').replace('course_', '')

// The API stores "2026-11-04 22:54:15.878736"; Safari needs the "T".
function parseDate(value: unknown): Date | null {
  if (!value) return null
  const d = new Date(String(value).replace(' ', 'T'))
  return isNaN(d.getTime()) ? null : d
}

/** This course's run in the learner's trail, matched with or without the course_ prefix. */
export function findCourseRun(trail: any, courseUuid: string): any | null {
  const runs: any[] = Array.isArray(trail?.runs) ? trail.runs : []
  const key = stripCourse(courseUuid)
  return runs.find((run) => stripCourse(run?.course?.course_uuid) === key) ?? null
}

export function getCourseEndProgress(course: any, trail: any): CourseEndProgress {
  const chapters: any[] = Array.isArray(course?.chapters) ? course.chapters : []
  const run = findCourseRun(trail, course?.course_uuid)
  const steps: any[] = Array.isArray(run?.steps) ? run.steps : []
  const doneSteps = new Map<number, any>()
  for (const step of steps) if (step?.complete === true) doneSteps.set(step.activity_id, step)

  let done = 0
  let total = 0
  let next: CourseEndNext | null = null
  let lastDone: Date | null = null

  const chapterRows = chapters.map((chapter, chapterIndex) => {
    const activities: any[] = Array.isArray(chapter?.activities) ? chapter.activities : []
    let chapterDone = 0
    for (const activity of activities) {
      const step = doneSteps.get(activity?.id)
      if (step) {
        chapterDone += 1
        const at = parseDate(step.update_date) || parseDate(step.creation_date)
        if (at && (!lastDone || at > lastDone)) lastDone = at
      } else if (!next && !activity?.is_locked && activity?.activity_uuid) {
        next = {
          name: String(activity.name ?? ''),
          chapterName: String(chapter?.name ?? ''),
          chapterIndex,
          activityId: String(activity.activity_uuid).replace('activity_', ''),
        }
      }
    }
    done += chapterDone
    total += activities.length
    return { id: chapter?.id ?? chapterIndex, name: String(chapter?.name ?? ''), done: chapterDone, total: activities.length }
  })

  const completed = total > 0 && done === total
  return {
    done,
    total,
    percent: total > 0 ? Math.round((done / total) * 100) : 0,
    completed,
    chapters: chapterRows,
    next: completed ? null : next,
    completedAt: completed ? lastDone : null,
  }
}
