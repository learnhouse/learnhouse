import { describe, expect, it, vi } from 'vitest'
import {
  AgentMessageBuilder,
  AgentStream,
  LearnHouseError,
  SSEParser,
  collectMessage,
  createClient,
  isAgentWaiting,
  readSSE,
  type AgentEvent,
  type Approval,
  type View,
} from '../src'
import { json, mockFetch } from './helpers'

const BASE = 'https://api.example.test'
const CONV = 'agconv_1'
const MSG = 'agmsg_1'

const enc = new TextEncoder()

/** A ReadableStream that hands out the given chunks one per read. */
function chunked(chunks: string[], opts: { failAfter?: boolean } = {}) {
  let i = 0
  return new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (i < chunks.length) controller.enqueue(enc.encode(chunks[i++]))
        else if (opts.failAfter) controller.error(new TypeError('network connection was lost'))
        else controller.close()
      },
    },
    // Pull only on read, so an error never discards a chunk still queued.
    { highWaterMark: 0 },
  )
}

function sse(chunks: string[], opts: { failAfter?: boolean; status?: number } = {}) {
  return new Response(chunked(chunks, opts), {
    status: opts.status ?? 200,
    headers: { 'content-type': 'text/event-stream', 'x-learnhouse-agent-api': '2026-11-16' },
  })
}

let frameNo = 0
function frame(event: Record<string, unknown>, id = `run_1.${++frameNo}.0`) {
  const payload = { conversation_id: CONV, message_id: MSG, ...event }
  return `id: ${id}\nevent: ${event.type}\ndata: ${JSON.stringify(payload)}\n\n`
}

const view: View = {
  id: 'view_1',
  call_id: 'call_1',
  schema_version: 1,
  title: 'Enrollments',
  layout: 'stack',
  components: [{ type: 'kpis', items: [{ label: 'Learners', value: 42 }] }],
  fallback_markdown: '**Learners**: 42',
}
const approval: Approval = {
  id: 'pnd_1',
  tool: 'update_course',
  summary: 'Publish "Intro"',
  risk: 'write',
  reason: 'ask_first',
  target: { kind: 'course', uuid: 'course_1', name: 'Intro' },
  args: {},
  estimate_credits: null,
  confirmation: { phrase: 'Intro', kind: 'type_name', action_label: 'Publish', blast_radius: '1 course' },
  status: 'pending',
  can_approve: true,
}

function turn() {
  return [
    frame({ type: 'message.start', agent_id: 'atlas', role: 'assistant', created_at: '2026-11-16T10:00:00Z', continued: false }),
    frame({ type: 'text.delta', delta: 'Hello ' }),
    frame({ type: 'text.delta', delta: 'world' }),
    frame({ type: 'tool.call', call_id: 'call_1', name: 'org_stats', args: { range: '30d' }, client: false }),
    frame({ type: 'tool.progress', call_id: 'call_1', done: 1, total: 2, label: 'Counting' }),
    frame({ type: 'tool.result', call_id: 'call_1', name: 'org_stats', ok: true, error: null, detail: null }),
    frame({ type: 'plan', steps: [{ id: 's1', title: 'Look', status: 'done' }] }),
    frame({ type: 'view', view }),
    frame({ type: 'citation', citation: { index: 1, id: 'cit_1', title: 'Lesson', source_type: 'dynamic_page', course_uuid: 'course_1', course_name: 'C', chapter_name: '', activity_uuid: null, activity_name: '', url: null, snippet: 's' } }),
    frame({ type: 'approval.required', approval }),
    frame({ type: 'suggestions', items: ['Publish it', 'Show more'] }),
    frame({ type: 'text.done', text: 'Hello world!' }),
    frame({ type: 'usage', credits: 3, requests: 2, input_tokens: 10, output_tokens: 5 }),
    frame({ type: 'message.done', status: 'requires_action', text: 'Hello world!' }),
  ]
}

