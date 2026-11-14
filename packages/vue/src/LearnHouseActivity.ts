import { Fragment, defineComponent, h, onBeforeUnmount, onMounted, ref, shallowRef, toRaw, watch, watchEffect } from 'vue'
import type { PropType, SlotsType, VNode } from 'vue'
import type {
  ActivityDocument,
  LearnHouseActivityData,
  LearnHouseEvent,
  LearnHouseTheme,
} from '@learnhouse/react'
import type { LearnHouseActivityElement, LearnHouseLinkClickDetail } from '@learnhouse/react/element'
import type { Activity, GetLearnHouseSession, LearnHouseSessionInput } from '@learnhouse/sdk'
import { useLearnHouseContext } from './provider'
import type { LinkTarget } from './provider'

type EventOf<T extends LearnHouseEvent['type']> = Extract<LearnHouseEvent, { type: T }>

const raw = <T>(value: T): T => (value && typeof value === 'object' ? toRaw(value) : value)

// The element (and React with it) loads in the browser only, after mount, so
// server rendering and the first paint never pay for it.
let elementModule: Promise<unknown> | null = null
const loadElement = () => (elementModule ??= import('@learnhouse/react/element'))

/**
 * Renders a LearnHouse activity (page, video, PDF, markdown, embed) with the
 * same blocks and styles as LearnHouse itself.
 *
 * Wraps @learnhouse/react's <learnhouse-activity> element: the blocks are the
 * React components of the LearnHouse web app, mounted in their own React root.
 */
