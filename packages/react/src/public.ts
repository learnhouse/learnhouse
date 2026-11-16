// Types-only entry for dist/index.d.ts. The runtime entry (index.ts) bundles
// the LearnHouse web app's source, whose types don't belong in this package's
// public surface; tests/exports.test.ts keeps both entries in sync.
import type { FC, CSSProperties } from 'react'
import type { LearnHouseClient } from '@learnhouse/sdk'
import type { LearnHouseActivityProps, LearnHouseProviderProps, LearnHouseTheme } from './types'

export type * from './types'

export declare const LearnHouseActivity: FC<LearnHouseActivityProps>
export declare const LearnHouseProvider: FC<LearnHouseProviderProps>
export declare function useLearnHouseClient(): LearnHouseClient
/** The current learner session of the nearest provider. */
export declare function useLearnHouseSession(): {
  data: { user?: Record<string, any>; roles?: any[]; tokens?: { access_token?: string; expiry?: number } } | null
  status: 'loading' | 'authenticated' | 'unauthenticated'
  update: () => Promise<void>
}
export declare function themeToStyle(theme?: LearnHouseTheme): CSSProperties
export declare const SUPPORTED_LOCALES: string[]
export declare const VERSION: string

// ── Agent API (useAgentConversation, <AgentChat>) ──────────────────────────
import type { Approval, Cell, Citation, ColumnFormat, Message, View, ViewLink } from '@learnhouse/sdk'
import type {
  AgentChatLabels,
  AgentChatProps,
  UseAgentConversationOptions,
  UseAgentConversationReturn,
  ViewRenderers,
} from './agent/types'

export type * from './agent/types'

/** One Agent API conversation as React state, with live streaming and resumable turns. */
export declare function useAgentConversation(options?: UseAgentConversationOptions): UseAgentConversationReturn
/** Ready-made chat UI on the Agent API (messages, composer, approvals, citations, views). */
export declare const AgentChat: FC<AgentChatProps>
/** One view, rendered with the default renderers plus `renderers` overrides. */
export declare const AgentView: FC<{
  view: View
  message: Message
  renderers?: ViewRenderers
  send?: (text: string) => void
  siteUrl?: string
  /** Turn a view link (`{kind, uuid}` and/or `{path}`) into an href; overrides the default. */
  resolveLink?: (link: ViewLink) => string | undefined
}>
/** Approve / deny card for a pending approval (asks for the confirmation phrase when needed). */
export declare const ApprovalCard: FC<{
  approval: Approval
  onApprove: (phrase?: string) => void
  onDeny: (reason?: string) => void
  busy?: boolean
  labels?: Partial<AgentChatLabels>
}>
export declare const CitationList: FC<{
  citations: Citation[]
  siteUrl?: string
  linkTarget?: string
  label?: string
  renderCitation?: AgentChatProps['renderCitation']
}>
export declare const DEFAULT_AGENT_LABELS: AgentChatLabels
/** The built-in view component renderers, keyed by component type. */
export declare const defaultViewRenderers: ViewRenderers
/** Formats a table cell like the built-in renderers (number, percent, duration, date, currency). */
export declare function formatCell(value: Cell | undefined, format?: ColumnFormat, unit?: string): string
/** The safe markdown subset the chat uses (React elements only, no HTML injection). */
export declare const AgentMarkdown: FC<{ text: string; className?: string; linkBase?: string; linkTarget?: string }>