describe('SSEParser', () => {
  it('parses frames split at arbitrary chunk boundaries', () => {
    const text = 'id: a.1.0\nevent: text.delta\ndata: {"x":1}\n\nid: a.2.0\nevent: text.delta\ndata: {"x":2}\n\n'
    for (let size = 1; size <= text.length; size++) {
      const p = new SSEParser()
      const frames = []
      for (let i = 0; i < text.length; i += size) frames.push(...p.push(text.slice(i, i + size)))
      expect(frames.map((f) => [f.id, f.event, f.data])).toEqual([
        ['a.1.0', 'text.delta', '{"x":1}'],
        ['a.2.0', 'text.delta', '{"x":2}'],
      ])
    }
  })

  it('accepts CRLF, CR and LF line ends, including a CRLF split across chunks', () => {
    const p = new SSEParser()
    const frames = [
      ...p.push('data: one\r'),
      ...p.push('\n\r'),
      ...p.push('\ndata: two\r\rdata: three\n\n'),
    ]
    expect(frames.map((f) => f.data)).toEqual(['one', 'two', 'three'])
  })

  it('joins multi-line data, ignores comments and unknown fields, keeps ids across frames', () => {
    const p = new SSEParser()
    const frames = p.push(': ping\n\nid: r.1.0\ndata: line 1\nfoo: bar\ndata:line 2\n\n: keep-alive\ndata: next\nretry: 1500\n\n')
    expect(frames).toEqual([
      { event: 'message', data: 'line 1\nline 2', id: 'r.1.0' },
      { event: 'message', data: 'next', id: 'r.1.0', retry: 1500 },
    ])
    expect(p.lastEventId).toBe('r.1.0')
  })

  it('drops a final frame that never got its blank line', async () => {
    const frames = []
    for await (const f of readSSE(chunked(['data: a\n\n', 'data: b\n']))) frames.push(f.data)
    expect(frames).toEqual(['a'])
  })

  it('decodes multi-byte characters split across chunks', async () => {
    const bytes = enc.encode('data: héllo 🧭\n\n')
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(bytes.slice(0, 8))
        c.enqueue(bytes.slice(8, 13))
        c.enqueue(bytes.slice(13))
        c.close()
      },
    })
    const out = []
    for await (const f of readSSE(body)) out.push(f.data)
    expect(out).toEqual(['héllo 🧭'])
  })
})

