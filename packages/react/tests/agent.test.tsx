import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { createClient } from '@learnhouse/sdk'
import type { Approval, View } from '@learnhouse/sdk'
import type { ViewComponentRendererProps } from '../dist/index.js'
import { AgentChat, AgentMarkdown, AgentView, defaultViewRenderers, useAgentConversation } from '../dist/index.js'
import viewExamples from './fixtures/agent-view-examples.json'

const BASE = 'https://api.example.test'
const CONV = 'agconv_1'
const MSG = 'agmsg_1'
const enc = new TextEncoder()

const conversation = {
  id: CONV,
  object: 'conversation',
  agent_id: 'copilot',
  title: 'New conversation',
  created_at: '2026-11-16T10:00:00Z',
  updated_at: '2026-11-16T10:00:00Z',
  status: 'idle',
  context: { course_uuid: null, activity_uuid: null, locale: null },
  instructions: null,
  output: { mode: 'views', json_schema: null, template: null },
  tools: { allow: null, client: [] },
  metadata: {},
  external_user_id: null,
  pending_approvals: [],
  pending_tool_calls: [],
  last_event_id: null,
}

const view: View = {
  id: 'view_1',
  call_id: 'call_1',
  schema_version: 1,
  title: 'Your progress',
  layout: 'stack',
  components: [
    { type: 'kpis', items: [{ label: 'Lessons done', value: 12 }] },
    {
      type: 'table',
      columns: [
        { key: 'course', label: 'Course', format: 'text' },
        { key: 'score', label: 'Score', format: 'percent' },
      ],
      rows: [{ cells: { course: 'Intro to DNS', score: 92 } }],
    },
  ],
  fallback_markdown: '| Course | Score |\n|---|---|\n| Intro to DNS | 92% |',
}

const approval: Approval = {
  id: 'pnd_1',
  tool: 'update_course',
  summary: 'Publish "Intro to DNS"',
  risk: 'write',
  reason: 'ask_first',
  target: { kind: 'course', uuid: 'course_1', name: 'Intro to DNS' },
  args: {},
  estimate_credits: null,
  confirmation: { phrase: 'Intro to DNS', kind: 'type_name', action_label: 'Publish', blast_radius: 'Visible to all learners' },
  status: 'pending',
  can_approve: true,
}

let n = 0
const frame = (event: Record<string, unknown>) =>
  `id: run_1.${++n}.0\nevent: ${event.type}\ndata: ${JSON.stringify({ conversation_id: CONV, message_id: MSG, ...event })}\n\n`

const start = (continued = false) =>
  frame({ type: 'message.start', agent_id: 'copilot', role: 'assistant', created_at: '2026-11-16T10:00:01Z', continued })

/** An SSE response whose chunks are released one by one through `push`. */
function liveStream() {
  let ctrl!: ReadableStreamDefaultController<Uint8Array>
  const body = new ReadableStream<Uint8Array>({ start: (c) => (ctrl = c) })
  return {
    response: new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    push: (s: string) => ctrl.enqueue(enc.encode(s)),
    close: () => ctrl.close(),
    fail: () => ctrl.error(new TypeError('network connection was lost')),
  }
}

const sse = (frames: string[]) =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(c) {
        for (const f of frames) c.enqueue(enc.encode(f))
        c.close()
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  )

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

type Route = (req: { method: string; url: string; body: any; headers: Headers }) => Response | undefined

function api(route: Route) {
  const calls: { method: string; url: string; body: any; headers: Headers }[] = []
  const fetch = vi.fn(async (input: string, init: RequestInit = {}) => {
    const req = {
      method: init.method ?? 'GET',
      url: String(input).replace(BASE, ''),
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
      headers: new Headers(init.headers),
    }
    calls.push(req)
    if (req.method === 'POST' && req.url === '/api/v1/agent/conversations') return json(conversation, 201)
    if (req.method === 'GET' && req.url === `/api/v1/agent/conversations/${CONV}`) return route(req) ?? json(conversation)
    return route(req) ?? json({ detail: { code: 'not_found', message: 'nope' } }, 404)
  })
  return { client: createClient({ baseUrl: BASE, token: 'jwt', fetch, retry: false }), calls }
}

