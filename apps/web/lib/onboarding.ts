/**
 * Onboarding helpers shared by the useOnboarding hook, its data signals and
 * the launch plan. Kept free of React so the rules can be unit tested.
 */

export type OnboardingProgress = {
  completedSteps: string[]
  skippedSteps: string[]
  // Steps whose completion has been shown to the admin.
  celebrated: string[]
  // True once the org's existing data has been read the first time.
  seeded: boolean
}

/**
 * Applies the steps the org's data says are done. The first read seeds:
 * whatever the org already had (courses made before onboarding existed)
 * completes silently, and only later completions are left to celebrate.
 * Returns `prev` itself when nothing changes, so callers can skip a save.
 */
export function applySignals<T extends OnboardingProgress>(prev: T, doneIds: string[]): T {
  const fresh = doneIds.filter((id) => !prev.completedSteps.includes(id))
  if (!fresh.length && prev.seeded) return prev
  return {
    ...prev,
    seeded: true,
    completedSteps: [...prev.completedSteps, ...fresh],
    celebrated: prev.seeded ? prev.celebrated : [...prev.celebrated, ...fresh],
  }
}

/** Steps the admin finished (not skipped) that haven't been celebrated yet. */
export function pendingCelebrations(state: OnboardingProgress): string[] {
  return state.completedSteps.filter((id) => !state.celebrated.includes(id) && !state.skippedSteps.includes(id))
}

/** Where the plan stands: the first open step, overall progress and time left. */
export function summarize(steps: { completed: boolean; minutes: number }[]) {
  const currentStepIndex = steps.findIndex((s) => !s.completed)
  const done = steps.filter((s) => s.completed).length
  return {
    currentStepIndex,
    allCompleted: done === steps.length,
    progress: steps.length > 0 ? done / steps.length : 0,
    minutesLeft: steps.filter((s) => !s.completed).reduce((n, s) => n + s.minutes, 0),
  }
}

export type OnboardingSignalData = {
  courseCount: number
  hasLesson: boolean
  hasLogo: boolean
  memberCount: number
  inviteCount: number
  communityCount: number
}

/** Which steps the org's data satisfies: the thing exists, not "the page was opened". */
export function stepsDoneFromData(d: OnboardingSignalData): string[] {
  const done: Record<string, boolean> = {
    create_course: d.courseCount > 0,
    add_content: d.hasLesson,
    brand_school: d.hasLogo,
    // The admin is the first member; anyone else, or a pending invite, counts.
    invite_learners: d.memberCount > 1 || d.inviteCount > 0,
    build_community: d.communityCount > 0,
  }
  return Object.keys(done).filter((k) => done[k])
}

const EMAIL_RE = /[A-Z0-9._%+'-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi

/** Every distinct email address in free text or a CSV export, lower-cased, in order. */
export function extractEmails(text: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const m of text.match(EMAIL_RE) ?? []) {
    const e = m.toLowerCase()
    if (!seen.has(e)) {
      seen.add(e)
      out.push(e)
    }
  }
  return out
}

/** Free days left before a date (ISO), never negative; null when unknown. */
export function daysUntil(iso: string | null | undefined, now = Date.now()): number | null {
  if (!iso) return null
  const ms = new Date(iso).getTime() - now
  return Number.isFinite(ms) ? Math.max(0, Math.ceil(ms / 86_400_000)) : null
}
