import { defineComponent, h, onBeforeUnmount, onMounted, shallowRef, toRaw, watchEffect } from 'vue'
import type { PropType } from 'vue'
import type { LearnHouseAgentChatElement } from '@learnhouse/react/element'
import type { AgentEvent, Conversation, CreateConversationInput, LearnHouseClient, LearnHouseSessionInput } from '@learnhouse/sdk'
import { useLearnHouseContext } from './provider'
import type { LinkTarget } from './provider'

const raw = <T>(value: T): T => (value && typeof value === 'object' ? toRaw(value) : value)

let elementModule: Promise<unknown> | null = null
const loadElement = () => (elementModule ??= import('@learnhouse/react/element'))

/**
 * A ready-made Agent API chat (Atlas, the learner copilot, custom agents):
 * messages, composer, approval cards, citations and views.
 *
 * Wraps @learnhouse/react's <learnhouse-agent-chat> element, like
 * <LearnHouseActivity> wraps <learnhouse-activity>.
 */
export const AgentChat = defineComponent({
  name: 'AgentChat',
  props: {
    /** API origin. Defaults to the provider's. */
    baseUrl: String,
    /** A member session JWT or an embed session token. Never an `lh_` API token. */
    token: String,
    /** An embed session (object or token), when not using the provider's. */
    session: [String, Object] as PropType<LearnHouseSessionInput | null>,
    /** A @learnhouse/sdk client to use instead of the provider's. */
    client: Object as PropType<LearnHouseClient>,
    /** `atlas`, `copilot` or `agent_<uuid>`. Default `copilot`. */
    agent: String,
    /** Organization id; required with a member session (sent as `org_id`). */
    orgId: [Number, String] as PropType<number | string>,
    /** Open an existing conversation. */
    conversationId: String,
    /** Options for the conversation created on the first message. */
    create: Object as PropType<Omit<CreateConversationInput, 'agent'>>,
    /** Address of the LearnHouse site, so citations become links. Defaults to the provider's. */
    siteUrl: String,
    placeholder: String,
    theme: String as PropType<'light' | 'dark' | 'auto'>,
    linkTarget: String as PropType<LinkTarget>,
    starters: Array as PropType<string[]>,
    greeting: String,
    labels: Object as PropType<Record<string, string>>,
  },
  emits: {
    /** Every stream event. */
    event: (_event: AgentEvent) => true,
    /** A conversation was created or loaded. */
    conversation: (_conversation: Conversation) => true,
    error: (_error: Error) => true,
  },
  setup(props, { emit, expose }) {
    const context = useLearnHouseContext()
    const element = shallowRef<LearnHouseAgentChatElement | null>(null)
    const listeners: Record<string, (event: CustomEvent) => void> = {
      'lh-agent-event': (e) => emit('event', e.detail),
      'lh-agent-conversation': (e) => emit('conversation', e.detail),
      'lh-agent-error': (e) => emit('error', e.detail),
    }
    let stopSync: (() => void) | undefined

    onMounted(async () => {
      const el = element.value!
      for (const [type, fn] of Object.entries(listeners)) el.addEventListener(type, fn as EventListener)
      await loadElement()
      if (!element.value) return
      stopSync = watchEffect(() => {
        const defaults = context?.options.value
        const ownInstance = !props.baseUrl || props.baseUrl === defaults?.baseUrl
        Object.assign(el, {
          baseUrl: props.baseUrl ?? defaults?.baseUrl,
          token: props.token,
          session: props.session ?? undefined,
          // The provider's client carries its session; a separate instance gets its own.
          client: props.client ?? (ownInstance && !props.token && !props.session ? context?.client.value : undefined),
          agent: props.agent,
          orgId: props.orgId === undefined || props.orgId === '' ? undefined : Number(props.orgId),
          conversationId: props.conversationId,
          create: raw(props.create),
          siteUrl: props.siteUrl ?? defaults?.siteUrl,
          placeholder: props.placeholder,
          theme: props.theme,
          linkTarget: props.linkTarget ?? defaults?.linkTarget,
          starters: raw(props.starters),
          greeting: props.greeting,
          labels: raw(props.labels),
        })
      })
    })

    onBeforeUnmount(() => {
      stopSync?.()
      const el = element.value
      if (el) for (const [type, fn] of Object.entries(listeners)) el.removeEventListener(type, fn as EventListener)
      element.value = null
    })

    expose({ element })
    return () => h('learnhouse-agent-chat', { ref: element, class: 'lh-agent-vue' })
  },
})