const turnWithApproval = () => [
  start(),
  frame({ type: 'text.delta', delta: 'Here is your ' }),
  frame({ type: 'text.delta', delta: 'progress.' }),
  frame({ type: 'view', view }),
  frame({ type: 'citation', citation: { index: 1, id: 'cit_1', title: 'What is DNS?', source_type: 'dynamic_page', course_uuid: 'course_1', course_name: 'Intro to DNS', chapter_name: 'Basics', activity_uuid: 'activity_1', activity_name: 'What is DNS?', url: '/course/1/activity/1', snippet: '' } }),
  frame({ type: 'approval.required', approval }),
  frame({ type: 'suggestions', items: ['Show my weak spots'] }),
  frame({ type: 'message.done', status: 'requires_action', text: 'Here is your progress.' }),
]

describe('useAgentConversation', () => {
  it('creates the conversation on first send and appends streamed text live', async () => {
    const live = liveStream()
    const { client, calls } = api((req) => (req.url.endsWith('/messages') && req.method === 'POST' ? live.response : undefined))
    const onEvent = vi.fn()
    const { result } = renderHook(() => useAgentConversation({ client, agent: 'copilot', create: { title: 'Help' }, onEvent }))
    expect(result.current.status).toBe('idle')

    act(() => void result.current.send('How am I doing?'))
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/messages'))).toBe(true))
    expect(calls.find((c) => c.url === '/api/v1/agent/conversations')).toMatchObject({ method: 'POST', body: { agent: 'copilot', title: 'Help' } })
    expect(calls.find((c) => c.url.endsWith('/messages'))!.body).toEqual({ content: 'How am I doing?', stream: true })
    expect(result.current.messages[0]).toMatchObject({ role: 'user', text: 'How am I doing?' })
    expect(result.current.status).toBe('streaming')

    act(() => {
      live.push(start())
      live.push(frame({ type: 'text.delta', delta: 'You are ' }))
    })
    await waitFor(() => expect(result.current.messages[1]?.text).toBe('You are '))
    expect(result.current.messages[1].status).toBe('streaming')

    act(() => {
      live.push(frame({ type: 'text.delta', delta: 'on track.' }))
      live.push(frame({ type: 'message.done', status: 'completed', text: 'You are on track.' }))
      live.close()
    })
    await waitFor(() => expect(result.current.status).toBe('idle'))
    expect(result.current.messages[1]).toMatchObject({ role: 'assistant', text: 'You are on track.', status: 'completed' })
    expect(result.current.conversation?.id).toBe(CONV)
    expect(onEvent).toHaveBeenCalledTimes(4)
  })

  it('attaches views, citations and approvals, then approves with the phrase', async () => {
    const { client, calls } = api((req) => {
      if (req.url.endsWith('/messages') && req.method === 'POST') return sse(turnWithApproval())
      if (req.url === '/api/v1/agent/approvals/pnd_1/approve')
        return sse([
          start(true),
          frame({ type: 'approval.resolved', approval_id: 'pnd_1', decision: 'approved', waiting_on: null }),
          frame({ type: 'action.applied', approval_id: 'pnd_1', tool: 'update_course', summary: 'Published', auto: false, undo_available: false }),
          frame({ type: 'text.delta', delta: ' Published.' }),
          frame({ type: 'message.done', status: 'completed', text: '' }),
        ])
      return undefined
    })
    const { result } = renderHook(() => useAgentConversation({ client }))
    await act(() => result.current.send('Publish my course'))
    expect(result.current.status).toBe('requires_action')
    const reply = result.current.messages[1]
    expect(reply.views).toEqual([view])
    expect(reply.citations[0].id).toBe('cit_1')
    expect(result.current.pendingApprovals.map((a) => a.id)).toEqual(['pnd_1'])
    expect(result.current.suggestions).toEqual(['Show my weak spots'])

    await act(() => result.current.approve('pnd_1', 'Intro to DNS'))
    expect(calls.find((c) => c.url.endsWith('/approve'))!.body).toEqual({ stream: true, confirmation_phrase: 'Intro to DNS' })
    expect(result.current.status).toBe('idle')
    expect(result.current.messages).toHaveLength(2)
    expect(result.current.messages[1]).toMatchObject({ id: MSG, text: 'Here is your progress. Published.', status: 'completed' })
    expect(result.current.messages[1].approvals[0].status).toBe('applied')
    expect(result.current.pendingApprovals).toEqual([])
  })

  it('resumes with Last-Event-ID when the stream drops', async () => {
    let first = true
    const { client, calls } = api((req) => {
      if (req.url.endsWith('/messages') && req.method === 'POST') {
        const live = liveStream()
        queueMicrotask(() => {
          live.push(start())
          live.push(frame({ type: 'text.delta', delta: 'Part one, ' }))
          setTimeout(() => live.fail(), 10)
        })
        return live.response
      }
      if (req.url === `/api/v1/agent/conversations/${CONV}/stream` && first) {
        first = false
        return sse([frame({ type: 'text.delta', delta: 'part two.' }), frame({ type: 'message.done', status: 'completed', text: 'Part one, part two.' })])
      }
      return undefined
    })
    const { result } = renderHook(() => useAgentConversation({ client }))
    await act(() => result.current.send('Tell me'))
    const resume = calls.find((c) => c.url.endsWith('/stream'))!
    expect(resume.method).toBe('GET')
    expect(resume.headers.get('last-event-id')).toMatch(/^run_1\.\d+\.0$/)
    expect(result.current.messages[1]).toMatchObject({ text: 'Part one, part two.', status: 'completed' })
    expect(result.current.status).toBe('idle')
  })

  it('loads an existing conversation and re-attaches to a running turn', async () => {
    const { client, calls } = api((req) => {
      if (req.url === `/api/v1/agent/conversations/${CONV}`) return json({ ...conversation, status: 'running' })
      if (req.url.endsWith('/messages') && req.method === 'GET')
        return json({ messages: [{ id: 'agmsg_0', role: 'user', created_at: '', status: 'completed', text: 'Earlier', views: [], citations: [], tool_calls: [], approvals: [], plan: null, suggestions: [], output: null, rendered: null, usage: null, error: null }] })
      if (req.url.endsWith('/stream')) return sse([start(), frame({ type: 'text.delta', delta: 'Still going' }), frame({ type: 'message.done', status: 'completed', text: 'Still going' })])
      return undefined
    })
    const { result } = renderHook(() => useAgentConversation({ client, conversationId: CONV }))
    await waitFor(() => expect(result.current.messages).toHaveLength(2))
    await waitFor(() => expect(result.current.status).toBe('idle'))
    expect(result.current.messages.map((m) => m.text)).toEqual(['Earlier', 'Still going'])
    expect(calls.find((c) => c.url.endsWith('/stream'))!.headers.get('last-event-id')).toBeNull()
  })

  it('surfaces API errors', async () => {
    const { client } = api((req) =>
      req.url.endsWith('/messages') ? json({ detail: { code: 'out_of_credits', message: 'No AI credits left' } }, 402) : undefined,
    )
    const onError = vi.fn()
    const { result } = renderHook(() => useAgentConversation({ client, onError }))
    await act(() => result.current.send('Hi'))
    expect(result.current.status).toBe('error')
    expect(result.current.error).toMatchObject({ code: 'out_of_credits', message: 'No AI credits left' })
    expect(onError).toHaveBeenCalled()
  })

  it('batches client tool results and submits them', async () => {
    const { client, calls } = api((req) => {
      if (req.url.endsWith('/messages') && req.method === 'POST')
        return sse([
          start(),
          frame({ type: 'tool.call', call_id: 'c1', name: 'get_cart', args: {}, client: true }),
          frame({ type: 'tool.call', call_id: 'c2', name: 'get_user', args: { id: 1 }, client: true }),
          frame({ type: 'message.done', status: 'requires_action', text: '' }),
        ])
      if (req.url.endsWith('/tool-results')) return sse([start(true), frame({ type: 'tool.result', call_id: 'c1', name: 'get_cart', ok: true, error: null, detail: null }), frame({ type: 'tool.result', call_id: 'c2', name: 'get_user', ok: true, error: null, detail: null }), frame({ type: 'message.done', status: 'completed', text: 'Done' })])
      return undefined
    })
    const { result } = renderHook(() => useAgentConversation({ client }))
    await act(() => result.current.send('Check out'))
    expect(result.current.pendingToolCalls.map((c) => c.call_id)).toEqual(['c1', 'c2'])
    await act(() => result.current.submitToolResult('c1', { items: 2 }))
    expect(calls.some((c) => c.url.endsWith('/tool-results'))).toBe(false)
    await act(() => result.current.submitToolResult('c2', { name: 'Lea' }))
    expect(calls.find((c) => c.url.endsWith('/tool-results'))!.body).toEqual({
      results: [
        { call_id: 'c1', output: { items: 2 } },
        { call_id: 'c2', output: { name: 'Lea' } },
      ],
      stream: true,
    })
    expect(result.current.pendingToolCalls).toEqual([])
    expect(result.current.status).toBe('idle')
  })
})

