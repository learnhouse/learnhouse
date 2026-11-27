// Types-only entry for dist/index.d.ts. The runtime entry (index.ts) bundles
// the LearnHouse web app's source, whose types don't belong in this package's
// public surface; tests/exports.test.ts keeps both entries in sync.
import type { FC, CSSProperties } from 'react'
import type { CourseKey, CourseProgress, LearnHouseClient, Trail } from '@learnhouse/sdk'
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

// ── Progress hooks (shared trail per provider) ─────────────────────────────
export interface UseTrailReturn {
  /** `undefined` while loading the first time, `null` when signed out or unavailable. */
  trail: Trail | null | undefined
  loading: boolean
  error: Error | null
  /** Load it again from the API. */
  refresh: () => Promise<Trail | null>
}
export interface UseCourseProgressReturn {
  /** `null` until the trail is loaded (or when signed out). */
  progress: CourseProgress | null
  loading: boolean
  error: Error | null
  /** Enroll the learner (no-op when already enrolled). Embed sessions can't enroll. */
  enroll: () => Promise<void>
  /** Leave the course: removes its progress. */
  leave: () => Promise<void>
  complete: (activityUuid: string) => Promise<void>
  uncomplete: (activityUuid: string) => Promise<void>
  /** Whether an activity (numeric id) is completed. */
  isCompleted: (activityId: number) => boolean
  refresh: () => Promise<void>
}
/** The signed-in learner's trail in one org, shared under the provider. */
export declare function useTrail(orgId: number | null | undefined): UseTrailReturn
/** Progress through one course (numeric id or uuid), with enroll/leave/complete. */
export declare function useCourseProgress(
  orgId: number | null | undefined,
  course: CourseKey | null | undefined,
): UseCourseProgressReturn
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
