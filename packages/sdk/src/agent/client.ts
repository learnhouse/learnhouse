// client.agent: the Agent API (`/api/v1/agent`), the public face of Atlas and
// the learner copilot. Build your own chat UI on it: conversations, streamed
// turns (text, views, citations, approvals, tool calls) and resumable streams.
//
// The routes are LearnHouse EE and are not part of the generated OSS schema,
// so they go through `http.request` with the hand-written types in ./types.

import { abortReason, type HttpCore } from '../core/http'
import type { BaseRequestOptions } from '../core/types'
import { LearnHouseError } from '../errors'
import { collectMessage } from './collect'
import { readSSE, SSEParser } from './sse'
import type {
  Agent,
  AgentEvent,
  AgentWaiting,
  Conversation,
  CreateConversationInput,
  Message,
  SendMessageInput,
  Template,
  ToolInfo,
  ToolResultInput,
  ViewsSchema,
} from './types'

const BASE = '/api/v1/agent'

export interface AgentStreamOptions extends BaseRequestOptions {
  /**
   * How many times to reconnect after the connection drops mid-turn, resuming
   * from the last event id (`GET /conversations/{id}/stream` with
   * `Last-Event-ID`). Default 3; `false` disables.
   */
  reconnect?: number | false
  /** Called before each reconnect attempt. */
  onReconnect?: (info: { attempt: number; lastEventId: string | null; error: unknown }) => void
}

export interface ListAgentsOptions extends BaseRequestOptions {
  /** Required with a member session. */
  orgId?: number
}

/** Options of org-level calls (`getAgent`, `listTools`). */
export interface AgentOrgOptions extends BaseRequestOptions {
  /** Required with a member session (API tokens and embed sessions carry their org). */
  orgId?: number
}

export interface ListConversationsOptions extends BaseRequestOptions {
  /** Required with a member session. */
  orgId?: number
  agent?: string
  externalUserId?: string
  limit?: number
}

export interface ResumeOptions extends AgentStreamOptions {
  /** Skip events up to and including this id. Omit to replay the current run from its start. */
  lastEventId?: string | null
}

export interface ApproveOptions extends AgentStreamOptions {
  /** Required when the approval has a `confirmation`: the exact `confirmation.phrase`. */
  confirmationPhrase?: string
  /** `false`: wait for the turn to finish and return the Message instead of a stream. */
  stream?: true
}

export interface DenyOptions extends AgentStreamOptions {
  /** Shown to the agent (at most 1000 characters). */
  reason?: string
  stream?: true
}

type Opener = (signal: AbortSignal, lastEventId: string | null) => Promise<Response>

function streamUnsupported(): LearnHouseError {
  return new LearnHouseError({
    status: 0,
    code: 'STREAM_UNSUPPORTED',
    message: "This runtime's fetch() does not expose a readable response body; use the non-streaming calls.",
    method: 'GET',
    path: BASE,
    url: '',
  })
}

function interrupted(conversationId: string | null, cause?: unknown): LearnHouseError {
  return new LearnHouseError({
    status: 0,
    code: 'STREAM_INTERRUPTED',
    message: 'The agent stream ended before message.done',
    method: 'GET',
    path: `${BASE}/conversations/{conversation_id}/stream`,
    url: '',
    detail: { conversation_id: conversationId },
    cause,
  })
}

function parseEvent(data: string, eventName: string, id: string | null): AgentEvent | null {
  let payload: unknown
  try {
    payload = JSON.parse(data)
  } catch {
    return null
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const event = payload as Record<string, unknown>
  if (typeof event.type !== 'string') {
    if (!eventName || eventName === 'message') return null
    event.type = eventName
  }
  if (id && event.id === undefined) event.id = id
  return event as unknown as AgentEvent
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(abortReason(signal))
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(abortReason(signal))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })

/**
 * The events of one agent turn, read from an SSE response. The request starts
 * as soon as the stream is created; iterate it once with `for await`, or call
 * `finalMessage()`. Dropped connections are resumed from the last event id.
 */
export class AgentStream implements AsyncIterable<AgentEvent> {
  /** Known up front for message streams; read from the first event otherwise. */
  conversationId: string | null
  /** Assistant message the events belong to (from the first event). */
  messageId: string | null = null
  /** SSE id of the last event received. Pass to `client.agent.resume()` to pick up later. */
  lastEventId: string | null = null
  private readonly controller = new AbortController()
  private readonly opened: Promise<Response>
  private iterated = false