describe('useAgentConversation: member sessions and waiting answers', () => {
  it('sends the org id when loading the agent and creating the conversation', async () => {
    const atlas = { id: 'atlas', name: 'Atlas', emoji: '🧭', greeting: 'Hi there', starters: ['Stats?'] }
    const { client, calls } = api((req) => {
      if (req.url.startsWith('/api/v1/agent/agents/atlas')) return req.url.includes('org_id=7') ? json(atlas) : json({ detail: { code: 'invalid_request', message: 'org_id is required with a member session' } }, 422)
      if (req.url.endsWith('/messages') && req.method === 'POST') return sse([start(), frame({ type: 'message.done', status: 'completed', text: 'ok' })])
      return undefined
    })
    const { result } = renderHook(() => useAgentConversation({ client, agent: 'atlas', orgId: 7 }))
    await waitFor(() => expect(result.current.agent?.name).toBe('Atlas'))
    expect(calls[0].url).toBe('/api/v1/agent/agents/atlas?org_id=7')
    await act(() => result.current.send('Hi'))
    expect(calls.find((c) => c.url === '/api/v1/agent/conversations')!.body).toEqual({ org_id: 7, agent: 'atlas' })
  })

  it('stays requires_action without a blank bubble on a short "waiting" approval answer', async () => {
    const second: Approval = { ...approval, id: 'pnd_2', summary: 'Publish "Networking 101"', confirmation: null }
    const { client } = api((req) => {
      if (req.url.endsWith('/messages') && req.method === 'POST')
        return sse([start(), frame({ type: 'text.delta', delta: 'Two to publish.' }), frame({ type: 'approval.required', approval: { ...approval, confirmation: null } }), frame({ type: 'approval.required', approval: second }), frame({ type: 'message.done', status: 'requires_action', text: 'Two to publish.' })])
      if (req.url.endsWith('/approvals/pnd_1/approve'))
        return sse([
          frame({ type: 'approval.resolved', message_id: 'agmsg_other', approval_id: 'pnd_1', decision: 'approved', waiting_on: { approvals: ['pnd_2'] } }),
          frame({ type: 'message.done', message_id: 'agmsg_other', status: 'requires_action', text: '', note: 'Waiting on 1 more approval' }),
        ])
      return undefined
    })
    const { result } = renderHook(() => useAgentConversation({ client }))
    await act(() => result.current.send('Publish both'))
    await act(() => result.current.approve('pnd_1'))
    expect(result.current.status).toBe('requires_action')
    expect(result.current.messages).toHaveLength(2)
    expect(result.current.messages[1]).toMatchObject({ id: MSG, text: 'Two to publish.', status: 'requires_action' })
    expect(result.current.messages[1].approvals.map((a) => a.status)).toEqual(['approved', 'pending'])
    expect(result.current.pendingApprovals.map((a) => a.id)).toEqual(['pnd_2'])
  })
})

