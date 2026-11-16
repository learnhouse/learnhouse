import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AgentMessageBuilder, createClient, emptyAssistantMessage } from '@learnhouse/sdk'
import type {
  Agent,
  AgentEvent,
  AgentStream,
  Approval,
  Conversation,
  LearnHouseClient,
  Message,
  PendingToolCall,
  SendMessageInput,
  ToolResultInput,
} from '@learnhouse/sdk'
import { useLearnHouseInternal } from '../context'
import type { AgentChatStatus, UseAgentConversationOptions, UseAgentConversationReturn } from './types'

const isAbort = (e: unknown) => !!e && typeof e === 'object' && (e as { name?: unknown }).name === 'AbortError'
const asError = (e: unknown) => (e instanceof Error ? e : new Error(String(e)))

function lastAssistant(messages: Message[]): Message | undefined {
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === 'assistant') return messages[i]
  return undefined
}

function pendingToolCallsOf(messages: Message[]): PendingToolCall[] {
  const last = lastAssistant(messages)
  if (!last || last.status !== 'requires_action') return []
  return last.tool_calls
    .filter((c) => c.client && c.ok === null)
    .map((c) => ({ call_id: c.call_id, name: c.name, args: c.args ?? {} }))
}

function pendingApprovalsOf(messages: Message[]): Approval[] {
  const out: Approval[] = []
  for (const m of messages) for (const a of m.approvals) if (a.status === 'pending') out.push(a)
  return out
}

/**
 * One Agent API conversation as React state: messages that fill in live while
 * the agent streams (text, views, citations, approvals), plus the actions to
 * drive it. Dropped streams are resumed from the last event id.
 *
 * ```tsx
 * const chat = useAgentConversation({ baseUrl, token, agent: 'copilot' })
 * chat.messages.map((m) => <Bubble key={m.id} message={m} />)
 * chat.send('What should I study next?')
 * ```
 */
