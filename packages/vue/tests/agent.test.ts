import { defineComponent, h } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { createClient } from '@learnhouse/sdk'
import { AgentChat, LearnHouseProvider, useAgentConversation } from '../dist/index.js'

const BASE = 'https://api.example.test'
const CONV = 'agconv_1'
const MSG = 'agmsg_1'
const enc = new TextEncoder()

async function until(check: () => unknown, timeout = 10000) {
  const start = Date.now()
  for (;;) {
    await flushPromises()
    try {
      if (check()) return
    } catch {}
    if (Date.now() - start > timeout) throw new Error('timed out waiting for condition')
    await new Promise((r) => setTimeout(r, 20))
  }
}

let n = 0
const frame = (event: Record<string, unknown>) =>
  `id: run_1.${++n}.0\nevent: ${event.type}\ndata: ${JSON.stringify({ conversation_id: CONV, message_id: MSG, ...event })}\n\n`

const sse = (frames: string[]) =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(c) {
        for (const f of frames) c.enqueue(enc.encode(f))
        c.close()
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  )

describe('AgentChat (Vue)', () => {
  it('wraps <learnhouse-agent-chat> with the provider defaults and re-emits its events', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })))
    const onEvent = vi.fn()
    const App = defineComponent({
      setup: () => () =>
        h(LearnHouseProvider, { baseUrl: BASE, siteUrl: 'https://learn.example.com' }, {
          default: () => h(AgentChat, { agent: 'copilot', orgId: 7, starters: ['What next?'], placeholder: 'Ask me', onEvent }),
        }),
    })
    const wrapper = mount(App, { attachTo: document.body })
    const el = wrapper.element.querySelector('learnhouse-agent-chat') as any
    expect(el).toBeTruthy()
    await until(() => el.querySelector('.lh-agent-composer'))
    expect(el.baseUrl).toBe(BASE)
    expect(el.agent).toBe('copilot')
    expect(el.orgId).toBe(7)
    expect(el.siteUrl).toBe('https://learn.example.com')
    expect(el.client).toBeTruthy()
    expect(el.querySelector('textarea').getAttribute('placeholder')).toBe('Ask me')
    expect(el.querySelector('.lh-agent-chip').textContent).toBe('What next?')
    el.dispatchEvent(new CustomEvent('lh-agent-event', { detail: { type: 'text.delta', delta: 'x' } }))
    expect(onEvent).toHaveBeenCalledWith({ type: 'text.delta', delta: 'x' })
    wrapper.unmount()
  })
})

describe('useAgentConversation (Vue)', () => {
  it('creates a conversation and folds the stream into messages', async () => {
    const fetch = vi.fn(async (url: string, init: RequestInit = {}) => {
      if (url.endsWith('/api/v1/agent/conversations') && init.method === 'POST')
        return new Response(JSON.stringify({ id: CONV, status: 'idle' }), { status: 201, headers: { 'content-type': 'application/json' } })
      return sse([
        frame({ type: 'message.start', agent_id: 'copilot', role: 'assistant', created_at: 'now', continued: false }),
        frame({ type: 'text.delta', delta: 'Hi ' }),
        frame({ type: 'text.delta', delta: 'there' }),
        frame({ type: 'message.done', status: 'completed', text: 'Hi there' }),
      ])
    })
    const client = createClient({ baseUrl: BASE, token: 'jwt', fetch })
    let chat!: ReturnType<typeof useAgentConversation>
    mount(defineComponent({ setup: () => ((chat = useAgentConversation({ client, orgId: 7 })), () => h('div')) }))
    await chat.send('Hello')
    expect(chat.status.value).toBe('idle')
    expect(chat.messages.value.map((m) => [m.role, m.text])).toEqual([
      ['user', 'Hello'],
      ['assistant', 'Hi there'],
    ])
    expect(JSON.parse(fetch.mock.calls[0][1]!.body as string)).toEqual({ org_id: 7, agent: 'copilot' })
    expect(fetch.mock.calls[1][0]).toBe(`${BASE}/api/v1/agent/conversations/${CONV}/messages`)
  })

  it('keeps requires_action and adds no bubble on a short "waiting" approval answer', async () => {
    const approval = (id: string) => ({ id, tool: 't', summary: id, risk: 'write', reason: 'ask_first', target: null, args: {}, estimate_credits: null, confirmation: null, status: 'pending', can_approve: true })
    const fetch = vi.fn(async (url: string, init: RequestInit = {}) => {
      if (url.endsWith('/api/v1/agent/conversations') && init.method === 'POST')
        return new Response(JSON.stringify({ id: CONV, status: 'idle' }), { status: 201, headers: { 'content-type': 'application/json' } })
      if (url.endsWith('/approvals/a1/approve'))
        return sse([
          frame({ type: 'approval.resolved', message_id: 'other', approval_id: 'a1', decision: 'approved', waiting_on: null }),
          frame({ type: 'message.done', message_id: 'other', status: 'requires_action', text: '', note: 'waiting' }),
        ])
      return sse([
        frame({ type: 'message.start', agent_id: 'atlas', role: 'assistant', created_at: 'now', continued: false }),
        frame({ type: 'approval.required', approval: approval('a1') }),
        frame({ type: 'approval.required', approval: approval('a2') }),
        frame({ type: 'message.done', status: 'requires_action', text: 'Two actions' }),
      ])
    })
    const client = createClient({ baseUrl: BASE, token: 'jwt', fetch })
    let chat!: ReturnType<typeof useAgentConversation>
    mount(defineComponent({ setup: () => ((chat = useAgentConversation({ client })), () => h('div')) }))
    await chat.send('Do both')
    await chat.approve('a1')
    expect(chat.status.value).toBe('requires_action')
    expect(chat.messages.value).toHaveLength(2)
    expect(chat.messages.value[1].text).toBe('Two actions')
    expect(chat.pendingApprovals.value.map((a) => a.id)).toEqual(['a2'])
  })
})