describe('built-in renderers with the API\'s schema examples', () => {
  const examples = (viewExamples as { examples: Record<string, Record<string, unknown>> }).examples
  const builtIn = Object.keys(defaultViewRenderers)
  const message = { id: MSG, role: 'assistant', created_at: '', status: 'completed', text: '', views: [], citations: [], tool_calls: [], approvals: [], plan: null, suggestions: [], output: null, rendered: null, usage: null, error: null } as any

  /** Every string and number inside the example, as the user should see it. */
  function visibleValues(component: Record<string, unknown>): string[] {
    const out: string[] = []
    const walk = (v: unknown, key?: string) => {
      if (key === 'type' || key === 'kind' || key === 'uuid' || key === 'format' || key === 'x_key' || key === 'key' || key === '_link' || key === 'link' || key === 'language' || key === 'tone' || key === 'prompt' || key === 'correct' || key === 'explanation') return
      if (typeof v === 'string') out.push(v)
      else if (Array.isArray(v)) v.forEach((x) => walk(x))
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, k)
    }
    walk(component)
    return out
  }

  it.each(builtIn)('%s renders its example with real values', (type) => {
    const component = examples[type]
    expect(component, `no schema example for ${type}`).toBeTruthy()
    const view: View = { id: `view_${type}`, call_id: null, schema_version: 1, title: null, layout: 'stack', components: [component as any], fallback_markdown: `FALLBACK ${type}` }
    const { container } = render(<AgentView view={view} message={message} siteUrl="https://learn.example.com" send={() => {}} />)
    const text = container.textContent ?? ''
    expect(text).not.toContain(`FALLBACK ${type}`)
    expect(text).not.toContain('–')
    for (const value of visibleValues(component)) {
      // Dates on chart axes are clipped; markdown loses its ** markers.
      const shown = value.replace(/\*\*/g, '')
      if (type === 'chart') continue
      expect(text, `${type}: "${value}"`).toContain(shown)
    }
  })

  it('reads flat table rows and opens _link rows on the site', () => {
    const view: View = { id: 'v', call_id: null, schema_version: 1, title: null, layout: 'stack', components: [examples.table as any], fallback_markdown: '' }
    const { container } = render(<AgentView view={view} message={message} siteUrl="https://learn.example.com" />)
    const cells = [...container.querySelectorAll('td')].map((td) => td.textContent)
    expect(cells).toEqual(['Python 101', '62%'])
    expect(container.querySelector('td a')?.getAttribute('href')).toBe('https://learn.example.com/course/x')
  })

  it('renders the chart example as SVG with its labels', () => {
    const view: View = { id: 'v', call_id: null, schema_version: 1, title: null, layout: 'stack', components: [examples.chart as any], fallback_markdown: '' }
    const { container } = render(<AgentView view={view} message={message} />)
    expect(container.querySelectorAll('svg circle').length).toBeGreaterThan(0)
    expect(container.textContent).toContain('2026-11-01'.slice(0, 9))
  })

  it('lets resolveLink map links into your own routes', () => {
    const view: View = { id: 'v', call_id: null, schema_version: 1, title: null, layout: 'stack', components: [examples.table as any], fallback_markdown: '' }
    const { container } = render(<AgentView view={view} message={message} resolveLink={(l) => `/my-app/${l.kind}/${l.uuid}`} />)
    expect(container.querySelector('td a')?.getAttribute('href')).toBe('/my-app/course/course_x')
  })

  it('shows fallback_markdown for every type without a built-in renderer', () => {
    for (const type of Object.keys(examples).filter((t) => !builtIn.includes(t))) {
      const view: View = { id: `view_${type}`, call_id: null, schema_version: 1, title: null, layout: 'stack', components: [examples[type] as any], fallback_markdown: `Fallback for ${type}` }
      const { container, unmount } = render(<AgentView view={view} message={message} />)
      expect(container.textContent).toBe(`Fallback for ${type}`)
      unmount()
    }
  })
})

