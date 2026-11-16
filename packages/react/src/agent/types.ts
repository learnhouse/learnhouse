// Public types of the Agent API bindings (useAgentConversation, <AgentChat>).
import type { ComponentType, CSSProperties, ReactNode } from 'react'
import type {
  Agent,
  AgentEvent,
  Approval,
  Citation,
  Conversation,
  CreateConversationInput,
  LearnHouseClient,
  LearnHouseSessionInput,
  Message,
  PendingToolCall,
  SendMessageInput,
  ToolResultInput,
  View,
  ViewComponent,
  ViewLink,
} from '@learnhouse/sdk'

export type AgentChatStatus = 'idle' | 'loading' | 'streaming' | 'requires_action' | 'error'

export interface UseAgentConversationOptions {
  /** A @learnhouse/sdk client. Defaults to the nearest <LearnHouseProvider>'s, or one made from `baseUrl`. */
  client?: LearnHouseClient
  /** API origin, when not using a provider or `client`. */
  baseUrl?: string
  /** Bearer token: a member session JWT or an embed session. Never an `lh_` API token in a browser. */
  token?: string
  /** An embed session (object or token), refreshed like the provider's. */
  session?: LearnHouseSessionInput | null
  /** Agent to talk to when a conversation is created: `atlas`, `copilot`, `agent_<uuid>`. Default `copilot`. */
  agent?: string
  /**
   * Organization id. Required with a member session (a user JWT): sent as
   * `org_id` when creating the conversation and loading the agent.
   */
  orgId?: number
  /** Open an existing conversation (its messages load, a running turn is re-attached). */
  conversationId?: string | null
  /** Options for the conversation created on the first `send()` (title, context, instructions, output, tools…). */
  create?: Omit<CreateConversationInput, 'agent'>
  /** Create the conversation as soon as the hook mounts instead of on the first message. */
  createOnMount?: boolean
  /** Every stream event, as it arrives. */
  onEvent?: (event: AgentEvent) => void
  /** A request or stream failed. */
  onError?: (error: Error) => void
  /** Called once a conversation exists (created or loaded). */
  onConversation?: (conversation: Conversation) => void
  /** Reconnect attempts after a dropped stream (resumed from the last event id). Default 3. */
  reconnect?: number | false
}

export interface UseAgentConversationReturn {
  /** The agent's profile (name, emoji, greeting, starters), once loaded. */
  agent: Agent | null
  conversation: Conversation | null
  messages: Message[]
  status: AgentChatStatus
  error: Error | null
  /** True while the stream is reconnecting after a drop. */
  reconnecting: boolean
  /** Send a user message (creates the conversation first if needed). */
  send: (input: string | SendMessageInput) => Promise<void>
  /** Approve a pending action; `phrase` is required when `approval.confirmation` is set. */
  approve: (approvalId: string, phrase?: string) => Promise<void>
  deny: (approvalId: string, reason?: string) => Promise<void>
  /** Stop the running turn. */
  cancel: () => Promise<void>
  /**
   * Answer one client tool call. Results are sent together once every pending
   * call has one.
   */
  submitToolResult: (callId: string, output: unknown, isError?: boolean) => Promise<void>
  /** Answer several client tool calls at once. */
  submitToolResults: (results: ToolResultInput[]) => Promise<void>
  /** Approvals waiting on the user. */
  pendingApprovals: Approval[]
  /** Client tool calls waiting on your app. */
  pendingToolCalls: PendingToolCall[]
  /** Suggestions of the last assistant message. */
  suggestions: string[]
  /** Reload the conversation and its messages from the server. */
  reload: () => Promise<void>
  /** Forget the current conversation; the next `send()` starts a new one. */
  reset: () => void
}

/** Props every view component renderer gets. */
export interface ViewComponentRendererProps<C extends ViewComponent = ViewComponent> {
  component: C
  view: View
  message: Message
  /** Send a message on the user's behalf (e.g. a `choices` option). Absent when read-only. */
  send?: (text: string) => void
  /** Turns a view link (`_link` of a table row, `link` of a progress item, a card's kind + uuid) into an href, or undefined. */
  resolveLink: (link: ViewLink | null | undefined) => string | undefined
}

export type ViewComponentRenderer<C extends ViewComponent = ViewComponent> = ComponentType<ViewComponentRendererProps<C>>

export type ViewRenderers = Partial<Record<string, ViewComponentRenderer<any>>>

export interface AgentChatProps extends UseAgentConversationOptions {
  /** Drive the chat with your own `useAgentConversation()` result instead of the built-in one. */
  conversation?: UseAgentConversationReturn
  /** Replace the renderer of any view component type: `{ table: MyTable }`. */
  renderers?: ViewRenderers
  /** Wrap or replace a whole view. `fallback` is the default rendering. */
  renderView?: (view: View, fallback: ReactNode, message: Message) => ReactNode
  /** Wrap or replace a whole message. `fallback` is the default rendering. */
  renderMessage?: (message: Message, fallback: ReactNode) => ReactNode
  /** Replace a citation entry. */
  renderCitation?: (citation: Citation, fallback: ReactNode) => ReactNode
  /** Address of the LearnHouse site (not the API), so citations and view links become links. */
  siteUrl?: string
  /** Turn a view link (`{kind, uuid}` and/or `{path}`) into an href, e.g. into your own app's routes. */
  resolveLink?: (link: ViewLink) => string | undefined
  /** Where links open. Default `_blank`. */
  linkTarget?: '_blank' | '_self' | '_parent' | '_top'
  /** Shown above the composer before the first message. */
  greeting?: ReactNode
  /** Prompt chips shown before the first message. */
  starters?: string[]
  placeholder?: string
  /** `auto` follows prefers-color-scheme. Default `light`. */
  theme?: 'light' | 'dark' | 'auto'
  className?: string
  style?: CSSProperties
  /** UI strings. */
  labels?: Partial<AgentChatLabels>
}

export interface AgentChatLabels {
  send: string
  stop: string
  approve: string
  deny: string
  typeToConfirm: string
  sources: string
  thinking: string
  reconnecting: string
  approved: string
  denied: string
  expired: string
  applied: string
  error: string
}
