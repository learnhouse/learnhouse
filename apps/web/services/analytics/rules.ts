/**
 * Pure rules for org analytics collection, kept free of React so they can be
 * unit tested on their own.
 */

// Dashboard, editor and super-admin pages are staff at work, not traffic.
const STAFF_PATH = /(^|\/)(dash|editor)(\/|$)|^\/admin(\/|$)/

/** Whether a page view on `pathname` counts toward an org's traffic. */
export function isTrackedPagePath(pathname: string): boolean {
  return !STAFF_PATH.test(pathname)
}

export const VIDEO_MILESTONES = [25, 50, 75, 100] as const

/** Video progress milestones reached at `currentTime` that aren't in `fired` yet. */
export function reachedMilestones(currentTime: number, duration: number, fired: ReadonlySet<number>): number[] {
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(currentTime)) return []
  // Players rarely report the exact last frame; within a second of the end
  // (or 99%) counts as finished.
  const raw = (currentTime / duration) * 100
  const percent = currentTime >= duration - 1 || raw >= 99 ? 100 : raw
  return VIDEO_MILESTONES.filter((m) => !fired.has(m) && percent >= m)
}

/**
 * Milestones per playable item (e.g. podcast episodes in one player), each
 * reported at most once per item for the tracker's lifetime.
 */
export function createMilestoneTracker() {
  const fired = new Map<string, Set<number>>()
  return {
    /** Milestones `key` reaches at `currentTime` that weren't reported yet; marks them reported. */
    reached(key: string, currentTime: number, duration: number): number[] {
      let done = fired.get(key)
      if (!done) {
        done = new Set()
        fired.set(key, done)
      }
      const reached = reachedMilestones(currentTime, duration, done)
      for (const m of reached) done.add(m)
      return reached
    },
  }
}
