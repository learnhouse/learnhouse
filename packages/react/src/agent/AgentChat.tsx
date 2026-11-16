import React, { Component, createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import type { Approval, Citation, Message, View, ViewLink } from '@learnhouse/sdk'
import { Markdown, safeHref } from './markdown'
import { defaultViewRenderers } from './renderers'
import type { AgentChatLabels, AgentChatProps, UseAgentConversationReturn, ViewRenderers } from './types'
import { useAgentConversation } from './useAgentConversation'

export const DEFAULT_AGENT_LABELS: AgentChatLabels = {
  send: 'Send',
  stop: 'Stop',
  approve: 'Approve',
  deny: 'Deny',
  typeToConfirm: 'Type {phrase} to confirm',
  sources: 'Sources',
  thinking: 'Thinking…',
  reconnecting: 'Reconnecting…',
  approved: 'Approved',
  denied: 'Denied',
  expired: 'Expired',
  applied: 'Applied',
  error: 'Something went wrong',
}

// Pieces rendered outside <AgentChat> (your own layout) carry the theme
// variables themselves; inside the chat they inherit its (light or dark) ones.
const InChat = createContext(false)
const scoped = (inChat: boolean, className: string) => (inChat ? className : `lh-agent-vars ${className}`)

/** Renders the view's own markdown when one of its components throws. */
class ViewBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    if (typeof console !== 'undefined') console.warn('@learnhouse/react: a view component failed to render', error, info.componentStack)
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

export interface AgentViewProps {
  view: View
  message: Message
  renderers?: ViewRenderers
  send?: (text: string) => void
  siteUrl?: string
  /** Turn a view link (`{kind, uuid}` or `{path}`) into an href; overrides the default. */
  resolveLink?: (link: ViewLink) => string | undefined
}

// Public LearnHouse pages an entity link can open without knowing more than its uuid.
const ENTITY_ROUTES: Record<string, (id: string) => string> = {
  course: (id) => `/course/${id}`,
}

/**
 * Default view links: a relative `path`, or a `{kind, uuid}` with a public
 * page (courses), on `siteUrl`. Without `siteUrl` nothing is linked, since the
 * paths belong to the LearnHouse site, not yours.
 */
export function makeLinkResolver(siteUrl?: string, custom?: (link: ViewLink) => string | undefined) {
  return (link: ViewLink | null | undefined): string | undefined => {
    if (!link || typeof link !== 'object') return undefined
    if (custom) return custom(link)
    if (!siteUrl) return undefined
    const route = link.kind ? ENTITY_ROUTES[link.kind] : undefined
    if (route && link.uuid && /^[A-Za-z0-9_-]{1,120}$/.test(link.uuid)) {
      return safeHref(route(link.uuid.replace(new RegExp(`^${link.kind}_`), '')), siteUrl)
    }
    return link.path ? safeHref(link.path, siteUrl) : undefined
  }
}

/**
 * One view: each component through its renderer. A view with a component type
 * no renderer knows is shown as its `fallback_markdown` instead.
 */
export function AgentView({ view, message, renderers, send, siteUrl, resolveLink: custom }: AgentViewProps) {
  const map = useMemo(() => ({ ...defaultViewRenderers, ...renderers }), [renderers])
  const resolveLink = useMemo(() => makeLinkResolver(siteUrl, custom), [siteUrl, custom])
  const fallback = <Markdown text={view.fallback_markdown ?? ''} linkBase={siteUrl} className="lh-agent-view-fallback" />
  const components = Array.isArray(view.components) ? view.components : []
  const known = components.length > 0 && components.every((c) => c && map[c.type])
  const inChat = useContext(InChat)
  return (
    <section className={scoped(inChat, 'lh-agent-view')} data-layout={view.layout ?? 'stack'} aria-label={view.title ?? undefined}>
      {view.title ? <div className="lh-agent-view-title">{view.title}</div> : null}
      {known ? (
        <ViewBoundary fallback={fallback}>
          <div className="lh-agent-view-body">
            {components.map((component, i) => {
              const Renderer = map[component.type]!
              return <Renderer key={i} component={component} view={view} message={message} send={send} resolveLink={resolveLink} />
            })}
          </div>
        </ViewBoundary>
      ) : (
        fallback
      )}
    </section>
  )
}

export interface ApprovalCardProps {
  approval: Approval
  onApprove: (phrase?: string) => void
  onDeny: (reason?: string) => void
  busy?: boolean
  labels?: Partial<AgentChatLabels>
}

/** Approve / deny a risky action; asks for the confirmation phrase when the action needs one. */
export function ApprovalCard({ approval, onApprove, onDeny, busy, labels }: ApprovalCardProps) {
  const l = { ...DEFAULT_AGENT_LABELS, ...labels }
  const [phrase, setPhrase] = useState('')
  const needs = approval.confirmation
  const pending = approval.status === 'pending'
  const matches = !needs || phrase === needs.phrase
  const inChat = useContext(InChat)
  const statusLabel: Partial<Record<Approval['status'], string>> = {
    approved: l.approved,
    denied: l.denied,
    expired: l.expired,
    superseded: l.expired,
    applied: l.applied,
  }
  return (
    <div className={scoped(inChat, 'lh-agent-approval')} data-risk={approval.risk} data-status={approval.status}>
      <div className="lh-agent-approval-head">
        <span className="lh-agent-badge" data-tone={approval.risk === 'destructive' ? 'danger' : 'warning'}>
          {approval.risk}
        </span>
        <span className="lh-agent-approval-summary">{approval.summary}</span>
      </div>
      {approval.target?.name ? (
        <div className="lh-agent-muted">
          {approval.target.kind}: {approval.target.name}
        </div>
      ) : null}
      {needs?.blast_radius ? <div className="lh-agent-muted">{needs.blast_radius}</div> : null}
      {approval.estimate_credits ? <div className="lh-agent-muted">≈ {approval.estimate_credits} credits</div> : null}
      {pending ? (
        <form
          className="lh-agent-approval-actions"
          onSubmit={(e) => {
            e.preventDefault()
            if (matches && approval.can_approve) onApprove(needs ? phrase : undefined)
          }}
        >
          {needs ? (
            <label className="lh-agent-confirm">
              <span>{l.typeToConfirm.replace('{phrase}', needs.phrase)}</span>
              <input
                className="lh-agent-input"
                value={phrase}
                onChange={(e) => setPhrase(e.target.value)}
                placeholder={needs.phrase}
                autoComplete="off"
                spellCheck={false}
                aria-label={l.typeToConfirm.replace('{phrase}', needs.phrase)}
              />
            </label>
          ) : null}
          <button type="submit" className="lh-agent-btn lh-agent-btn-primary" disabled={busy || !matches || !approval.can_approve}>
            {needs?.action_label || l.approve}
          </button>
          <button type="button" className="lh-agent-btn" disabled={busy} onClick={() => onDeny()}>
            {l.deny}
          </button>
        </form>
      ) : (
        <div className="lh-agent-approval-status">{statusLabel[approval.status] ?? approval.status}</div>
      )}
    </div>
  )
}

export function CitationList({
  citations,
  siteUrl,
  linkTarget,
  label,
  renderCitation,
}: {
  citations: Citation[]
  siteUrl?: string
  linkTarget?: string
  label?: string
  renderCitation?: AgentChatProps['renderCitation']
}) {
  const inChat = useContext(InChat)
  if (!citations.length) return null
  return (
    <div className={scoped(inChat, 'lh-agent-citations')}>
      <div className="lh-agent-citations-label">{label ?? DEFAULT_AGENT_LABELS.sources}</div>
      <ol>
        {citations.map((c) => {
          const href = c.url ? safeHref(c.url, siteUrl) : undefined
          const where = [c.course_name, c.chapter_name, c.activity_name].filter(Boolean).join(' · ')
          const entry = (
            <li key={c.id ?? c.index} className="lh-agent-citation">
              <span className="lh-agent-citation-index">{c.index}</span>
              <span>
                {href ? (
                  <a href={href} target={linkTarget ?? '_blank'} rel="noopener noreferrer">
                    {c.title}
                  </a>
                ) : (
                  <span>{c.title}</span>
                )}
                {where ? <span className="lh-agent-muted"> {where}</span> : null}
              </span>
            </li>
          )
          return renderCitation ? <React.Fragment key={c.id ?? c.index}>{renderCitation(c, entry)}</React.Fragment> : entry
        })}
      </ol>
    </div>
  )
}

interface MessageViewProps {
  message: Message
  chat: UseAgentConversationReturn
  props: AgentChatProps
}

function MessageView({ message, chat, props }: MessageViewProps) {
  const l = { ...DEFAULT_AGENT_LABELS, ...props.labels }
  const send = chat.status === 'streaming' ? undefined : (text: string) => void chat.send(text)
  if (message.role === 'user') {
    return (
      <div className="lh-agent-msg" data-role="user">
        <div className="lh-agent-bubble">{message.text}</div>
      </div>
    )
  }
  const streaming = message.status === 'streaming'
  const empty = !message.text && !message.views.length && !message.approvals.length
  return (
    <div className="lh-agent-msg" data-role="assistant" data-status={message.status}>
      <div className="lh-agent-bubble">
        {message.plan?.length ? (
          <ol className="lh-agent-plan">
            {message.plan.map((s) => (
              <li key={s.id} data-status={s.status}>
                {s.title}
              </li>
            ))}
          </ol>
        ) : null}
        {message.tool_calls.some((c) => c.ok === null && !c.client) && streaming ? (
          <div className="lh-agent-tools">
            {message.tool_calls
              .filter((c) => c.ok === null && !c.client)
              .map((c) => (
                <span key={c.call_id} className="lh-agent-tool">
                  {c.progress?.label ?? c.name}
                  {c.progress?.total ? ` ${c.progress.done}/${c.progress.total}` : ''}
                </span>
              ))}
          </div>
        ) : null}
        {message.text ? <Markdown text={message.text} linkBase={props.siteUrl} linkTarget={props.linkTarget} /> : null}
        {streaming && empty ? <div className="lh-agent-thinking">{l.thinking}</div> : null}
        {message.views.map((view) => {
          const node = <AgentView key={view.id} view={view} message={message} renderers={props.renderers} send={send} siteUrl={props.siteUrl} resolveLink={props.resolveLink} />
          return props.renderView ? <React.Fragment key={view.id}>{props.renderView(view, node, message)}</React.Fragment> : node
        })}
        {message.rendered && message.rendered.format !== 'html' ? <Markdown text={message.rendered.content} /> : null}
        {message.approvals.map((a) => (
          <ApprovalCard
            key={a.id}
            approval={a}
            busy={chat.status === 'streaming'}
            labels={props.labels}
            onApprove={(phrase) => void chat.approve(a.id, phrase)}
            onDeny={(reason) => void chat.deny(a.id, reason)}
          />
        ))}
        {message.actions?.length ? (
          <ul className="lh-agent-actions">
            {message.actions.map((a) => (
              <li key={a.approval_id}>✓ {a.summary}</li>
            ))}
          </ul>
        ) : null}
        {message.error ? (
          <div className="lh-agent-error" role="alert">
            {message.error.message}
          </div>
        ) : null}
        <CitationList citations={message.citations} siteUrl={props.siteUrl} linkTarget={props.linkTarget} label={l.sources} renderCitation={props.renderCitation} />
      </div>
    </div>
  )
}

function Composer({ chat, props }: { chat: UseAgentConversationReturn; props: AgentChatProps }) {
  const l = { ...DEFAULT_AGENT_LABELS, ...props.labels }
  const [text, setText] = useState('')
  const streaming = chat.status === 'streaming'
  const submit = () => {
    const value = text.trim()
    if (!value || streaming) return
    setText('')
    void chat.send(value)
  }
  return (
    <form
      className="lh-agent-composer"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <textarea
        className="lh-agent-input"
        rows={1}
        value={text}
        placeholder={props.placeholder ?? 'Ask anything…'}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            submit()
          }
        }}
        aria-label={props.placeholder ?? 'Message'}
      />
      {streaming ? (
        <button type="button" className="lh-agent-btn" onClick={() => void chat.cancel()}>
          {l.stop}
        </button>
      ) : (
        <button type="submit" className="lh-agent-btn lh-agent-btn-primary" disabled={!text.trim() || chat.status === 'loading'}>
          {l.send}
        </button>
      )}
    </form>
  )
}