describe('client.agent: JSON endpoints', () => {
  it('lists agents and unwraps the envelope, with org_id for member sessions', async () => {
    const m = mockFetch(json({ agents: [{ id: 'atlas', name: 'Atlas' }] }))
    const lh = createClient({ baseUrl: BASE, token: 'lh_x', fetch: m.fetch })
    const agents = await lh.agent.listAgents({ orgId: 7 })
    expect(agents).toEqual([{ id: 'atlas', name: 'Atlas' }])
    expect(m.calls[0].url).toBe(`${BASE}/api/v1/agent/agents?org_id=7`)
    expect(m.calls[0].headers.get('authorization')).toBe('Bearer lh_x')
  })

  it('sends org_id on the org-level agent calls for member sessions', async () => {
    const m = mockFetch((call) => (call.url.includes('/tools') ? json({ tools: [] }) : json({ id: 'atlas' })))
    const lh = createClient({ baseUrl: BASE, token: 'jwt', fetch: m.fetch })
    await lh.agent.getAgent('atlas', { orgId: 3 })
    await lh.agent.listTools('atlas', { orgId: 3 })
    await lh.agent.getAgent('copilot')
    expect(m.calls.map((c) => c.url.replace(BASE, ''))).toEqual([
      '/api/v1/agent/agents/atlas?org_id=3',
      '/api/v1/agent/agents/atlas/tools?org_id=3',
      '/api/v1/agent/agents/copilot',
    ])
  })

  it('hits every JSON route with the right method, path and body', async () => {
    const m = mockFetch((call) => {
      if (call.url.endsWith('/tools')) return json({ tools: [] })
      if (call.url.endsWith('/messages') && call.method === 'GET') return json({ messages: [] })
      if (call.url.includes('/conversations?')) return json({ conversations: [] })
      if (call.method === 'POST' && call.url.endsWith('/messages')) return json({ message: { id: MSG } })
      return json({ ok: true })
    })
    const lh = createClient({ baseUrl: BASE, token: 'lh_x', fetch: m.fetch })
    await lh.agent.getAgent('copilot')
    await lh.agent.listTools('atlas')
    await lh.agent.getViewsSchema()
    await lh.agent.renderTemplate({ template: { source: '{{text}}', format: 'html' }, data: { text: '<b>' } })
    await lh.agent.createConversation({ agent: 'atlas', title: 'T', output: { mode: 'json', json_schema: { type: 'object' } } })
    await lh.agent.listConversations({ agent: 'atlas', externalUserId: 'u1', limit: 5 })
    await lh.agent.getConversation(CONV)
    await lh.agent.deleteConversation(CONV)
    await lh.agent.listMessages(CONV)
    const msg = await lh.agent.sendMessage(CONV, 'Hi')
    await lh.agent.cancel(CONV)
    expect(msg).toEqual({ id: MSG })
    expect(m.calls.map((c) => `${c.method} ${c.url.replace(BASE, '')}`)).toEqual([
      'GET /api/v1/agent/agents/copilot',
      'GET /api/v1/agent/agents/atlas/tools',
      'GET /api/v1/agent/views/schema',
      'POST /api/v1/agent/templates/render',
      'POST /api/v1/agent/conversations',
      'GET /api/v1/agent/conversations?agent=atlas&external_user_id=u1&limit=5',
      `GET /api/v1/agent/conversations/${CONV}`,
      `DELETE /api/v1/agent/conversations/${CONV}`,
      `GET /api/v1/agent/conversations/${CONV}/messages`,
      `POST /api/v1/agent/conversations/${CONV}/messages`,
      `POST /api/v1/agent/conversations/${CONV}/cancel`,
    ])
    expect(JSON.parse(m.calls[4].body as string)).toEqual({ agent: 'atlas', title: 'T', output: { mode: 'json', json_schema: { type: 'object' } } })
    expect(JSON.parse(m.calls[9].body as string)).toEqual({ content: 'Hi', stream: false })
  })

  it('maps {detail:{code,message}} errors to LearnHouseError', async () => {
    const m = mockFetch(json({ detail: { code: 'agent_not_available', message: 'Atlas needs a staff role' } }, 403))
    const lh = createClient({ baseUrl: BASE, token: 'lh_x', fetch: m.fetch })
    const err = (await lh.agent.createConversation({ agent: 'atlas' }).catch((e) => e)) as LearnHouseError
    expect(err).toBeInstanceOf(LearnHouseError)
    expect(err).toMatchObject({ status: 403, code: 'agent_not_available', message: 'Atlas needs a staff role' })
  })

  it('reports rate limits with retryAfterMs', async () => {
    const m = mockFetch(json({ detail: { code: 'rate_limited', message: 'Slow down', retry_after: 30 } }, 429, { 'Retry-After': '30' }))
    const lh = createClient({ baseUrl: BASE, token: 'lh_x', fetch: m.fetch })
    await expect(lh.agent.listAgents()).rejects.toMatchObject({ status: 429, code: 'rate_limited', retryAfterMs: 30_000 })
  })
})

