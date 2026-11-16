// Course-completion checks against the learner's trail.
//
// Trail runs carry the course as `run.course.course_uuid` and steps as
// `{ activity_id, complete }`. The activity page used to look for
// `run.course_uuid` and `step.activity_uuid`, which never exist, so it never
// saw a course as finished: `course_completed` was never sent and finishing
// the last open lesson out of order skipped the end page.

const clean = (uuid: unknown) => String(uuid ?? '').replace(/^course_/, '')

function findRun(trail: any, courseUuid: string): any | null {
  const key = clean(courseUuid)
  if (!key) return null
  const runs = Array.isArray(trail?.runs) ? trail.runs : []
  return runs.find((run: any) => clean(run?.course?.course_uuid ?? run?.course_uuid) === key) ?? null
}

function courseActivityIds(course: any): number[] {
  const ids: number[] = []
  for (const chapter of course?.chapters ?? []) {
    for (const activity of chapter?.activities ?? []) {
      if (typeof activity?.id === 'number') ids.push(activity.id)
    }
  }
  return ids
}

function completedIds(run: any): Set<number> {
  const done = new Set<number>()
  for (const step of run?.steps ?? []) {
    if (step?.complete === true && typeof step.activity_id === 'number') done.add(step.activity_id)
  }
  return done
}

/** True when every activity in the course is complete in this trail. */
export function isCourseComplete(trail: any, course: any): boolean {
  const ids = courseActivityIds(course)
  if (ids.length === 0) return false
  const run = findRun(trail, course?.course_uuid)
  if (!run) return false
  const done = completedIds(run)
  return ids.every((id) => done.has(id))
}

/**
 * True when marking `activityId` complete finishes the course: every other
 * activity is already complete. Works before the trail has a run for the
 * course (a one-activity course).
 */
export function willCompleteCourse(trail: any, course: any, activityId: number): boolean {
  const ids = courseActivityIds(course)
  if (!ids.includes(activityId)) return false
  const done = completedIds(findRun(trail, course?.course_uuid))
  return ids.every((id) => id === activityId || done.has(id))
}
