import { useCallback, useEffect, useMemo, useState } from 'react'
import { courseProgress } from '@learnhouse/sdk'
import type { CourseKey, CourseProgress, Trail, TrailStore, TrailStoreState } from '@learnhouse/sdk'
import { useLearnHouseInternal } from './context'

const IDLE: TrailStoreState = { trail: undefined, loading: false, error: null }

function useStore(): TrailStore {
  const { trailStore } = useLearnHouseInternal()
  if (!trailStore) throw new Error('LearnHouse progress hooks must be used inside <LearnHouseProvider>')
  return trailStore
}

/** The store's state for one org, re-rendering on change; loads it on first use. */
function useTrailState(store: TrailStore, orgId: number | null | undefined, signedIn: boolean): TrailStoreState {
  const [state, setState] = useState<TrailStoreState>(() => (orgId == null ? IDLE : store.get(orgId)))
  useEffect(() => {
    if (orgId == null) {
      setState(IDLE)
      return
    }
    setState(store.get(orgId))
    const off = store.subscribe((org) => {
      if (org !== orgId) return
      const next = store.get(orgId)
      setState(next)
      // Cleared (another learner signed in): load it again for them.
      if (signedIn && next.trail === undefined && !next.loading) void store.load(orgId)
    })
    if (signedIn) void store.load(orgId)
    return off
  }, [store, orgId, signedIn])
  return state
}

export interface UseTrailReturn {
  /** `undefined` while loading the first time, `null` when signed out or unavailable. */
  trail: Trail | null | undefined
  loading: boolean
  error: Error | null
  /** Load it again from the API. */
  refresh: () => Promise<Trail | null>
}

/**
 * The signed-in learner's trail (enrolled courses and completed activities)
 * in one org, shared with every other progress hook and completion button
 * under the same provider. `orgId` may be null until you know it.
 */
export function useTrail(orgId: number | null | undefined): UseTrailReturn {
  const store = useStore()
  const { session } = useLearnHouseInternal()
  const signedIn = session.status === 'authenticated'
  const state = useTrailState(store, orgId, signedIn)
  const refresh = useCallback(
    () => (orgId == null ? Promise.resolve(null) : store.load(orgId, { force: true })),
    [store, orgId],
  )
  // While the session is still being fetched, report "not loaded" rather than "signed out".
  const trail = session.status === 'unauthenticated' ? null : session.status === 'loading' ? undefined : state.trail
  return { trail, loading: state.loading || session.status === 'loading', error: state.error, refresh }
}

export interface UseCourseProgressReturn {
  /** `null` until the trail is loaded (or when signed out). */
  progress: CourseProgress | null
  loading: boolean
  error: Error | null
  /** Enroll the learner (no-op when already enrolled). Needs a full sign-in: embed sessions can't enroll. */
  enroll: () => Promise<void>
  /** Leave the course: removes its progress. */
  leave: () => Promise<void>
  /** Mark an activity complete / not complete (by uuid). */
  complete: (activityUuid: string) => Promise<void>
  uncomplete: (activityUuid: string) => Promise<void>
  /** Whether an activity (numeric id) is completed. */
  isCompleted: (activityId: number) => boolean
  refresh: () => Promise<void>
}

/**
 * Progress through one course, with the actions that change it. `course` is
 * the course's numeric id or uuid; enrolling and leaving need its uuid.
 *
 * ```tsx
 * const { progress, enroll } = useCourseProgress(org.id, 'course_…')
 * if (progress && !progress.enrolled) return <button onClick={enroll}>Start</button>
 * return <Meter value={progress?.percent ?? 0} />
 * ```
 */
export function useCourseProgress(orgId: number | null | undefined, course: CourseKey | null | undefined): UseCourseProgressReturn {
  const store = useStore()
  const { trail, loading, error, refresh } = useTrail(orgId)
  const progress = useMemo(
    () => (trail == null || course == null ? null : courseProgress(trail, course)),
    [trail, course],
  )

  const need = useCallback(() => {
    if (orgId == null) throw new Error('useCourseProgress: orgId is not known yet')
    return orgId
  }, [orgId])
  const courseUuid = useCallback(() => {
    if (typeof course !== 'string') throw new Error('useCourseProgress: enroll/leave need the course uuid')
    return course.startsWith('course_') ? course : `course_${course}`
  }, [course])

  const enroll = useCallback(async () => {
    const org = need()
    const uuid = courseUuid()
    if (progress?.enrolled) return
    await store.enroll(org, uuid)
  }, [store, need, courseUuid, progress?.enrolled])
  const leave = useCallback(async () => {
    await store.leave(need(), courseUuid())
  }, [store, need, courseUuid])
  const complete = useCallback(
    async (activityUuid: string) => {
      await store.complete(need(), activityUuid)
    },
    [store, need],
  )
  const uncomplete = useCallback(
    async (activityUuid: string) => {
      await store.uncomplete(need(), activityUuid)
    },
    [store, need],
  )
  const isCompleted = useCallback((activityId: number) => !!progress?.completedActivityIds.includes(activityId), [progress])
  const reload = useCallback(async () => {
    await refresh()
  }, [refresh])

  return { progress, loading, error, enroll, leave, complete, uncomplete, isCompleted, refresh: reload }
}
