import { onScopeDispose, ref, shallowRef, toValue, watch } from 'vue'
import type { MaybeRefOrGetter, Ref, ShallowRef } from 'vue'
import type { Activity, LearnHouseClient } from '@learnhouse/sdk'
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