describe('<AgentChat>', () => {
  it('renders views, citations, suggestions and an approval card that needs the phrase', async () => {
    const { client, calls } = api((req) => {
      if (req.url.endsWith('/messages') && req.method === 'POST') return sse(turnWithApproval())
      if (req.url.endsWith('/deny')) return sse([start(true), frame({ type: 'approval.resolved', approval_id: 'pnd_1', decision: 'denied', waiting_on: null }), frame({ type: 'message.done', status: 'completed', text: '' })])
      return undefined
    })
    const { container } = render(<AgentChat client={client} siteUrl="https://learn.example.com" starters={['How am I doing?']} />)
    fireEvent.click(screen.getByRole('button', { name: 'How am I doing?' }))
    await screen.findByText('Here is your progress.')
    // kpis + table from the default renderers
    expect(screen.getByText('Lessons done')).toBeTruthy()
    expect(screen.getByText('12')).toBeTruthy()
    expect(container.querySelector('.lh-agent-table td')?.textContent).toBe('Intro to DNS')
    expect(screen.getByText('92%')).toBeTruthy()
    // citation linked to the LearnHouse site
    const cite = screen.getByRole('link', { name: 'What is DNS?' })
    expect(cite.getAttribute('href')).toBe('https://learn.example.com/course/1/activity/1')
    expect(screen.getByRole('button', { name: 'Show my weak spots' })).toBeTruthy()
    // approval: Publish stays disabled until the phrase is typed
    const publish = screen.getByRole('button', { name: 'Publish' }) as HTMLButtonElement
    expect(publish.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Type Intro to DNS to confirm'), { target: { value: 'Intro to DNS' } })
    expect(publish.disabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }))
    await screen.findByText('Denied')
    expect(calls.find((c) => c.url.endsWith('/deny'))!.body).toEqual({ stream: true })
  })

  it('uses a renderer override and falls back to markdown for unknown types', async () => {
    const odd: View = { ...view, id: 'view_2', components: [{ type: 'heatmap', values: [] }], fallback_markdown: '**Busiest day**: Monday' }
    const { client } = api((req) =>
      req.url.endsWith('/messages') && req.method === 'POST'
        ? sse([start(), frame({ type: 'view', view }), frame({ type: 'view', view: odd }), frame({ type: 'message.done', status: 'completed', text: '' })])
        : undefined,
    )
    function MyTable({ component }: ViewComponentRendererProps) {
      return <div data-testid="my-table">{(component.rows as unknown[]).length} rows</div>
    }
    const { container } = render(<AgentChat client={client} renderers={{ table: MyTable }} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Stats please' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await screen.findByTestId('my-table')
    expect(screen.getByTestId('my-table').textContent).toBe('1 rows')
    expect(container.querySelector('.lh-agent-table')).toBeNull()
    expect(screen.getByText('Busiest day').tagName).toBe('STRONG')
    expect(screen.getByText('Lessons done')).toBeTruthy()
  })
})

