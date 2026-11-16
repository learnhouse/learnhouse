import { computed, onScopeDispose, ref, shallowRef, toValue, watch } from 'vue'
import type { ComputedRef, MaybeRefOrGetter, Ref, ShallowRef } from 'vue'
import { AgentMessageBuilder, emptyAssistantMessage } from '@learnhouse/sdk'
import type {
  AgentEvent,
  AgentStream,
  Approval,
  Conversation,
  CreateConversationInput,
  LearnHouseClient,
  Message,
  PendingToolCall,
  SendMessageInput,
  ToolResultInput,
} from '@learnhouse/sdk'
import { useLearnHouseContext } from './provider'

export type AgentConversationStatus = 'idle' | 'loading' | 'streaming' | 'requires_action' | 'error'

export interface UseAgentConversationOptions {
  /** A client to use instead of the provider's. */
  client?: LearnHouseClient
  /** `atlas`, `copilot` or `agent_<uuid>`. Default `copilot`. */
  agent?: string
  /** Organization id; required with a member session (sent as `org_id` on create). */
  orgId?: number
  /** Open an existing conversation (reactive). */
  conversationId?: MaybeRefOrGetter<string | null | undefined>
  /** Options for the conversation created on the first `send()`. */
  create?: Omit<CreateConversationInput, 'agent'>
  onEvent?: (event: AgentEvent) => void
  /** Reconnect attempts after a dropped stream. Default 3. */
  reconnect?: number | false
}

export interface UseAgentConversationReturn {
  conversation: ShallowRef<Conversation | null>
  messages: ShallowRef<Message[]>
  status: Ref<AgentConversationStatus>
  error: ShallowRef<Error | null>
  pendingApprovals: ComputedRef<Approval[]>
  pendingToolCalls: ComputedRef<PendingToolCall[]>
  send: (input: string | SendMessageInput) => Promise<void>
  approve: (approvalId: string, phrase?: string) => Promise<void>
  deny: (approvalId: string, reason?: string) => Promise<void>
  cancel: () => Promise<void>
  submitToolResults: (results: ToolResultInput[]) => Promise<void>
}

/**
 * An Agent API conversation as Vue state, built on @learnhouse/sdk (no React):
 * messages fill in live as the agent streams. Render them however you like.
 */
