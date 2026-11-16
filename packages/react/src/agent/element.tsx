// <learnhouse-agent-chat>: <AgentChat> as a custom element, for apps that
// don't render React (Vue, Svelte, plain HTML). Registered by the element
// entry (@learnhouse/react/element), next to <learnhouse-activity>.
import React from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { AgentChat } from './AgentChat'
import type { AgentChatProps } from './types'

export const AGENT_CHAT_TAG_NAME = 'learnhouse-agent-chat'

const STRING_ATTRS = {
  'base-url': 'baseUrl',
  token: 'token',
  session: 'session',
  agent: 'agent',
  'org-id': 'orgId',
  'conversation-id': 'conversationId',
  'site-url': 'siteUrl',
  placeholder: 'placeholder',
  theme: 'theme',
  'link-target': 'linkTarget',
} as const
const JSON_ATTRS = { starters: 'starters', create: 'create', labels: 'labels' } as const

const PROPERTIES = [
  ...Object.values(STRING_ATTRS),
  ...Object.values(JSON_ATTRS),
  'client',
  'greeting',
  'renderers',
  'reconnect',
] as const
type Property = (typeof PROPERTIES)[number]

const Base: typeof HTMLElement = typeof HTMLElement === 'undefined' ? (class {} as any) : HTMLElement

export class LearnHouseAgentChatElement extends Base {
  static observedAttributes = [...Object.keys(STRING_ATTRS), ...Object.keys(JSON_ATTRS)]

  private values: Partial<Record<Property, any>> = {}
  private root: Root | null = null
  private scheduled = false

  constructor() {
    super()
    for (const name of PROPERTIES) {
      if (Object.prototype.hasOwnProperty.call(this, name)) {
        const value = (this as any)[name]
        delete (this as any)[name]
        this.values[name] = value
      }
    }
  }

  connectedCallback() {
    if (!this.root) this.root = createRoot(this)
    this.schedule()
  }

  disconnectedCallback() {
    queueMicrotask(() => {
      if (this.isConnected || !this.root) return
      this.root.unmount()
      this.root = null
    })
  }

  attributeChangedCallback(name: string, _old: string | null, value: string | null) {
    if (name in STRING_ATTRS) {
      this.values[STRING_ATTRS[name as keyof typeof STRING_ATTRS]] = value ?? undefined
    } else if (name in JSON_ATTRS) {
      try {
        this.values[JSON_ATTRS[name as keyof typeof JSON_ATTRS]] = value === null ? undefined : JSON.parse(value)
      } catch (error) {
        console.error(`<${AGENT_CHAT_TAG_NAME}>: the ${name} attribute is not valid JSON`, error)
      }
    }
    this.schedule()
  }

  private schedule() {
    if (this.scheduled) return
    this.scheduled = true
    queueMicrotask(() => {
      this.scheduled = false
      this.render()
    })
  }

  private emit(type: string, detail: unknown) {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }))
  }

  private render() {
    if (!this.root) return
    const v = this.values
    const props: AgentChatProps = {
      client: v.client,
      baseUrl: v.baseUrl,
      token: v.token,
      session: v.session,
      agent: v.agent,
      orgId: v.orgId === undefined || v.orgId === null || v.orgId === '' ? undefined : Number(v.orgId),
      conversationId: v.conversationId,
      create: v.create,
      siteUrl: v.siteUrl,
      placeholder: v.placeholder,
      theme: v.theme,
      linkTarget: v.linkTarget,
      starters: v.starters,
      greeting: v.greeting,
      labels: v.labels,
      renderers: v.renderers,
      reconnect: v.reconnect,
      onEvent: (event) => this.emit('lh-agent-event', event),
      onConversation: (conversation) => this.emit('lh-agent-conversation', conversation),
      onError: (error) => this.emit('lh-agent-error', error),
    }
    this.root.render(<AgentChat {...props} />)
  }
}

for (const name of PROPERTIES) {
  Object.defineProperty(LearnHouseAgentChatElement.prototype, name, {
    configurable: true,
    enumerable: true,
    get(this: any) {
      return this.values[name]
    },
    set(this: any, value: unknown) {
      this.values[name] = value
      this.schedule()
    },
  })
}

/** Registers <learnhouse-agent-chat> (once; safe to call again). */
export function defineLearnHouseAgentChat(tagName: string = AGENT_CHAT_TAG_NAME) {
  if (typeof customElements === 'undefined' || customElements.get(tagName)) return
  customElements.define(tagName, tagName === AGENT_CHAT_TAG_NAME ? LearnHouseAgentChatElement : class extends LearnHouseAgentChatElement {})
}