  /** @internal Use `client.agent.streamMessage()` and friends. */
  constructor(
    private readonly openFirst: Opener,
    private readonly resumeWith: ((conversationId: string, signal: AbortSignal, lastEventId: string | null) => Promise<Response>) | null,
    conversationId: string | null,
    private readonly options: AgentStreamOptions = {},
  ) {
    this.conversationId = conversationId
    const outer = options.signal
    if (outer) {
      if (outer.aborted) this.controller.abort(abortReason(outer))
      else outer.addEventListener('abort', () => this.controller.abort(abortReason(outer)), { once: true })
    }
    this.opened = openFirst(this.controller.signal, null)
    // Errors surface when the stream is iterated; never as an unhandled rejection.
    this.opened.catch(() => {})
  }

  /** The signal the stream's requests use. */
  get signal(): AbortSignal {
    return this.controller.signal
  }

  /** Stop reading (the run keeps going on the server; use `cancel()` to stop it). */
  abort(reason?: unknown): void {
    this.controller.abort(reason)
  }

  /** Read the whole turn and fold it into a Message. Pass `seed` when continuing a message. */
  finalMessage(seed?: Message | null): Promise<Message> {
    return collectMessage(this, seed)
  }

  [Symbol.asyncIterator](): AsyncIterator<AgentEvent> {
    if (this.iterated) throw new Error('@learnhouse/sdk: an AgentStream can only be iterated once')
    this.iterated = true
    return this.run()
  }

  private async *run(): AsyncGenerator<AgentEvent, void, undefined> {
    const signal = this.controller.signal
    const max = this.options.reconnect === false ? 0 : Math.max(0, this.options.reconnect ?? 3)
    let attempt = 0
    let res = await this.opened
    for (;;) {
      if (!res.body) throw streamUnsupported()
      let failure: unknown = null
      const parser = new SSEParser()
      parser.lastEventId = this.lastEventId
      try {
        for await (const frame of readSSE(res.body, { signal, parser })) {
          const event = parseEvent(frame.data, frame.event, frame.id)
          if (frame.id) this.lastEventId = frame.id
          if (!event) continue
          attempt = 0
          if (!this.conversationId && event.conversation_id) this.conversationId = event.conversation_id
          if (!this.messageId && event.message_id) this.messageId = event.message_id
          yield event
          if (event.type === 'message.done') return
        }
      } catch (error) {
        if (signal.aborted) throw abortReason(signal)
        failure = error
      }
      if (signal.aborted) throw abortReason(signal)
      // Ended (or failed) before message.done: pick the run up where it stopped.
      if (attempt >= max || !this.resumeWith || !this.conversationId) {
        throw failure instanceof LearnHouseError ? failure : interrupted(this.conversationId, failure)
      }
      attempt += 1
      this.options.onReconnect?.({ attempt, lastEventId: this.lastEventId, error: failure })
      await sleep(Math.min(250 * 2 ** (attempt - 1), 4_000), signal)
      res = await this.resumeWith(this.conversationId, signal, this.lastEventId)
    }
  }
}

/** True for the `{ waiting_on, events }` a non-streaming approve / deny returns while the turn still waits. */
export function isAgentWaiting(value: unknown): value is AgentWaiting {
  return !!value && typeof value === 'object' && 'waiting_on' in value && !('role' in value)
}

function messageBody(input: SendMessageInput | string, stream: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = typeof input === 'string' ? { content: input } : { ...input }
  body.stream = stream
  return body
}