describe('client.agent: streams', () => {
  it('streams a turn as typed events with ids', async () => {
    const m = mockFetch(() => sse(turn()))
    const lh = createClient({ baseUrl: BASE, token: 'lh_x', fetch: m.fetch })
    const stream = lh.agent.streamMessage(CONV, { content: 'Hi', context: { course_uuid: 'course_1' } })
    expect(stream).toBeInstanceOf(AgentStream)
    const events: AgentEvent[] = []
    for await (const e of stream) events.push(e)
    expect(events.map((e) => e.type)).toEqual([
      'message.start', 'text.delta', 'text.delta', 'tool.call', 'tool.progress', 'tool.result', 'plan', 'view',
      'citation', 'approval.required', 'suggestions', 'text.done', 'usage', 'message.done',
    ])
    expect(events[0].id).toMatch(/^run_1\.\d+\.0$/)
    expect(stream.lastEventId).toBe(events[events.length - 1].id)
    expect(stream.messageId).toBe(MSG)
    const call = m.calls[0]
    expect(call.method).toBe('POST')
    expect(call.url).toBe(`${BASE}/api/v1/agent/conversations/${CONV}/messages`)
    expect(call.headers.get('accept')).toBe('text/event-stream')
    expect(JSON.parse(call.body as string)).toEqual({ content: 'Hi', context: { course_uuid: 'course_1' }, stream: true })
  })

  it('starts the request at once, even before iterating', async () => {
    const m = mockFetch(() => sse(turn()))
    const lh = createClient({ baseUrl: BASE, token: 'lh_x', fetch: m.fetch })
    const stream = lh.agent.approve('pnd_1', { confirmationPhrase: 'Intro' })
    await vi.waitFor(() => expect(m.calls).toHaveLength(1))
    expect(m.calls[0].url).toBe(`${BASE}/api/v1/agent/approvals/pnd_1/approve`)
    expect(JSON.parse(m.calls[0].body as string)).toEqual({ stream: true, confirmation_phrase: 'Intro' })
    const message = await stream.finalMessage()
    expect(message.status).toBe('requires_action')
    expect(stream.conversationId).toBe(CONV)
  })

  it('throws the mapped error when the stream request is refused', async () => {
    const m = mockFetch(json({ detail: { code: 'run_in_progress', message: 'A turn is running' } }, 409))
    const lh = createClient({ baseUrl: BASE, token: 'lh_x', fetch: m.fetch })
    const stream = lh.agent.streamMessage(CONV, 'Hi')
    await expect(stream.finalMessage()).rejects.toMatchObject({ status: 409, code: 'run_in_progress' })
  })

  it('resumes from the last event id after the connection drops', async () => {
    const events = turn()
    const lastSeen = events[2].match(/^id: (\S+)/)![1]
    const m = mockFetch(
      () => sse(events.slice(0, 3), { failAfter: true }),
      () => sse(events.slice(3)),
    )
    const onReconnect = vi.fn()
    const lh = createClient({ baseUrl: BASE, token: 'lh_x', fetch: m.fetch })
    const stream = lh.agent.streamMessage(CONV, 'Hi', { onReconnect })
    const types: string[] = []
    for await (const e of stream) types.push(e.type)
    expect(types).toHaveLength(14)
    expect(onReconnect).toHaveBeenCalledWith(expect.objectContaining({ attempt: 1, lastEventId: lastSeen }))
    expect(m.calls[1].method).toBe('GET')
    expect(m.calls[1].url).toBe(`${BASE}/api/v1/agent/conversations/${CONV}/stream`)
    expect(m.calls[1].headers.get('last-event-id')).toBe(lastSeen)
  })

  it('also resumes when the server closes the stream before message.done', async () => {
    const events = turn()
    const m = mockFetch(() => sse(events.slice(0, 5)), () => sse(events.slice(5)))
    const lh = createClient({ baseUrl: BASE, token: 'lh_x', fetch: m.fetch })
    const message = await lh.agent.streamMessage(CONV, 'Hi').finalMessage()
    expect(message.text).toBe('Hello world!')
    expect(m.calls).toHaveLength(2)
  })

  it('gives up with STREAM_INTERRUPTED when reconnect is off', async () => {
    const m = mockFetch(() => sse(turn().slice(0, 3), { failAfter: true }))
    const lh = createClient({ baseUrl: BASE, token: 'lh_x', fetch: m.fetch })
    const err = (await lh.agent.streamMessage(CONV, 'Hi', { reconnect: false }).finalMessage().catch((e) => e)) as LearnHouseError
    expect(err).toBeInstanceOf(LearnHouseError)
    expect(err.code).toBe('STREAM_INTERRUPTED')
    expect(m.calls).toHaveLength(1)
  })

  it('resume() sends Last-Event-ID and replays the rest', async () => {
    const m = mockFetch(() => sse(turn().slice(10)))
    const lh = createClient({ baseUrl: BASE, token: 'lh_x', fetch: m.fetch })
    const stream = lh.agent.resume(CONV, { lastEventId: 'run_1.10.0' })
    const types: string[] = []
    for await (const e of stream) types.push(e.type)
    expect(types).toEqual(['suggestions', 'text.done', 'usage', 'message.done'])
    expect(m.calls[0].url).toBe(`${BASE}/api/v1/agent/conversations/${CONV}/stream`)
    expect(m.calls[0].headers.get('last-event-id')).toBe('run_1.10.0')
  })

  it('stops on abort with an AbortError', async () => {
    const m = mockFetch(() => sse(turn(), { failAfter: false }))
    const lh = createClient({ baseUrl: BASE, token: 'lh_x', fetch: m.fetch })
    const ac = new AbortController()
    const stream = lh.agent.streamMessage(CONV, 'Hi', { signal: ac.signal })
    const seen: string[] = []
    const err = await (async () => {
      for await (const e of stream) {
        seen.push(e.type)
        if (seen.length === 2) ac.abort()
      }
    })().catch((e) => e)
    expect((err as Error).name).toBe('AbortError')
    expect(seen).toEqual(['message.start', 'text.delta'])
  })

  it('denies with a reason, streamed or not', async () => {
    const m = mockFetch((call) => (JSON.parse(call.body as string).stream ? sse(turn()) : json({ message: { id: MSG, status: 'completed' } })))
    const lh = createClient({ baseUrl: BASE, token: 'lh_x', fetch: m.fetch })
    const msg = await lh.agent.deny('pnd_1', { reason: 'Not now', stream: false })
    expect(msg).toEqual({ id: MSG, status: 'completed' })
    await lh.agent.deny('pnd_1', { reason: 'Nope' }).finalMessage()
    const approved = await lh.agent.approve('pnd_2', { stream: false })
    expect(isAgentWaiting(approved)).toBe(false)
    expect((approved as { id: string }).id).toBe(MSG)
    expect(m.calls.map((c) => [c.url.replace(BASE, ''), JSON.parse(c.body as string)])).toEqual([
      ['/api/v1/agent/approvals/pnd_1/deny', { stream: false, reason: 'Not now' }],
      ['/api/v1/agent/approvals/pnd_1/deny', { stream: true, reason: 'Nope' }],
      ['/api/v1/agent/approvals/pnd_2/approve', { stream: false }],
    ])
  })

  it('returns { waiting_on, events } from a non-streaming approve while other approvals are due', async () => {
    const waiting = { waiting_on: { approvals: ['pnd_2'] }, events: [{ type: 'approval.resolved', approval_id: 'pnd_1', decision: 'approved' }] }
    const m = mockFetch(json(waiting))
    const lh = createClient({ baseUrl: BASE, token: 'lh_x', fetch: m.fetch })
    const res = await lh.agent.approve('pnd_1', { stream: false })
    expect(isAgentWaiting(res)).toBe(true)
    expect(res).toEqual(waiting)
  })

  it('submits client tool results as a stream', async () => {
    const m = mockFetch(() => sse(turn()))
    const lh = createClient({ baseUrl: BASE, token: 'lh_x', fetch: m.fetch })
    await lh.agent.submitToolResults(CONV, [{ call_id: 'call_9', output: { ok: 1 } }]).finalMessage()
    expect(m.calls[0].url).toBe(`${BASE}/api/v1/agent/conversations/${CONV}/tool-results`)
    expect(JSON.parse(m.calls[0].body as string)).toEqual({ results: [{ call_id: 'call_9', output: { ok: 1 } }], stream: true })
  })
})

