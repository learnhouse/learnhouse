// Numbers the Progress page shows, computed from the trail the learner
// already loads (runs + completed steps with their timestamps). No extra API.

// The API stores "2026-11-04 22:54:15.878736"; Safari needs the "T".
export function parseTrailDate(value?: string | null): Date | null {
  if (!value) return null
  const d = new Date(String(value).replace(' ', 'T'))
  return isNaN(d.getTime()) ? null : d
}

export function dayKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export type RunSummary = {
  run: any
  course: any
  courseUuid: string
  done: number
  total: number
  percent: number
  completed: boolean
  lastActive: Date | null
}

export function summarizeRuns(trail: any): RunSummary[] {
  const runs: any[] = Array.isArray(trail?.runs) ? trail.runs : []
  return runs
    .filter((run) => run?.course?.course_uuid)
    .map((run) => {
      const steps: any[] = Array.isArray(run.steps) ? run.steps : []
      const done = steps.filter((s) => s?.complete !== false).length
      const total = Number(run.course_total_steps) || 0
      const percent = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0
      const stamps = [run.update_date, run.creation_date, ...steps.map((s) => s?.update_date || s?.creation_date)]
        .map(parseTrailDate)
        .filter(Boolean) as Date[]
      return {
        run,
        course: run.course,
        courseUuid: String(run.course.course_uuid),
        done,
        total,
        percent,
        completed: total > 0 && done >= total,
        lastActive: stamps.length ? new Date(Math.max(...stamps.map((d) => d.getTime()))) : null,
      }
    })
}

// Completed activities per local day, for the activity chart and streak.
export function activityByDay(trail: any): Map<string, number> {
  const map = new Map<string, number>()
  for (const run of Array.isArray(trail?.runs) ? trail.runs : []) {
    for (const step of Array.isArray(run?.steps) ? run.steps : []) {
      if (step?.complete === false) continue
      const d = parseTrailDate(step?.creation_date)
      if (!d) continue
      const key = dayKey(d)
      map.set(key, (map.get(key) ?? 0) + 1)
    }
  }
  return map
}

// Consecutive days with at least one completed activity, ending today (or
// yesterday, so the streak doesn't read 0 before the learner's first lesson
// of the day).
export function learningStreak(byDay: Map<string, number>, today = new Date()): number {
  const cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  if (!byDay.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1)
  let streak = 0
  while (byDay.has(dayKey(cursor))) {
    streak += 1
    cursor.setDate(cursor.getDate() - 1)
  }
  return streak
}