export function createAgentResource(http: HttpCore) {
  const conv = (id: string) => ({ path: { conversation_id: id } })

  /** Opens an SSE response; the per-attempt timeout covers the response headers only. */
  function openSSE(
    method: 'GET' | 'POST',
    path: string,
    pathParams: Record<string, string>,
    options: AgentStreamOptions,
    body: unknown,
    signal: AbortSignal,
    lastEventId: string | null,
  ): Promise<Response> {
    const { reconnect: _r, onReconnect: _o, signal: _s, ...rest } = options
    const headers = new Headers(rest.headers)
    headers.set('Accept', 'text/event-stream')
    if (lastEventId) headers.set('Last-Event-ID', lastEventId)
    return http.request<Response>(method, path, {
      ...rest,
      headers,
      signal,
      body,
      params: { path: pathParams },
      parseAs: 'response',
    })
  }

  const resumeWith = (options: AgentStreamOptions) => (conversationId: string, signal: AbortSignal, lastEventId: string | null) =>
    openSSE('GET', `${BASE}/conversations/{conversation_id}/stream`, { conversation_id: conversationId }, options, undefined, signal, lastEventId)

  function postStream(path: string, pathParams: Record<string, string>, body: unknown, conversationId: string | null, options: AgentStreamOptions) {
    return new AgentStream(
      (signal) => openSSE('POST', path, pathParams, options, body, signal, null),
      resumeWith(options),
      conversationId,
      options,
    )
  }

  const resource = {
    // ── Agents ───────────────────────────────────────────────────────────
    /** Agents the caller may talk to. `GET /api/v1/agent/agents` */
    async listAgents(options: ListAgentsOptions = {}): Promise<Agent[]> {
      const { orgId, ...rest } = options
      const res = await http.request<{ agents: Agent[] }>('GET', `${BASE}/agents`, {
        ...rest,
        params: { query: { org_id: orgId } },
      })
      return res.agents
    },
    /** `GET /api/v1/agent/agents/{agent_id}` */
    getAgent(agentId: string, options: AgentOrgOptions = {}): Promise<Agent> {
      const { orgId, ...rest } = options
      return http.request<Agent>('GET', `${BASE}/agents/{agent_id}`, {
        ...rest,
        params: { path: { agent_id: agentId }, query: { org_id: orgId } },
      })
    },
    /** Tools this caller's agent may call. `GET /api/v1/agent/agents/{agent_id}/tools` */
    async listTools(agentId: string, options: AgentOrgOptions = {}): Promise<ToolInfo[]> {
      const { orgId, ...rest } = options
      const res = await http.request<{ tools: ToolInfo[] }>('GET', `${BASE}/agents/{agent_id}/tools`, {
        ...rest,
        params: { path: { agent_id: agentId }, query: { org_id: orgId } },
      })
      return res.tools
    },
    /** JSON Schemas of views and every component type. `GET /api/v1/agent/views/schema` */
    getViewsSchema(options?: BaseRequestOptions): Promise<ViewsSchema> {
      return http.request<ViewsSchema>('GET', `${BASE}/views/schema`, options)
    },
    /** Render a template server-side (try templates out). `POST /api/v1/agent/templates/render` */
    renderTemplate(
      input: { template: Template; data: Record<string, unknown> },
      options?: BaseRequestOptions,
    ): Promise<{ format: Template['format']; content: string }> {
      return http.request('POST', `${BASE}/templates/render`, { ...options, body: input })
    },

    // ── Conversations ────────────────────────────────────────────────────
    /** `POST /api/v1/agent/conversations` */
    createConversation(input: CreateConversationInput, options?: BaseRequestOptions): Promise<Conversation> {
      return http.request<Conversation>('POST', `${BASE}/conversations`, { ...options, body: input })
    },
    /** `GET /api/v1/agent/conversations` */
    async listConversations(options: ListConversationsOptions = {}): Promise<Conversation[]> {
      const { orgId, agent, externalUserId, limit, ...rest } = options
      const res = await http.request<{ conversations: Conversation[] }>('GET', `${BASE}/conversations`, {
        ...rest,
        params: { query: { org_id: orgId, agent, external_user_id: externalUserId, limit } },
      })
      return res.conversations
    },
    /** `GET /api/v1/agent/conversations/{id}` */
    getConversation(conversationId: string, options?: BaseRequestOptions): Promise<Conversation> {
      return http.request<Conversation>('GET', `${BASE}/conversations/{conversation_id}`, { ...options, params: conv(conversationId) })
    },
    /** `DELETE /api/v1/agent/conversations/{id}` */
    deleteConversation(conversationId: string, options?: BaseRequestOptions): Promise<{ deleted: boolean }> {
      return http.request('DELETE', `${BASE}/conversations/{conversation_id}`, { ...options, params: conv(conversationId) })
    },
    /** `GET /api/v1/agent/conversations/{id}/messages` */
    async listMessages(conversationId: string, options?: BaseRequestOptions): Promise<Message[]> {
      const res = await http.request<{ messages: Message[] }>('GET', `${BASE}/conversations/{conversation_id}/messages`, {
        ...options,
        params: conv(conversationId),
      })
      return res.messages
    },

    // ── Turns ────────────────────────────────────────────────────────────
    /**
     * Send a message and wait for the whole answer (`stream: false`).
     * `POST /api/v1/agent/conversations/{id}/messages`
     */
    async sendMessage(conversationId: string, input: SendMessageInput | string, options?: BaseRequestOptions): Promise<Message> {
      const res = await http.request<{ message: Message }>('POST', `${BASE}/conversations/{conversation_id}/messages`, {
        // The server holds the request until message.done.
        timeoutMs: 0,
        ...options,
        params: conv(conversationId),
        body: messageBody(input, false),
      })
      return res.message
    },
    /**
     * Send a message and stream the answer.
     * `for await (const event of client.agent.streamMessage(id, 'Hi')) {}`
     */
    streamMessage(conversationId: string, input: SendMessageInput | string, options: AgentStreamOptions = {}): AgentStream {
      return postStream(
        `${BASE}/conversations/{conversation_id}/messages`,
        { conversation_id: conversationId },
        messageBody(input, true),
        conversationId,
        options,
      )
    },
    /**
     * Re-attach to the conversation's current run: replays events after
     * `lastEventId`, then follows it live. `GET /conversations/{id}/stream`
     */
    resume(conversationId: string, options: ResumeOptions = {}): AgentStream {
      const { lastEventId = null, ...rest } = options
      const open = resumeWith(rest)
      const stream = new AgentStream((signal) => open(conversationId, signal, lastEventId), open, conversationId, rest)
      stream.lastEventId = lastEventId
      return stream
    },
    /** Stop the running turn. `POST /api/v1/agent/conversations/{id}/cancel` */
    cancel(conversationId: string, options?: BaseRequestOptions): Promise<{ cancelled: boolean }> {
      return http.request('POST', `${BASE}/conversations/{conversation_id}/cancel`, { ...options, params: conv(conversationId) })
    },
    /**
     * Answer the agent's client tool calls; the turn continues as a stream.
     * `POST /api/v1/agent/conversations/{id}/tool-results`
     */
    submitToolResults(conversationId: string, results: ToolResultInput[], options: AgentStreamOptions = {}): AgentStream {
      return postStream(
        `${BASE}/conversations/{conversation_id}/tool-results`,
        { conversation_id: conversationId },
        { results, stream: true },
        conversationId,
        options,
      )
    },

    // ── Approvals ────────────────────────────────────────────────────────
    /**
     * Approve a risky action. Streams the continuation, or with
     * `{ stream: false }` resolves to the finished Message (or to an
     * `AgentWaiting` while other approvals / tool results are still due; see
     * `isAgentWaiting`). A waiting stream is just `approval.resolved` +
     * `message.done` with `status: 'requires_action'` and a `note`.
     * `POST /api/v1/agent/approvals/{approval_id}/approve`
     */
    approve: approveOrDeny('approve') as {
      (approvalId: string, options?: ApproveOptions): AgentStream
      (approvalId: string, options: Omit<ApproveOptions, 'stream'> & { stream: false }): Promise<Message | AgentWaiting>
    },
    /**
     * Deny a risky action. Streams the continuation, or with `{ stream: false }`
     * resolves to the finished Message (or an `AgentWaiting`).
     * `POST /api/v1/agent/approvals/{approval_id}/deny`
     */
    deny: approveOrDeny('deny') as {
      (approvalId: string, options?: DenyOptions): AgentStream
      (approvalId: string, options: Omit<DenyOptions, 'stream'> & { stream: false }): Promise<Message | AgentWaiting>
    },
  }

  function approveOrDeny(action: 'approve' | 'deny') {
    return (
      approvalId: string,
      options: (AgentStreamOptions & { confirmationPhrase?: string; reason?: string; stream?: boolean }) = {},
    ): AgentStream | Promise<Message | AgentWaiting> => {
      const { confirmationPhrase, reason, stream = true, ...rest } = options
      const body: Record<string, unknown> = { stream }
      if (action === 'approve' && confirmationPhrase !== undefined) body.confirmation_phrase = confirmationPhrase
      if (action === 'deny' && reason !== undefined) body.reason = reason
      const path = `${BASE}/approvals/{approval_id}/${action}`
      if (!stream) {
        const { reconnect: _r, onReconnect: _o, ...plain } = rest
        return http
          .request<{ message?: Message } & Partial<AgentWaiting>>('POST', path, {
            timeoutMs: 0,
            ...plain,
            params: { path: { approval_id: approvalId } },
            body,
          })
          .then((res) => res.message ?? { waiting_on: res.waiting_on ?? null, events: res.events ?? [] })
      }
      return postStream(path, { approval_id: approvalId }, body, null, rest)
    }
  }

  return resource
}

export type AgentResource = ReturnType<typeof createAgentResource>