describe('collectMessage', () => {
  async function events(frames: string[]) {
    const out: AgentEvent[] = []
    for await (const f of readSSE(chunked(frames))) out.push({ ...JSON.parse(f.data), id: f.id })
    return out
  }

  it('folds a turn into a Message', async () => {
    const message = await collectMessage(await events(turn()))
    expect(message).toMatchObject({
      id: MSG,
      role: 'assistant',
      created_at: '2026-11-16T10:00:00Z',
      status: 'requires_action',
      text: 'Hello world!',
      views: [view],
      plan: [{ id: 's1', title: 'Look', status: 'done' }],
      suggestions: ['Publish it', 'Show more'],
      usage: { credits: 3, requests: 2, input_tokens: 10, output_tokens: 5 },
      error: null,
    })
    expect(message.tool_calls).toEqual([
      { call_id: 'call_1', name: 'org_stats', ok: true, client: false, args: { range: '30d' }, progress: { done: 1, total: 2, label: 'Counting' }, error: null, detail: null },
    ])
    expect(message.citations.map((c) => c.id)).toEqual(['cit_1'])
    expect(message.approvals).toEqual([approval])
  })

  it('shows text live while streaming', () => {
    const b = new AgentMessageBuilder()
    const base = { conversation_id: CONV, message_id: MSG }
    b.apply({ ...base, type: 'message.start', agent_id: 'atlas', role: 'assistant', created_at: 'now', continued: false })
    expect(b.apply({ ...base, type: 'text.delta', delta: 'Hel' })).toMatchObject({ text: 'Hel', status: 'streaming' })
    expect(b.apply({ ...base, type: 'text.delta', delta: 'lo' }).text).toBe('Hello')
  })

  it('folds an approval continuation onto the same message', async () => {
    const first = await collectMessage(await events(turn()))
    const continuation = [
      frame({ type: 'message.start', agent_id: 'atlas', role: 'assistant', created_at: 'later', continued: true }),
      frame({ type: 'approval.resolved', approval_id: 'pnd_1', decision: 'approved', waiting_on: null }),
      frame({ type: 'action.applied', approval_id: 'pnd_1', tool: 'update_course', summary: 'Published', auto: false, undo_available: true }),
      frame({ type: 'text.delta', delta: ' Done.' }),
      frame({ type: 'usage', credits: 1, requests: 1, input_tokens: 1, output_tokens: 1 }),
      frame({ type: 'message.done', status: 'completed', text: 'Hello world! Done.' }),
    ]
    const message = await collectMessage(await events(continuation), first)
    expect(message.id).toBe(MSG)
    expect(message.text).toBe('Hello world! Done.')
    expect(message.status).toBe('completed')
    expect(message.views).toEqual([view])
    expect(message.approvals[0].status).toBe('applied')
    expect(message.actions).toEqual([{ approval_id: 'pnd_1', tool: 'update_course', summary: 'Published', auto: false, undo_available: true }])
    expect(message.usage).toEqual({ credits: 4, requests: 3, input_tokens: 11, output_tokens: 6 })
  })

  it('folds a short "waiting" stream (no message.start) onto the message, still requires_action', async () => {
    const first = await collectMessage(await events(turn()))
    const message = await collectMessage(
      await events([
        frame({ type: 'approval.resolved', approval_id: 'pnd_1', decision: 'approved', waiting_on: { approvals: ['pnd_2'] } }),
        frame({ type: 'message.done', status: 'requires_action', text: '', note: 'Waiting on 1 more approval' }),
      ]),
      first,
    )
    expect(message).toMatchObject({ id: MSG, status: 'requires_action', text: 'Hello world!' })
    expect(message.approvals[0].status).toBe('approved')
    expect(message.views).toEqual([view])
  })

  it('records stream errors and the failed status', async () => {
    const message = await collectMessage(
      await events([
        frame({ type: 'message.start', agent_id: 'copilot', role: 'assistant', created_at: 'now', continued: false }),
        frame({ type: 'error', code: 'out_of_credits', message: 'No credits left', retriable: false }),
        frame({ type: 'message.done', status: 'failed', text: '' }),
      ]),
    )
    expect(message).toMatchObject({ status: 'failed', error: { code: 'out_of_credits', message: 'No credits left' }, text: '' })
  })
})
