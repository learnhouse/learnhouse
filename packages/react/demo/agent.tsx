// Agent API demo: a custom copilot UI on useAgentConversation (not <AgentChat>).
// Own bubbles, own KPI renderer, own approval card and citation footnotes; every
// other view type goes through the package's <AgentView> default renderers.
//
//   bun run demo   →  http://localhost:3538/agent.html?base=http://localhost:1377&token=<jwt>&agent=atlas&org=1
//
// `token`: a member session JWT (needs `org`) or an embed session (learner agents only).
// Never paste an `lh_` API token into a browser outside local testing.
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { createClient } from '@learnhouse/sdk'
import type { Agent, AgentEvent, Approval, Citation, Conversation, KpisComponent, Message } from '@learnhouse/sdk'
import { AgentMarkdown, AgentView, useAgentConversation } from '../dist/index.js'
import type { ViewComponentRendererProps } from '../dist/index.js'
import '../dist/styles.css'

const params = new URLSearchParams(location.search)
const config = {
  base: params.get('base') ?? 'http://localhost:1377',
  token: params.get('token') ?? '',
  agent: params.get('agent') ?? 'atlas',
  org: params.get('org') ? Number(params.get('org')) : undefined,
  conversation: params.get('conversation'),
  course: params.get('course'),
  site: params.get('site') ?? 'http://localhost:3000',
}

// ── A custom renderer for one view type ─────────────────────────────────────
const TILE_COLORS = ['#0f766e', '#7c3aed', '#c2410c', '#0369a1', '#be185d', '#4d7c0f']
function KpiTiles({ component }: ViewComponentRendererProps<KpisComponent>) {
  return (
    <div className="tiles">
      {component.items.map((item, i) => (
        <div key={i} className="tile" style={{ background: TILE_COLORS[i % TILE_COLORS.length] }}>
          <span>{item.label}</span>
          <b>
            {typeof item.value === 'number' ? item.value.toLocaleString() : item.value}
            {item.unit ? <small> {item.unit}</small> : null}
          </b>
          {typeof item.delta === 'number' ? <span>{item.delta > 0 ? '↑' : item.delta < 0 ? '↓' : '→'} {Math.abs(item.delta)}</span> : null}
        </div>
      ))}
    </div>
  )
}
const renderers = { kpis: KpiTiles }

// ── A custom approval card ──────────────────────────────────────────────────
function Approve({ approval, busy, onApprove, onDeny }: { approval: Approval; busy: boolean; onApprove: (p?: string) => void; onDeny: () => void }) {
  const [phrase, setPhrase] = useState('')
  const needs = approval.confirmation
  if (approval.status !== 'pending') return <div className="meta">Action {approval.status}: {approval.summary}</div>
  return (
    <div className={`approval ${approval.risk}`}>
      <strong>⚠️ {approval.summary}</strong>
      {needs ? (
        <>
          <span className="meta">{needs.blast_radius} Type <code>{needs.phrase}</code> to confirm.</span>
          <input value={phrase} onChange={(e) => setPhrase(e.target.value)} placeholder={needs.phrase} aria-label="Confirmation phrase" />
        </>
      ) : null}
      <div className="actions">
        <button className="btn primary" disabled={busy || !approval.can_approve || (!!needs && phrase !== needs.phrase)} onClick={() => onApprove(needs ? phrase : undefined)}>
          {needs?.action_label || 'Approve'}
        </button>
        <button className="btn" disabled={busy} onClick={onDeny}>
          Deny
        </button>
      </div>
    </div>
  )
}

function Footnotes({ citations }: { citations: Citation[] }) {
  if (!citations.length) return null
  return (
    <div className="footnotes">
      {citations.map((c) => (
        <a key={c.id} className="footnote" href={c.url ? `${config.site}${c.url}` : undefined} target="_blank" rel="noreferrer" title={c.snippet}>
          [{c.index}] {c.title}
        </a>
      ))}
    </div>
  )
}

function Bubble({ message, agent, chat }: { message: Message; agent: Agent | null; chat: ReturnType<typeof useAgentConversation> }) {
  if (message.role === 'user') {
    return (
      <div className="row user">
        <div className="avatar">🙂</div>
        <div className="bubble">{message.text}</div>
      </div>
    )
  }
  const streaming = message.status === 'streaming'
  const running = message.tool_calls.filter((c) => c.ok === null && !c.client)
  return (
    <div className="row">
      <div className="avatar" style={agent?.color ? { background: agent.color } : undefined}>{agent?.emoji ?? '🤖'}</div>
      <div className="bubble">
        {running.length && streaming ? <div className="meta">Working: {running.map((c) => c.progress?.label ?? c.name).join(', ')}…</div> : null}
        {message.text ? <AgentMarkdown text={message.text} linkBase={config.site} /> : null}
        {streaming ? <span className="cursor" /> : null}
        {message.views.map((v) => (
          <AgentView key={v.id} view={v} message={message} renderers={renderers} siteUrl={config.site} send={(t) => void chat.send(t)} />
        ))}
        {message.approvals.map((a) => (
          <Approve key={a.id} approval={a} busy={chat.status === 'streaming'} onApprove={(p) => void chat.approve(a.id, p)} onDeny={() => void chat.deny(a.id, 'Not now')} />
        ))}
        <Footnotes citations={message.citations} />
        {message.error ? <div className="error">{message.error.message}</div> : null}
        {message.usage ? <div className="meta">{message.usage.credits} credits</div> : null}
      </div>
    </div>
  )
}

