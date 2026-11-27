import { computed, onScopeDispose, ref, shallowRef, toValue, watch } from 'vue'
import type { ComputedRef, MaybeRefOrGetter, Ref, ShallowRef } from 'vue'
import { courseProgress } from '@learnhouse/sdk'
import type { Activity, CourseKey, CourseProgress, LearnHouseClient, Trail, TrailStore } from '@learnhouse/sdk'
import { useLearnHouseContext } from './provider'

export interface UseActivityOptions {
  /** A client to use instead of the provider's. */
  client?: LearnHouseClient
}

export interface UseActivityReturn {
  activity: ShallowRef<Activity | null>
  error: ShallowRef<Error | null>
  loading: Ref<boolean>
  /** Fetch again. */
  refresh: () => Promise<void>
}

/**
 * Fetches an activity (with its content) through @learnhouse/sdk, and again
 * whenever `id` changes. Pass the result to <LearnHouseActivity :activity>.
 */
export function useActivity(id: MaybeRefOrGetter<string | null | undefined>, options: UseActivityOptions = {}): UseActivityReturn {
  const context = useLearnHouseContext()
  const activity = shallowRef<Activity | null>(null)
  const error = shallowRef<Error | null>(null)
  const loading = ref(false)
  let controller: AbortController | null = null

  async function refresh() {
    controller?.abort()
    const uuid = toValue(id)
    if (!uuid) {
      activity.value = null
      loading.value = false
      return
    }
    const client = options.client ?? context?.client.value
    if (!client) {
      error.value = new Error('useActivity() needs <LearnHouseProvider> above it, or a `client` option')
      return
    }
    const current = (controller = new AbortController())
    loading.value = true
    error.value = null
    try {
      const result = await client.activities.get(uuid, { signal: current.signal })
      if (!current.signal.aborted) activity.value = result
    } catch (e) {
      if (!current.signal.aborted) {
        activity.value = null
        error.value = e as Error
      }
    } finally {
      if (!current.signal.aborted) loading.value = false
    }
  }

  watch(() => [toValue(id), options.client ?? context?.client.value], refresh, { immediate: true })
  onScopeDispose(() => controller?.abort())

  return { activity, error, loading, refresh }
}

// ── Progress ───────────────────────────────────────────────────────────────

export interface UseTrailReturn {
  /** `undefined` until loaded, `null` when signed out or unavailable. */
  trail: ShallowRef<Trail | null | undefined>
  loading: Ref<boolean>
  error: ShallowRef<Error | null>
  /** Load it again from the API. */
  refresh: () => Promise<Trail | null>
}


/**
 * The signed-in learner's trail (enrolled courses, completed activities) in
 * one org, shared with every other progress composable under the provider and
 * kept in step with activities' own "Mark as complete" buttons.
 */
export function useTrail(orgId: MaybeRefOrGetter<number | null | undefined>): UseTrailReturn {
  const context = useLearnHouseContext()
  if (!context) throw new Error('LearnHouse progress composables need <LearnHouseProvider> or provideLearnHouse() above them')
  const trail = shallowRef<Trail | null | undefined>(undefined)
  const loading = ref(false)
  const error = shallowRef<Error | null>(null)
  let off: (() => void) | null = null

  watch(
    () => [toValue(orgId), context.trailStore.value] as const,
    ([org, store]) => {
      off?.()
      off = null
      if (org == null) {
        trail.value = undefined
        loading.value = false
        error.value = null
        return
      }
      const sync = () => {
        const state = store.get(org)
        trail.value = state.trail
        loading.value = state.loading
        error.value = state.error
        return state
      }
      off = store.subscribe((changed) => {
        if (changed !== org) return
        const state = sync()
        // Cleared for another learner: load theirs.
        if (state.trail === undefined && !state.loading) void store.load(org)
      })
      sync()
      void store.load(org)
    },
    { immediate: true },
  )
  onScopeDispose(() => off?.())

  const refresh = () => {
    const org = toValue(orgId)
    return org == null ? Promise.resolve(null) : context.trailStore.value.load(org, { force: true })
  }
  return { trail, loading, error, refresh }
}

export interface UseCourseProgressReturn {
  /** `null` until the trail is loaded (or when signed out). */
  progress: ComputedRef<CourseProgress | null>
  loading: Ref<boolean>
  error: ShallowRef<Error | null>
  /** Enroll the learner (no-op when already enrolled). Embed sessions can't enroll. */
  enroll: () => Promise<void>
  /** Leave the course: removes its progress. */
  leave: () => Promise<void>
  complete: (activityUuid: string) => Promise<void>
  uncomplete: (activityUuid: string) => Promise<void>
  /** Whether an activity (numeric id) is completed. */
  isCompleted: (activityId: number) => boolean
  refresh: () => Promise<void>
}

/**
 * Progress through one course (its numeric id or uuid), with the actions
 * that change it. Enrolling and leaving need the uuid.
 */
export function useCourseProgress(
  orgId: MaybeRefOrGetter<number | null | undefined>,
  course: MaybeRefOrGetter<CourseKey | null | undefined>,
): UseCourseProgressReturn {
  const { trail, loading, error, refresh } = useTrail(orgId)
  const context = useLearnHouseContext()!
  const progress = computed(() => {
    const key = toValue(course)
    return trail.value == null || key == null ? null : courseProgress(trail.value, key)
  })
  const org = () => {
    const id = toValue(orgId)
    if (id == null) throw new Error('useCourseProgress: orgId is not known yet')
    return id
  }
  const courseUuid = () => {
    const key = toValue(course)
    if (typeof key !== 'string') throw new Error('useCourseProgress: enroll/leave need the course uuid')
    return key.startsWith('course_') ? key : `course_${key}`
  }
  return {
    progress,
    loading,
    error,
    async enroll() {
      const id = org()
      const uuid = courseUuid()
      if (progress.value?.enrolled) return
      await storeFor(id).enroll(id, uuid)
    },
    async leave() {
      const id = org()
      await storeFor(id).leave(id, courseUuid())
    },
    async complete(activityUuid: string) {
      const id = org()
      await storeFor(id).complete(id, activityUuid)
    },
    async uncomplete(activityUuid: string) {
      const id = org()
      await storeFor(id).uncomplete(id, activityUuid)
    },
    isCompleted: (activityId: number) => !!progress.value?.completedActivityIds.includes(activityId),
    async refresh() {
      await refresh()
    },
  }

  // The provider's store at call time (it changes with the client).
  function storeFor(_org: number): TrailStore {
    return context.trailStore.value
  }
}