export function useAgentConversation(options: UseAgentConversationOptions = {}): UseAgentConversationReturn {
  const context = useLearnHouseContext()
  const conversation = shallowRef<Conversation | null>(null)
  const messages = shallowRef<Message[]>([])
  const status = ref<AgentConversationStatus>('idle')
  const error = shallowRef<Error | null>(null)
  const builders = new Map<string, AgentMessageBuilder>()
  let stream: AgentStream | null = null
  let localId = 0

  const client = () => {
    const c = options.client ?? context?.client.value
    if (!c) throw new Error('useAgentConversation() needs <LearnHouseProvider> above it, or a `client` option')
    return c
  }
  const streamOptions = () => ({ reconnect: options.reconnect })

  function apply(event: AgentEvent): Message | null {
    let builder = builders.get(event.message_id)
    if (!builder) {
      let seed = messages.value.find((m) => m.id === event.message_id) ?? null
      if (!seed && event.type !== 'message.start') {
        // A short "waiting" answer (approval.resolved + message.done) updates
        // the message holding the approval; it never starts a blank one.
        const approvalId = 'approval_id' in event ? event.approval_id : undefined
        seed =
          (approvalId ? messages.value.find((m) => m.approvals.some((a) => a.id === approvalId)) : undefined) ??
          [...messages.value].reverse().find((m) => m.role === 'assistant') ??
          null
        if (!seed) return null
      }
      builder = new AgentMessageBuilder(seed)
      builders.set(event.message_id, builder)
    }
    const message = builder.apply(event)
    const list = messages.value
    const i = list.findIndex((m) => m.id === message.id)
    messages.value = i === -1 ? [...list, message] : [...list.slice(0, i), message, ...list.slice(i + 1)]
    return message
  }

  async function consume(next: AgentStream) {
    stream?.abort()
    stream = next
    status.value = 'streaming'
    error.value = null
    let last: Message | null = null
    try {
      for await (const event of next) {
        if (stream !== next) return
        options.onEvent?.(event)
        last = apply(event) ?? last
      }
      if (stream !== next) return
      if (last?.status === 'failed') {
        error.value = new Error(last.error?.message ?? 'The agent could not answer')
        status.value = 'error'
      } else {
        status.value = last?.status === 'requires_action' ? 'requires_action' : 'idle'
      }
    } catch (e) {
      if (stream !== next) return
      if ((e as Error)?.name === 'AbortError') {
        status.value = 'idle'
      } else {
        error.value = e as Error
        status.value = 'error'
      }
    } finally {
      if (stream === next) stream = null
    }
  }

  async function ensureConversation(): Promise<Conversation> {
    if (conversation.value) return conversation.value
    const orgId = options.create?.org_id ?? options.orgId
    const created = await client().agent.createConversation({
      ...options.create,
      ...(orgId !== undefined ? { org_id: orgId } : {}),
      agent: options.agent ?? 'copilot',
    })
    conversation.value = created
    return created
  }

  const guard = async (run: () => Promise<void>) => {
    try {
      await run()
    } catch (e) {
      error.value = e as Error
      status.value = 'error'
    }
  }

  async function send(input: string | SendMessageInput) {
    const content = typeof input === 'string' ? input : input.content
    if (!content.trim() || stream || status.value === 'streaming') return
    const local: Message = { ...emptyAssistantMessage(`local_${++localId}`), role: 'user', status: 'completed', text: content }
    messages.value = [...messages.value, local]
    status.value = 'streaming'
    await guard(async () => {
      const c = await ensureConversation()
      await consume(client().agent.streamMessage(c.id, input, streamOptions()))
    })
  }

  const approve = (approvalId: string, phrase?: string) =>
    guard(() => consume(client().agent.approve(approvalId, { ...streamOptions(), confirmationPhrase: phrase })))
  const deny = (approvalId: string, reason?: string) =>
    guard(() => consume(client().agent.deny(approvalId, { ...streamOptions(), reason })))
  const submitToolResults = (results: ToolResultInput[]) =>
    guard(async () => {
      if (conversation.value) await consume(client().agent.submitToolResults(conversation.value.id, results, streamOptions()))
    })
  const cancel = () =>
    guard(async () => {
      if (conversation.value) await client().agent.cancel(conversation.value.id)
    })

  watch(
    () => toValue(options.conversationId),
    async (id) => {
      if (!id || id === conversation.value?.id) return
      stream?.abort()
      stream = null
      builders.clear()
      status.value = 'loading'
      await guard(async () => {
        const api = client()
        const [c, list] = await Promise.all([api.agent.getConversation(id), api.agent.listMessages(id)])
        conversation.value = c
        messages.value = list
        if (c.status === 'running') await consume(api.agent.resume(id, streamOptions()))
        else status.value = c.status === 'requires_action' ? 'requires_action' : 'idle'
      })
    },
    { immediate: true },
  )
  onScopeDispose(() => stream?.abort())

  const pendingApprovals = computed(() => messages.value.flatMap((m) => m.approvals.filter((a) => a.status === 'pending')))
  const pendingToolCalls = computed<PendingToolCall[]>(() => {
    const last = [...messages.value].reverse().find((m) => m.role === 'assistant')
    if (!last || last.status !== 'requires_action') return []
    return last.tool_calls.filter((c) => c.client && c.ok === null).map((c) => ({ call_id: c.call_id, name: c.name, args: c.args ?? {} }))
  })

  return { conversation, messages, status, error, pendingApprovals, pendingToolCalls, send, approve, deny, cancel, submitToolResults }
}