function Setup() {
  return (
    <form className="setup" method="get">
      <h1 style={{ margin: 0, fontSize: 18 }}>Agent API demo</h1>
      <p style={{ margin: 0, color: 'var(--muted)', fontSize: 13 }}>
        A custom chat UI built on <code>useAgentConversation</code> from @learnhouse/react, talking to a LearnHouse API.
      </p>
      <label>API base URL<input name="base" defaultValue={config.base} /></label>
      <label>Token (member JWT or embed session)<input name="token" required /></label>
      <label>Agent (atlas, copilot, agent_…)<input name="agent" defaultValue={config.agent} /></label>
      <label>Org id (member sessions only)<input name="org" defaultValue={config.org ?? ''} /></label>
      <label>Site URL (for citation links)<input name="site" defaultValue={config.site} /></label>
      <button className="btn primary" type="submit">Open the chat</button>
    </form>
  )
}

function Demo() {
  const client = useMemo(() => createClient({ baseUrl: config.base, token: config.token }), [])
  const [conversationId, setConversationId] = useState<string | null>(config.conversation)
  const [recent, setRecent] = useState<Conversation[]>([])
  const [log, setLog] = useState<string[]>([])
  const [text, setText] = useState('')
  const threadRef = useRef<HTMLDivElement>(null)

  const chat = useAgentConversation({
    client,
    agent: config.agent,
    orgId: config.org,
    conversationId,
    create: {
      title: 'Agent API demo',
      context: config.course ? { course_uuid: config.course } : undefined,
      metadata: { source: 'agent-api-demo' },
    },
    onEvent: (e: AgentEvent) => setLog((l) => [`${e.id ?? ''} ${e.type}${e.type === 'text.delta' ? ` ${JSON.stringify(e.delta)}` : ''}`, ...l].slice(0, 300)),
    onConversation: (c) => {
      setConversationId(c.id)
      const url = new URL(location.href)
      url.searchParams.set('conversation', c.id)
      window.history.replaceState(null, '', url)
    },
  })

  // The agent's profile, loaded by the hook (with org_id for member sessions).
  const agent = chat.agent
  useEffect(() => {
    client.agent.listConversations({ orgId: config.org, agent: config.agent, limit: 20 }).then(setRecent).catch(() => {})
  }, [client, chat.conversation?.id])
  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight })
  }, [chat.messages])

  const busy = chat.status === 'streaming' || chat.status === 'loading'
  const submit = (value: string) => {
    if (!value.trim() || busy) return
    setText('')
    void chat.send(value)
  }

  return (
    <div className="demo">
      <aside className="side">
        <div>
          <h1>Agent API demo</h1>
          <small>{config.base}</small>
        </div>
        {agent ? (
          <div className="agent-badge">
            <span className="emoji">{agent.emoji ?? '🤖'}</span>
            <div>
              <strong>{agent.name}</strong>
              <div><small>{agent.description}</small></div>
            </div>
          </div>
        ) : null}
        <button className="btn" onClick={() => { chat.reset(); setConversationId(null) }}>+ New conversation</button>
        <div>
          <small>Recent</small>
          {recent.map((c) => (
            <button key={c.id} className="conv" data-active={c.id === chat.conversation?.id || undefined} onClick={() => setConversationId(c.id)}>
              {c.title || c.id}
            </button>
          ))}
        </div>
      </aside>
      <main className="chat">
        <div className="thread" ref={threadRef}>
          {!chat.messages.length ? (
            <div style={{ margin: 'auto', textAlign: 'center', color: 'var(--muted)' }}>
              <div style={{ fontSize: 32 }}>{agent?.emoji ?? '🤖'}</div>
              <p>{agent?.greeting ?? `Ask ${agent?.name ?? 'the agent'} anything.`}</p>
              <div className="suggest" style={{ justifyContent: 'center' }}>
                {(agent?.starters ?? []).map((s) => (
                  <button key={s} className="btn" onClick={() => submit(s)}>{s}</button>
                ))}
              </div>
            </div>
          ) : null}
          {chat.messages.map((m) => (
            <Bubble key={m.id} message={m} agent={agent} chat={chat} />
          ))}
        </div>
        <div className="status">
          {chat.reconnecting ? 'Reconnecting…' : chat.status}
          {chat.pendingApprovals.length ? ` · ${chat.pendingApprovals.length} approval(s) waiting` : ''}
          {chat.error ? <span className="error"> · {chat.error.message}</span> : null}
        </div>
        {chat.suggestions.length && !busy ? (
          <div className="suggest">
            {chat.suggestions.map((s) => (
              <button key={s} className="btn" onClick={() => submit(s)}>{s}</button>
            ))}
          </div>
        ) : null}
        <form className="composer" onSubmit={(e) => { e.preventDefault(); submit(text) }}>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder={`Message ${agent?.name ?? config.agent}…`} />
          {chat.status === 'streaming' ? (
            <button type="button" className="btn" onClick={() => void chat.cancel()}>Stop</button>
          ) : (
            <button type="submit" className="btn primary" disabled={!text.trim() || busy}>Send</button>
          )}
        </form>
      </main>
      <aside className="log">
        <h2>Stream events</h2>
        {log.join('\n')}
      </aside>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(config.token ? <Demo /> : <Setup />)
