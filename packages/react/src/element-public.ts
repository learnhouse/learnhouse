// Types-only entry for dist/element.d.ts (the runtime entry is element.tsx,
// which bundles web source). tests/exports.test.ts keeps both in sync.
import type { LearnHouseClient } from '@learnhouse/sdk'
import type {
  ActivityDocument,
  GetLearnHouseSession,
  LearnHouseActivityData,
  LearnHouseSessionInput,
  LearnHouseActivityProps,
  LearnHouseEvent,
  LearnHouseTheme,
} from './types'

export type { ActivityDocument, GetLearnHouseSession, LearnHouseActivityData, LearnHouseEvent, LearnHouseSessionInput, LearnHouseTheme }

/** `detail` of the cancelable `lh-link-click` event. Call `preventDefault()` on the event to stop the navigation. */
export interface LearnHouseLinkClickDetail {
  type: 'link_click'
  href: string
  external: boolean
  originalEvent: MouseEvent
}

/** DOM events of <learnhouse-activity>, with what each carries in `detail`. */
export interface LearnHouseActivityElementEventMap {
  'lh-event': CustomEvent<LearnHouseEvent>
  'lh-load': CustomEvent<Extract<LearnHouseEvent, { type: 'load' }>>
  'lh-ready': CustomEvent<Extract<LearnHouseEvent, { type: 'ready' }>>
  'lh-error': CustomEvent<Extract<LearnHouseEvent, { type: 'error' }>>
  'lh-link-click': CustomEvent<LearnHouseLinkClickDetail>
  'lh-media': CustomEvent<Extract<LearnHouseEvent, { type: 'media' }>>
  'lh-resize': CustomEvent<Extract<LearnHouseEvent, { type: 'resize' }>>
  'lh-visible': CustomEvent<Extract<LearnHouseEvent, { type: 'visible' }>>
  'lh-complete': CustomEvent<Extract<LearnHouseEvent, { type: 'complete' }>>
  'lh-progress': CustomEvent<Extract<LearnHouseEvent, { type: 'progress' }>>
  'lh-session-expired': CustomEvent<Extract<LearnHouseEvent, { type: 'session_expired' }>>
  'lh-analytics': CustomEvent<Extract<LearnHouseEvent, { type: 'analytics' }>>
}

export declare class LearnHouseActivityElement extends HTMLElement {
  activityId?: string
  activityName?: string
  courseId?: string
  activity?: LearnHouseActivityData
  content?: ActivityDocument | string
  baseUrl?: string
  mediaUrl?: string
  siteUrl?: string
  orgId?: string
  /**
   * The learner session: an embed session minted on your server (the object,
   * or its `access_token`; the `session` attribute takes the token string).
   * Never pass an `lh_` API token to the browser.
   */
  session?: LearnHouseSessionInput | null
  /** Fetches a new learner session from your server before the current one expires. */
  getSession?: GetLearnHouseSession
  /** @deprecated Use `session`. */
  token?: string
  /** @deprecated Use `getSession`. */
  getToken?: () => string | null | undefined | Promise<string | null | undefined>
  client?: LearnHouseClient
  user?: Record<string, any>
  theme?: LearnHouseTheme
  locale?: string
  messages?: Record<string, any>
  hideBlocks?: string[]
  linkTarget?: LearnHouseActivityProps['linkTarget']
  trackCompletion?: boolean
  /** `button` (default with a session), `scroll` or `none`. */
  completion?: LearnHouseActivityProps['completion']
  showTitle?: boolean
  showPoweredBy?: boolean
  unstyled?: boolean
  /** Render nothing on errors; handle `lh-error` yourself. */
  hideError?: boolean
  transformContent?: (doc: ActivityDocument) => ActivityDocument
  /** Mount the activity again from scratch (refetches it). */
  reload(): void
  addEventListener<K extends keyof LearnHouseActivityElementEventMap>(
    type: K,
    listener: (this: LearnHouseActivityElement, event: LearnHouseActivityElementEventMap[K]) => any,
    options?: boolean | AddEventListenerOptions,
  ): void
  addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void
  removeEventListener<K extends keyof LearnHouseActivityElementEventMap>(
    type: K,
    listener: (this: LearnHouseActivityElement, event: LearnHouseActivityElementEventMap[K]) => any,
    options?: boolean | EventListenerOptions,
  ): void
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions): void
}

export declare const TAG_NAME: 'learnhouse-activity'
export declare function defineLearnHouseActivity(tagName?: string): void

/** DOM events of <learnhouse-agent-chat>. */
export interface LearnHouseAgentChatElementEventMap {
  'lh-agent-event': CustomEvent<import('@learnhouse/sdk').AgentEvent>
  'lh-agent-conversation': CustomEvent<import('@learnhouse/sdk').Conversation>
  'lh-agent-error': CustomEvent<Error>
}

/** <learnhouse-agent-chat>: the Agent API chat as a custom element. */
export declare class LearnHouseAgentChatElement extends HTMLElement {
  baseUrl?: string
  /** A member session JWT or an embed session token. Never an `lh_` API token. */
  token?: string
  session?: LearnHouseSessionInput | null
  client?: LearnHouseClient
  /** `atlas`, `copilot` or `agent_<uuid>`. Default `copilot`. */
  agent?: string
  /** Organization id (`org-id` attribute); required with a member session. */
  orgId?: number | string
  conversationId?: string
  /** Options for the conversation created on the first message. */
  create?: Omit<import('@learnhouse/sdk').CreateConversationInput, 'agent'>
  siteUrl?: string
  placeholder?: string
  theme?: 'light' | 'dark' | 'auto'
  linkTarget?: '_blank' | '_self' | '_parent' | '_top'
  starters?: string[]
  greeting?: string
  labels?: Record<string, string>
  /** Per component type renderers (React components). */
  renderers?: Record<string, unknown>
  reconnect?: number | false
  addEventListener<K extends keyof LearnHouseAgentChatElementEventMap>(
    type: K,
    listener: (this: LearnHouseAgentChatElement, event: LearnHouseAgentChatElementEventMap[K]) => any,
    options?: boolean | AddEventListenerOptions,
  ): void
  addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void
  removeEventListener<K extends keyof LearnHouseAgentChatElementEventMap>(
    type: K,
    listener: (this: LearnHouseAgentChatElement, event: LearnHouseAgentChatElementEventMap[K]) => any,
    options?: boolean | EventListenerOptions,
  ): void
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions): void
}

export declare const AGENT_CHAT_TAG_NAME: 'learnhouse-agent-chat'
export declare function defineLearnHouseAgentChat(tagName?: string): void

declare global {
  interface HTMLElementTagNameMap {
    'learnhouse-activity': LearnHouseActivityElement
    'learnhouse-agent-chat': LearnHouseAgentChatElement
  }
}
