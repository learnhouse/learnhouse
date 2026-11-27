import type { CourseProgress, Trail, TrailRun } from './models'

/** Which course: its numeric id, or its uuid (with or without the `course_` prefix). */
export type CourseKey = number | string

function runCourseUuid(run: TrailRun): string | undefined {
  const course = run.course as { course_uuid?: unknown } | null | undefined
  return typeof course?.course_uuid === 'string' ? course.course_uuid : undefined
}

function matches(run: TrailRun, course: CourseKey): boolean {
  if (typeof course === 'number') return run.course_id === course
  const uuid = course.startsWith('course_') ? course : `course_${course}`
  return runCourseUuid(run) === uuid
}

/** The trail run of one course, or null when the learner hasn't started it. */
export function findCourseRun(trail: Trail | null | undefined, course: CourseKey): TrailRun | null {
  return trail?.runs?.find((run) => matches(run, course)) ?? null
}

/**
 * A learner's progress through one course, read from their trail
 * (`lh.trail.getForOrg(orgId)`). No request is made.
 *
 * ```ts
 * const trail = await lh.trail.getForOrg(org.id)
 * const { percent, completed, total } = courseProgress(trail, 'course_…')
 * ```
 */
export function courseProgress(trail: Trail | null | undefined, course: CourseKey): CourseProgress {
  const run = findCourseRun(trail, course)
  if (!run) return { enrolled: false, completed: 0, total: 0, percent: 0, completedActivityIds: [], run: null }
  const ids = new Set<number>()
  // A step exists once an activity is completed (the web app counts them the same way).
  for (const step of run.steps ?? []) {
    if (typeof step.activity_id === 'number') ids.add(step.activity_id)
  }
  const total = typeof run.course_total_steps === 'number' && run.course_total_steps > 0 ? run.course_total_steps : 0
  const completed = ids.size
  const percent = total ? Math.min(100, Math.floor((completed / total) * 100)) : 0
  return { enrolled: true, completed, total, percent, completedActivityIds: [...ids], run }
}

/** Whether an activity (numeric id) is completed in a course, according to a trail. */
export function isActivityCompleted(trail: Trail | null | undefined, course: CourseKey, activityId: number): boolean {
  return courseProgress(trail, course).completedActivityIds.includes(activityId)
}