export function useAgentConversation(options: UseAgentConversationOptions = {}): UseAgentConversationReturn {
  const internal = useLearnHouseInternal()
  const optsRef = useRef(options)
  optsRef.current = options

  const sessionKey = typeof options.session === 'string' ? options.session : (options.session?.access_token ?? null)
  const client: LearnHouseClient | null = useMemo(() => {
    if (options.client) return options.client
    if (options.baseUrl) {
      return options.session
        ? createClient({ baseUrl: options.baseUrl, session: options.session })
        : createClient({ baseUrl: options.baseUrl, token: options.token })
    }
    return internal.client ?? null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.client, options.baseUrl, options.token, sessionKey, internal.client])
  const clientRef = useRef(client)
  clientRef.current = client

  const [conversation, setConversation] = useState<Conversation | null>(null)
  const [agent, setAgent] = useState<Agent | null>(null)
  const [messages, setMessagesState] = useState<Message[]>([])
  const [status, setStatus] = useState<AgentChatStatus>(options.conversationId ? 'loading' : 'idle')
  const [error, setError] = useState<Error | null>(null)
  const [reconnecting, setReconnecting] = useState(false)

  const conversationRef = useRef<Conversation | null>(null)
  const messagesRef = useRef<Message[]>([])
  const buildersRef = useRef(new Map<string, AgentMessageBuilder>())
  const streamRef = useRef<AgentStream | null>(null)
  const creatingRef = useRef<Promise<Conversation> | null>(null)
  const resultsRef = useRef(new Map<string, ToolResultInput>())
  const aliveRef = useRef(true)
  const localId = useRef(0)
  const busyRef = useRef(false)

  const commit = useCallback((next: Message[]) => {
    messagesRef.current = next
    setMessagesState(next)
  }, [])

  const setConv = useCallback((c: Conversation | null) => {
    conversationRef.current = c
    setConversation(c)
  }, [])

  const requireClient = () => {
    const c = clientRef.current
    if (!c) throw new Error('useAgentConversation() needs a `client`, a `baseUrl`, or a <LearnHouseProvider> above it')
    return c
  }

  const fail = useCallback((e: unknown) => {
    const err = asError(e)
    setError(err)
    setReconnecting(false)
    setStatus(pendingApprovalsOf(messagesRef.current).length ? 'requires_action' : 'error')
    optsRef.current.onError?.(err)
  }, [])

  const markCancelled = useCallback(() => {
    if (!messagesRef.current.some((m) => m.status === 'streaming')) return
    commit(messagesRef.current.map((m) => (m.status === 'streaming' ? { ...m, status: 'cancelled' } : m)))
  }, [commit])

  const apply = useCallback(
    (event: AgentEvent): Message | null => {
      const builders = buildersRef.current
      let builder = builders.get(event.message_id)
      if (!builder) {
        let seed = messagesRef.current.find((m) => m.id === event.message_id) ?? null
        if (!seed && event.type !== 'message.start') {
          // A short "waiting" answer (approval.resolved + message.done, no
          // message.start) belongs to the message holding that approval, else
          // to the latest assistant message; it never starts a blank one.
          const approvalId = 'approval_id' in event ? event.approval_id : undefined
          seed =
            (approvalId ? messagesRef.current.find((m) => m.approvals.some((a) => a.id === approvalId)) : undefined) ??
            lastAssistant(messagesRef.current) ??
            null
          if (!seed) return null
        }
        builder = new AgentMessageBuilder(seed)
        builders.set(event.message_id, builder)
      }
      const message = builder.apply(event)
      const list = messagesRef.current
      const i = list.findIndex((m) => m.id === message.id)
      commit(i === -1 ? [...list, message] : [...list.slice(0, i), message, ...list.slice(i + 1)])
      return message
    },
    [commit],
  )

  const refreshConversation = useCallback(async () => {
    const c = conversationRef.current
    const api = clientRef.current
    if (!c || !api) return
    try {
      const fresh = await api.agent.getConversation(c.id)
      if (aliveRef.current && conversationRef.current?.id === fresh.id) setConv(fresh)
    } catch {
      // Cosmetic (title, pending lists); the messages are already right.
    }
  }, [setConv])

  const consume = useCallback(
    async (stream: AgentStream) => {
      streamRef.current?.abort()
      streamRef.current = stream
      setStatus('streaming')
      setError(null)
      let last: Message | null = null
      try {
        for await (const event of stream) {
          if (streamRef.current !== stream) break
          setReconnecting(false)
          optsRef.current.onEvent?.(event)
          last = apply(event) ?? last
        }
        if (streamRef.current !== stream) return
        if (last?.status === 'failed') {
          const err = Object.assign(new Error(last.error?.message ?? 'The agent could not answer'), { code: last.error?.code })
          setError(err)
          setStatus('error')
          optsRef.current.onError?.(err)
        } else {
          setStatus(last?.status === 'requires_action' ? 'requires_action' : 'idle')
        }
        void refreshConversation()
      } catch (e) {
        if (streamRef.current !== stream) return
        if (isAbort(e)) {
          markCancelled()
          setStatus('idle')
        } else {
          fail(e)
        }
      } finally {
        if (streamRef.current === stream) streamRef.current = null
        setReconnecting(false)
      }
    },
    [apply, fail, markCancelled, refreshConversation],
  )

  const streamOptions = () => ({
    reconnect: optsRef.current.reconnect,
    onReconnect: () => setReconnecting(true),
  })

  const ensureConversation = useCallback(async (): Promise<Conversation> => {
    if (conversationRef.current) return conversationRef.current
    if (!creatingRef.current) {
      const o = optsRef.current
      const orgId = o.create?.org_id ?? o.orgId
      creatingRef.current = requireClient()
        .agent.createConversation({ ...o.create, ...(orgId !== undefined ? { org_id: orgId } : {}), agent: o.agent ?? 'copilot' })
        .then((c) => {
          setConv(c)
          optsRef.current.onConversation?.(c)
          return c
        })
        .finally(() => {
          creatingRef.current = null
        })
    }
    return creatingRef.current
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setConv])

  // Load the conversation passed in (and follow a turn still running).
  useEffect(() => {
    const id = options.conversationId ?? null
    // The conversation this hook just created, handed back by the parent.
    if (id && conversationRef.current?.id === id) return
    streamRef.current?.abort()
    streamRef.current = null
    buildersRef.current.clear()
    resultsRef.current.clear()
    setError(null)
    if (!id) {
      if (conversationRef.current || messagesRef.current.length) {
        setConv(null)
        commit([])
      }
      setStatus('idle')
      if (optsRef.current.createOnMount && clientRef.current) ensureConversation().catch(fail)
      return
    }
    const api = clientRef.current
    if (!api) return
    let cancelled = false
    setStatus('loading')
    Promise.all([api.agent.getConversation(id), api.agent.listMessages(id)])
      .then(([c, list]) => {
        if (cancelled) return
        setConv(c)
        commit(list)
        optsRef.current.onConversation?.(c)
        if (c.status === 'running') {
          void consume(api.agent.resume(id, streamOptions()))
        } else {
          setStatus(c.status === 'requires_action' ? 'requires_action' : 'idle')
        }
      })
      .catch((e) => {
        if (!cancelled) fail(e)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, options.conversationId])

  // The agent's profile (name, greeting, starters); member sessions need the org.
  const agentId = options.agent ?? conversation?.agent_id ?? 'copilot'
  useEffect(() => {
    if (!client) return
    let alive = true
    client.agent
      .getAgent(agentId, { orgId: options.orgId })
      .then((a) => alive && setAgent(a))
      .catch(() => alive && setAgent(null))
    return () => {
      alive = false
    }
  }, [client, agentId, options.orgId])

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
      streamRef.current?.abort()
      streamRef.current = null
    }
  }, [])

  const send = useCallback(
    async (input: string | SendMessageInput) => {
      const content = typeof input === 'string' ? input : input.content
      // One turn at a time: ignored while the agent is answering.
      if (!content.trim() || busyRef.current || streamRef.current) return
      busyRef.current = true
      const local: Message = {
        ...emptyAssistantMessage(`local_${++localId.current}`),
        role: 'user',
        status: 'completed',
        text: content,
      }
      commit([...messagesRef.current, local])
      setStatus('streaming')
      setError(null)
      resultsRef.current.clear()
      try {
        const c = await ensureConversation()
        await consume(requireClient().agent.streamMessage(c.id, input, streamOptions()))
      } catch (e) {
        fail(e)
      } finally {
        busyRef.current = false
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [commit, consume, ensureConversation, fail],
  )

  const approve = useCallback(
    async (approvalId: string, phrase?: string) => {
      try {
        await consume(requireClient().agent.approve(approvalId, { ...streamOptions(), confirmationPhrase: phrase }))
      } catch (e) {
        fail(e)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [consume, fail],
  )

  const deny = useCallback(
    async (approvalId: string, reason?: string) => {
      try {
        await consume(requireClient().agent.deny(approvalId, { ...streamOptions(), reason }))
      } catch (e) {
        fail(e)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [consume, fail],
  )

  const cancel = useCallback(async () => {
    const c = conversationRef.current
    const stream = streamRef.current
    if (!c) return
    try {
      await requireClient().agent.cancel(c.id)
      // The stream ends with message.done (cancelled); stop waiting if it doesn't.
      if (stream) {
        setTimeout(() => {
          if (streamRef.current === stream) stream.abort()
        }, 8_000)
      }
    } catch (e) {
      stream?.abort()
      fail(e)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fail])

  const submitToolResults = useCallback(
    async (results: ToolResultInput[]) => {
      const c = conversationRef.current
      if (!c || !results.length) return
      resultsRef.current.clear()
      try {
        await consume(requireClient().agent.submitToolResults(c.id, results, streamOptions()))
      } catch (e) {
        fail(e)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [consume, fail],
  )

  const submitToolResult = useCallback(
    async (callId: string, output: unknown, isError?: boolean) => {
      const result: ToolResultInput = { call_id: callId, output }
      if (isError) result.is_error = true
      resultsRef.current.set(callId, result)
      let pending = pendingToolCallsOf(messagesRef.current)
      if (!pending.length && conversationRef.current?.status === 'requires_action') pending = conversationRef.current.pending_tool_calls
      if (pending.every((p) => resultsRef.current.has(p.call_id))) {
        await submitToolResults([...resultsRef.current.values()])
      }
    },
    [submitToolResults],
  )

  const reload = useCallback(async () => {
    const c = conversationRef.current
    const api = clientRef.current
    if (!c || !api) return
    try {
      const [fresh, list] = await Promise.all([api.agent.getConversation(c.id), api.agent.listMessages(c.id)])
      buildersRef.current.clear()
      setConv(fresh)
      commit(list)
    } catch (e) {
      fail(e)
    }
  }, [commit, fail, setConv])

  const reset = useCallback(() => {
    streamRef.current?.abort()
    streamRef.current = null
    buildersRef.current.clear()
    resultsRef.current.clear()
    setConv(null)
    commit([])
    setError(null)
    setStatus('idle')
  }, [commit, setConv])

  const streaming = status === 'streaming'
  const pendingApprovals = useMemo(() => {
    const fromMessages = pendingApprovalsOf(messages)
    if (fromMessages.length || streaming) return fromMessages
    return (conversation?.pending_approvals ?? []).filter((a) => a.status === 'pending')
  }, [messages, conversation, streaming])
  const pendingToolCalls = useMemo(() => {
    const fromMessages = pendingToolCallsOf(messages)
    if (fromMessages.length || streaming) return fromMessages
    return conversation?.status === 'requires_action' ? conversation.pending_tool_calls : []
  }, [messages, conversation, streaming])
  const suggestions = useMemo(() => (streaming ? [] : (lastAssistant(messages)?.suggestions ?? [])), [messages, streaming])

  return {
    agent,
    conversation,
    messages,
    status,
    error,
    reconnecting,
    send,
    approve,
    deny,
    cancel,
    submitToolResult,
    submitToolResults,
    pendingApprovals,
    pendingToolCalls,
    suggestions,
    reload,
    reset,
  }
}
