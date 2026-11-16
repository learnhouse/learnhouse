// Folds stream events into a Message, the same shape `listMessages` returns.
// Used by `collectMessage`, `AgentStream.finalMessage()` and the React hook.

import type { AgentEvent, Approval, Message, MessageUsage } from './types'

export function emptyAssistantMessage(id: string, createdAt?: string): Message {
  return {
    id,
    role: 'assistant',
    created_at: createdAt ?? new Date().toISOString(),
    status: 'streaming',
    text: '',
    views: [],
    citations: [],
    tool_calls: [],
    approvals: [],
    plan: null,
    suggestions: [],
    output: null,
    rendered: null,
    usage: null,
    error: null,
  }
}

function upsert<T>(list: T[], item: T, same: (a: T) => boolean): T[] {
  const i = list.findIndex(same)
  if (i === -1) return [...list, item]
  const next = list.slice()
  next[i] = item
  return next
}

function addUsage(a: MessageUsage | null, b: MessageUsage): MessageUsage {
  if (!a) return { ...b }
  return {
    credits: a.credits + b.credits,
    requests: a.requests + b.requests,
    input_tokens: a.input_tokens + b.input_tokens,
    output_tokens: a.output_tokens + b.output_tokens,
  }
}

/**
 * Builds one assistant message from its events. Each `apply()` returns a new
 * object (safe as React state). Seed it with an existing message to fold an
 * approval / tool-result continuation (`message.start` with `continued: true`)
 * onto it.
 *
 * Folding rules:
 * - `message.start` starts a fresh message, or keeps the seed when `continued`.
 * - `text.delta` appends; `text.done` replaces this run's text with the full run text.
 * - `view`, `citation`, `approval.required` add (same id replaces); `tool.*` update the call by `call_id`.
 * - `approval.resolved` / `action.applied` update the approval's status.
 * - `plan`, `suggestions`, `output`, `rendered`, `error` replace; `usage` adds up across runs.
 * - `message.done` sets the final status (and the full text when it carries one).
 */
export class AgentMessageBuilder {
  private current: Message | null
  /** Text of the message before the current run started (continuations). */
  private runBase = ''
  private runText = ''
  private usageBase: MessageUsage | null = null

  constructor(seed?: Message | null) {
    this.current = seed ?? null
    if (seed) {
      this.runBase = seed.text
      this.usageBase = seed.usage
    }
  }

  get message(): Message | null {
    return this.current
  }

  apply(event: AgentEvent): Message {
    let m = this.current ?? emptyAssistantMessage(event.message_id)
    switch (event.type) {
      case 'message.start':
        if (event.continued && this.current) {
          m = { ...m, status: 'streaming', error: null }
          this.runBase = m.text
          this.usageBase = m.usage
        } else {
          m = emptyAssistantMessage(event.message_id, event.created_at)
          this.runBase = ''
          this.usageBase = null
        }
        this.runText = ''
        break
      case 'text.delta':
        this.runText += event.delta
        m = { ...m, text: this.runBase + this.runText }
        break
      case 'text.done':
        this.runText = event.text
        m = { ...m, text: this.runBase + this.runText }
        break
      case 'tool.call':
        m = {
          ...m,
          tool_calls: upsert(
            m.tool_calls,
            { call_id: event.call_id, name: event.name, ok: null, client: !!event.client, args: event.args },
            (c) => c.call_id === event.call_id,
          ),
        }
        break
      case 'tool.progress':
        m = {
          ...m,
          tool_calls: m.tool_calls.map((c) =>
            c.call_id === event.call_id ? { ...c, progress: { done: event.done, total: event.total, label: event.label ?? null } } : c,
          ),
        }
        break
      case 'tool.result': {
        const known = m.tool_calls.some((c) => c.call_id === event.call_id)
        const update = { ok: event.ok, error: event.error ?? null, detail: event.detail }
        m = {
          ...m,
          tool_calls: known
            ? m.tool_calls.map((c) => (c.call_id === event.call_id ? { ...c, ...update } : c))
            : [...m.tool_calls, { call_id: event.call_id, name: event.name, client: false, ...update }],
        }
        break
      }
      case 'plan':
        m = { ...m, plan: event.steps }
        break
      case 'view':
        m = { ...m, views: upsert(m.views, event.view, (v) => v.id === event.view.id) }
        break
      case 'citation':
        m = {
          ...m,
          citations: upsert(m.citations, event.citation, (c) =>
            event.citation.id ? c.id === event.citation.id : c.index === event.citation.index,
          ),
        }
        break
      case 'approval.required':
        m = { ...m, approvals: upsert(m.approvals, event.approval, (a) => a.id === event.approval.id) }
        break
      case 'approval.resolved':
        m = { ...m, approvals: setApprovalStatus(m.approvals, event.approval_id, event.decision) }
        break
      case 'action.applied': {
        const { approval_id, tool, summary, auto, undo_available } = event
        m = {
          ...m,
          approvals: setApprovalStatus(m.approvals, approval_id, 'applied'),
          actions: [...(m.actions ?? []), { approval_id, tool, summary, auto, undo_available }],
        }
        break
      }
      case 'suggestions':
        m = { ...m, suggestions: event.items }
        break
      case 'output':
        m = {
          ...m,
          output: { format: event.format, data: event.data, valid: event.valid, attempts: event.attempts, errors: event.errors ?? [] },
        }
        break
      case 'rendered':
        m = { ...m, rendered: { format: event.format, content: event.content } }
        break
      case 'usage':
        m = {
          ...m,
          usage: addUsage(this.usageBase, {
            credits: event.credits ?? 0,
            requests: event.requests ?? 0,
            input_tokens: event.input_tokens ?? 0,
            output_tokens: event.output_tokens ?? 0,
          }),
        }
        break
      case 'error':
        m = { ...m, error: { code: event.code, message: event.message } }
        break
      case 'message.done': {
        let text = m.text
        if (typeof event.text === 'string' && event.text) {
          // Full message text, or (on a continuation) possibly just this run's.
          text = !this.runBase || event.text.startsWith(this.runBase) ? event.text : this.runBase + event.text
        }
        m = { ...m, status: event.status, text }
        break
      }
      default:
        // Unknown event types from a newer server are ignored.
        break
    }
    this.current = m
    return m
  }
}

function setApprovalStatus(list: Approval[], id: string, status: Approval['status']): Approval[] {
  return list.map((a) => (a.id === id ? { ...a, status } : a))
}

/**
 * Folds a whole stream into its final Message.
 * `const message = await collectMessage(client.agent.streamMessage(id, 'Hi'))`
 */
export async function collectMessage(
  events: AsyncIterable<AgentEvent> | Iterable<AgentEvent>,
  seed?: Message | null,
): Promise<Message> {
  const builder = new AgentMessageBuilder(seed)
  for await (const event of events as AsyncIterable<AgentEvent>) builder.apply(event)
  if (!builder.message) throw new Error('@learnhouse/sdk: the agent stream ended without any event')
  return builder.message
}

/** Approvals still waiting on the user. */
export function pendingApprovals(message: Message | null | undefined): Approval[] {
  return message ? message.approvals.filter((a) => a.status === 'pending') : []
}
