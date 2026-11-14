import { computed, defineComponent, inject, onScopeDispose, provide, toValue, watch } from 'vue'
import type { ComputedRef, InjectionKey, MaybeRefOrGetter, PropType, SlotsType } from 'vue'
import { SessionStore, createClient } from '@learnhouse/sdk'
import type { GetLearnHouseSession, LearnHouseClient, LearnHouseSessionInput } from '@learnhouse/sdk'
import type { LearnHouseEvent, LearnHouseTheme } from '@learnhouse/react'

export type LinkTarget = '_blank' | '_self' | '_parent' | '_top'

export interface LearnHouseOptions {
  /** Base URL of the LearnHouse instance, e.g. `https://learn.acme.com`. */
  baseUrl: string
  /**
   * The learner session: an embed session minted on your server with
   * `client.embed.createSession()` (the object, or its `access_token`).
   * Without one, activities are read-only and anonymous. Never pass an `lh_`
   * API token to the browser.
   */
  session?: LearnHouseSessionInput | null
  /** Fetches a new learner session from your server before the current one expires. */
  getSession?: GetLearnHouseSession
  /** @deprecated Use `session`. A user access token. */
  token?: string
  /** @deprecated Use `getSession`. Called on each request for a user access token. */
  getToken?: () => string | null | undefined | Promise<string | null | undefined>
  /** Where media is served from, if not the instance itself (CDN, S3). */
  mediaUrl?: string
  /** Address of the LearnHouse site (not the API), used to link back to activities. */
  siteUrl?: string
  /** Bring your own @learnhouse/sdk client (shared cache, custom fetch, hooks). */
  client?: LearnHouseClient
  /** The signed-in user, for blocks that personalise (user block, dynamic variables). */
  user?: Record<string, any>
  /** Defaults for every <LearnHouseActivity> below. */
  theme?: LearnHouseTheme
  locale?: string
  messages?: Record<string, any>
  linkTarget?: LinkTarget
  /** Every event of every activity below. */
  onEvent?: (event: LearnHouseEvent) => void
}

export interface LearnHouseContext {
  options: ComputedRef<LearnHouseOptions>
  client: ComputedRef<LearnHouseClient>
  /** The learner session every activity below shares (one refresh for all). */
  sessionStore: SessionStore
}

export const LEARNHOUSE_KEY: InjectionKey<LearnHouseContext> = Symbol('learnhouse')

/**
 * Makes a client and activity defaults available to every component below the
 * caller. <LearnHouseProvider> calls this; you can too, in a root component's
 * setup().
 */
export function provideLearnHouse(options: MaybeRefOrGetter<LearnHouseOptions>): LearnHouseContext {
  const resolved = computed(() => toValue(options))
  // Only these make a new client; theme or locale changes keep the old one.
  const own = computed(() => resolved.value.client)
  const baseUrl = computed(() => resolved.value.baseUrl)
  const mediaUrl = computed(() => resolved.value.mediaUrl)
  const initial = resolved.value
  const usesSessions = initial.session !== undefined || !!initial.getSession
  // One store for the provider: every activity below reads the same session,
  // and getSession runs once per renewal however many activities there are.
  const sessionStore = new SessionStore(
    initial.session ?? initial.token ?? null,
    initial.getSession ? () => resolved.value.getSession?.() : undefined,
  )
  watch(
    () => {
      const s = resolved.value.session ?? resolved.value.token
      return s === undefined ? undefined : typeof s === 'string' ? s : (s?.access_token ?? null)
    },
    (key, old) => {
      if (key !== old && key !== undefined) sessionStore.set(resolved.value.session ?? resolved.value.token)
    },
  )
  watch(
    () => !!resolved.value.getSession,
    (has) => sessionStore.setSource(has ? () => resolved.value.getSession?.() : undefined),
  )
  onScopeDispose(() => sessionStore.dispose())

  const client = computed(() => {
    if (own.value) return own.value
    // Legacy getToken: asked on each request, as before.
    if (!usesSessions && initial.token === undefined && resolved.value.getToken) {
      return createClient({
        baseUrl: baseUrl.value,
        mediaUrl: mediaUrl.value,
        getToken: async () => (await resolved.value.getToken?.()) ?? null,
      })
    }
    return createClient({ baseUrl: baseUrl.value, mediaUrl: mediaUrl.value, sessionStore })
  })
  const context = { options: resolved, client, sessionStore }
  provide(LEARNHOUSE_KEY, context)
  return context
}

export const useLearnHouseContext = () => inject(LEARNHOUSE_KEY, null)

/** The @learnhouse/sdk client of the nearest provider, for your own API calls. */
export function useLearnHouseClient(): LearnHouseClient {
  const context = useLearnHouseContext()
  if (!context) throw new Error('useLearnHouseClient() must be used below <LearnHouseProvider> or provideLearnHouse()')
  return context.client.value
}

/** Shares one client, one session and the same defaults with every activity below. */
export const LearnHouseProvider = defineComponent({
  name: 'LearnHouseProvider',
  props: {
    baseUrl: { type: String, required: true },
    session: [String, Object] as PropType<LearnHouseSessionInput | null>,
    getSession: Function as PropType<GetLearnHouseSession>,
    token: String,
    getToken: Function as PropType<LearnHouseOptions['getToken']>,
    mediaUrl: String,
    siteUrl: String,
    client: Object as PropType<LearnHouseClient>,
    user: Object as PropType<Record<string, any>>,
    theme: Object as PropType<LearnHouseTheme>,
    locale: String,
    messages: Object as PropType<Record<string, any>>,
    linkTarget: String as PropType<LinkTarget>,
  },
  emits: {
    event: (_event: LearnHouseEvent) => true,
  },
  slots: Object as SlotsType<{ default: Record<string, never> }>,
  setup(props, { slots, emit }) {
    provideLearnHouse(() => ({ ...props, onEvent: (event: LearnHouseEvent) => emit('event', event) }))
    return () => slots.default?.({})
  },
})