function AgentChatView({ chat, props }: { chat: UseAgentConversationReturn; props: AgentChatProps }) {
  const l = { ...DEFAULT_AGENT_LABELS, ...props.labels }
  const listRef = useRef<HTMLDivElement>(null)
  const last = chat.messages[chat.messages.length - 1]
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [chat.messages.length, last?.text, last?.views.length])
  const [prefersDark, setPrefersDark] = useState(false)
  useEffect(() => {
    if (props.theme !== 'auto' || typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    setPrefersDark(mq.matches)
    const on = (e: MediaQueryListEvent) => setPrefersDark(e.matches)
    mq.addEventListener?.('change', on)
    return () => mq.removeEventListener?.('change', on)
  }, [props.theme])
  const dark = props.theme === 'dark' || (props.theme === 'auto' && prefersDark)
  const starters = props.starters ?? chat.agent?.starters ?? []
  const greeting = props.greeting ?? chat.agent?.greeting
  const idle = chat.status !== 'streaming' && chat.status !== 'loading'
  return (
    <InChat.Provider value={true}>
      <div className={['lh-agent', dark ? 'dark' : '', props.className].filter(Boolean).join(' ')} style={props.style} data-status={chat.status}>
        <div className="lh-agent-messages" ref={listRef} aria-live="polite">
          {!chat.messages.length && (greeting || starters.length) ? (
            <div className="lh-agent-empty">
              {greeting ? <div className="lh-agent-greeting">{greeting}</div> : null}
              {starters.length ? (
                <div className="lh-agent-chips">
                  {starters.map((s) => (
                    <button key={s} type="button" className="lh-agent-chip" disabled={!idle} onClick={() => void chat.send(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          {chat.messages.map((m) => {
            const node = <MessageView key={m.id} message={m} chat={chat} props={props} />
            return props.renderMessage ? <React.Fragment key={m.id}>{props.renderMessage(m, node)}</React.Fragment> : node
          })}
          {chat.reconnecting ? <div className="lh-agent-muted lh-agent-reconnecting">{l.reconnecting}</div> : null}
          {chat.error && chat.status !== 'streaming' ? (
            <div className="lh-agent-error" role="alert">
              {chat.error.message || l.error}
            </div>
          ) : null}
        </div>
        {chat.suggestions.length && idle ? (
          <div className="lh-agent-chips lh-agent-suggestions">
            {chat.suggestions.map((s) => (
              <button key={s} type="button" className="lh-agent-chip" onClick={() => void chat.send(s)}>
                {s}
              </button>
            ))}
          </div>
        ) : null}
        <Composer chat={chat} props={props} />
      </div>
    </InChat.Provider>
  )
}

function AgentChatOwn(props: AgentChatProps) {
  const chat = useAgentConversation(props)
  return <AgentChatView chat={chat} props={props} />
}

/**
 * A ready-made chat on the Agent API: message list, composer, approval cards,
 * citations, suggestion chips and view rendering. Pass `conversation` (a
 * `useAgentConversation()` result) to drive it yourself.
 */
export function AgentChat(props: AgentChatProps) {
  return props.conversation ? <AgentChatView chat={props.conversation} props={props} /> : <AgentChatOwn {...props} />
}