describe('AgentMarkdown', () => {
  it('never injects HTML and drops unsafe links', () => {
    const { container } = render(<AgentMarkdown text={'<img src=x onerror=alert(1)> [bad](javascript:alert(1)) [ok](https://x.test) `a<b>`'} />)
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>')
    const links = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'))
    expect(links).toEqual(['https://x.test'])
    expect(container.querySelector('code')?.textContent).toBe('a<b>')
  })
})

describe('<learnhouse-agent-chat>', () => {
  it('registers with the element entry and renders the chat from attributes', async () => {
    const { AGENT_CHAT_TAG_NAME, LearnHouseAgentChatElement } = await import('../dist/element.js')
    expect(customElements.get(AGENT_CHAT_TAG_NAME)).toBe(LearnHouseAgentChatElement)
    const fetchMock = vi.fn(async () => json({ detail: { code: 'agent_not_found', message: 'x' } }, 404))
    vi.stubGlobal('fetch', fetchMock)
    const el = document.createElement(AGENT_CHAT_TAG_NAME)
    el.setAttribute('base-url', BASE)
    el.setAttribute('agent', 'copilot')
    el.setAttribute('org-id', '7')
    el.setAttribute('starters', JSON.stringify(['What next?']))
    document.body.appendChild(el)
    await waitFor(() => expect(el.querySelector('.lh-agent-composer')).toBeTruthy())
    expect(el.querySelector('.lh-agent-chip')?.textContent).toBe('What next?')
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe(`${BASE}/api/v1/agent/agents/copilot?org_id=7`)
    el.remove()
    vi.unstubAllGlobals()
  })
})