export const LearnHouseActivity = defineComponent({
  name: 'LearnHouseActivity',
  props: {
    /** Activity uuid (`activity_…`). Fetched from the instance. */
    activityId: String,
    /** Look an activity up by its name inside `courseId` (case-insensitive). */
    activityName: String,
    /** Course uuid; needed with `activityName`, and gives media blocks their course. */
    courseId: String,
    /** An activity object you already fetched (e.g. with useActivity or @learnhouse/sdk). */
    activity: Object as PropType<LearnHouseActivityData | Activity>,
    /** A raw document to render, no network involved. */
    content: [Object, String] as PropType<ActivityDocument | string>,
    /** Base URL of the LearnHouse instance. Defaults to the provider's. */
    baseUrl: String,
    /**
     * The learner session, when this activity uses its own `baseUrl` (otherwise
     * the provider's session is shared). Never pass an `lh_` API token.
     */
    session: [String, Object] as PropType<LearnHouseSessionInput | null>,
    /** Fetches a new learner session from your server (with `session` / `baseUrl`). */
    getSession: Function as PropType<GetLearnHouseSession>,
    /** @deprecated Use `session`. */
    token: String,
    /** Org uuid for media URLs when rendering `content` without fetching. */
    orgId: String,
    /** Address of the LearnHouse site (not the API), used to link back to the activity. */
    siteUrl: String,
    theme: Object as PropType<LearnHouseTheme>,
    /** UI language of the blocks (`en`, `fr`, `ar`…). Defaults to the provider's, then `en`. */
    locale: String,
    /** Override UI strings, keyed like LearnHouse's locale files. */
    messages: Object as PropType<Record<string, any>>,
    dir: String as PropType<'ltr' | 'rtl' | 'auto'>,
    /** Node names to drop from the output. */
    hideBlocks: Array as PropType<string[]>,
    /** Where links open. Default `_blank`. */
    linkTarget: String as PropType<LinkTarget>,
    /** Emit `complete` when the end of the activity scrolls into view. */
    trackCompletion: Boolean,
    /**
     * How a signed-in learner completes the activity: `button` (default with a
     * session), `scroll` (when the end comes into view) or `none`.
     */
    completion: String as PropType<'button' | 'scroll' | 'none'>,
    /** Show the activity name above the content. */
    showTitle: Boolean,
    showPoweredBy: Boolean,
    /** Skip the root theming styles. */
    unstyled: Boolean,
    /** Rewrite the document before rendering (filter, annotate, inject). */
    transformContent: Function as PropType<(doc: ActivityDocument) => ActivityDocument>,
    /**
     * `@link-click`. Return `false` to stop the navigation (a prop rather than
     * an emit, so the return value counts).
     */
    onLinkClick: Function as PropType<(detail: LearnHouseLinkClickDetail) => boolean | void>,
  },
  emits: {
    load: (_activity: LearnHouseActivityData) => true,
    ready: () => true,
    complete: (_event: EventOf<'complete'>) => true,
    /** The learner's completion changed (saved to their progress). */
    progress: (_event: EventOf<'progress'>) => true,
    /** The session ran out and no new one could be fetched. */
    sessionExpired: (_event: EventOf<'session_expired'>) => true,
    media: (_event: EventOf<'media'>) => true,
    resize: (_event: EventOf<'resize'>) => true,
    error: (_error: Error) => true,
    /** Every event the renderer emits, link clicks and analytics included. */
    event: (_event: LearnHouseEvent) => true,
  },
  slots: Object as SlotsType<{
    /** Above the activity, once it has loaded. */
    header: { activity: LearnHouseActivityData }
    /** Below the activity, once it has loaded. */
    footer: { activity: LearnHouseActivityData }
    /** While the activity (or the renderer itself) is loading. */
    fallback: Record<string, never>
    /** Instead of the built-in error message. */
    error: { error: Error; retry: () => void }
  }>,
  setup(props, { slots, emit, expose }) {
    const context = useLearnHouseContext()
    const element = shallowRef<LearnHouseActivityElement | null>(null)
    const status = ref<'loading' | 'ready' | 'error'>('loading')
    const activity = shallowRef<LearnHouseActivityData | null>(null)
    const error = shallowRef<Error | null>(null)

    watch(
      () => [props.activityId, props.activityName, props.courseId, props.activity, props.content],
      () => {
        status.value = 'loading'
      },
    )

    const reload = () => {
      status.value = 'loading'
      element.value?.reload()
    }

    const listeners: Record<string, (event: CustomEvent) => void> = {
      'lh-load': (e) => {
        activity.value = e.detail.activity
        status.value = 'ready'
        emit('load', e.detail.activity)
      },
      'lh-error': (e) => {
        error.value = e.detail.error
        status.value = 'error'
        emit('error', e.detail.error)
      },
      'lh-ready': () => emit('ready'),
      'lh-complete': (e) => emit('complete', e.detail),
      'lh-progress': (e) => emit('progress', e.detail),
      'lh-session-expired': (e) => emit('sessionExpired', e.detail),
      'lh-media': (e) => emit('media', e.detail),
      'lh-resize': (e) => emit('resize', e.detail),
      'lh-event': (e) => {
        emit('event', e.detail)
        context?.options.value.onEvent?.(e.detail)
      },
      'lh-link-click': (e) => {
        if (props.onLinkClick?.(e.detail) === false) e.preventDefault()
      },
    }

    let stopSync: (() => void) | undefined

    onMounted(async () => {
      const el = element.value!
      for (const [type, fn] of Object.entries(listeners)) el.addEventListener(type, fn as EventListener)
      await loadElement()
      // Unmounted while the renderer was loading.
      if (!element.value) return
      stopSync = watchEffect(() => {
        const defaults = context?.options.value
        const ownInstance = !props.baseUrl || props.baseUrl === defaults?.baseUrl
        Object.assign(el, {
          activityId: props.activityId,
          activityName: props.activityName,
          courseId: props.courseId,
          activity: raw(props.activity) as LearnHouseActivityData | undefined,
          content: raw(props.content),
          orgId: props.orgId,
          baseUrl: props.baseUrl ?? defaults?.baseUrl,
          // The provider's client carries its session store; a separate
          // instance gets this component's own session.
          session: ownInstance ? undefined : props.session,
          getSession: ownInstance ? undefined : props.getSession,
          token: props.token ?? (ownInstance ? defaults?.token : undefined),
          getToken: ownInstance ? defaults?.getToken : undefined,
          // Share the provider's client (and its cache) when it's the same instance.
          client: ownInstance ? context?.client.value : undefined,
          mediaUrl: ownInstance ? defaults?.mediaUrl : undefined,
          siteUrl: props.siteUrl ?? defaults?.siteUrl,
          user: ownInstance ? raw(defaults?.user) : undefined,
          theme: defaults?.theme || props.theme ? { ...raw(defaults?.theme), ...raw(props.theme) } : undefined,
          locale: props.locale ?? defaults?.locale,
          messages: raw(props.messages ?? defaults?.messages),
          hideBlocks: raw(props.hideBlocks),
          linkTarget: props.linkTarget ?? defaults?.linkTarget,
          trackCompletion: props.trackCompletion,
          completion: props.completion,
          showTitle: props.showTitle,
          showPoweredBy: props.showPoweredBy,
          unstyled: props.unstyled,
          transformContent: props.transformContent,
          hideError: !!slots.error,
        })
        if (props.dir) el.setAttribute('dir', props.dir)
        else el.removeAttribute('dir')
      })
    })

    onBeforeUnmount(() => {
      stopSync?.()
      const el = element.value
      if (el) for (const [type, fn] of Object.entries(listeners)) el.removeEventListener(type, fn as EventListener)
      element.value = null
    })

    expose({ reload, element })

    // Keyed, so slots coming and going never re-create the element (and the
    // React root inside it).
    const slot = (key: string, nodes: VNode[]) => h(Fragment, { key }, nodes)

    return () => {
      const children: VNode[] = []
      const loaded = status.value === 'ready' && activity.value
      if (loaded && slots.header) children.push(slot('header', slots.header({ activity: activity.value! })))
      if (status.value === 'loading' && slots.fallback) children.push(slot('fallback', slots.fallback({})))
      if (status.value === 'error' && slots.error) children.push(slot('error', slots.error({ error: error.value!, retry: reload })))
      children.push(h('learnhouse-activity', { key: 'element', ref: element }))
      if (loaded && slots.footer) children.push(slot('footer', slots.footer({ activity: activity.value! })))
      return h('div', { class: 'lh-activity-vue' }, children)
    }
  },
})
