// Hand-written types for the Agent API (`/api/v1/agent`). The routes are part
// of LearnHouse EE, so they are not in the generated OSS schema
// (src/generated/schema.ts); these mirror the wire contract, version
// AGENT_API_VERSION. Field names are the wire names (snake_case).

/** Value of the `X-LearnHouse-Agent-API` header these types describe. */
export const AGENT_API_VERSION = '2026-11-16'

export type AgentKind = 'atlas' | 'copilot' | 'custom'
export type AgentAudience = 'staff' | 'learner'
export type AgentOutputMode = 'views' | 'markdown' | 'json'

export interface AgentCapabilities {
  streaming: boolean
  tools: boolean
  approvals: boolean
  views: boolean
  citations: boolean
  json_output: boolean
  templates: boolean
  client_tools: boolean
}

export interface Agent {
  /** `atlas`, `copilot` or `agent_<uuid>`. */
  id: string
  kind: AgentKind
  name: string
  description: string
  emoji: string | null
  color: string | null
  audience: AgentAudience
  greeting: string | null
  starters: string[]
  capabilities: AgentCapabilities
  output_modes: AgentOutputMode[]
  required_scopes: string[]
  available: boolean
  unavailable_reason: string | null
}

export type ToolTier = 'read' | 'write' | 'destructive'

export interface ToolInfo {
  name: string
  title: string
  description: string
  toolset: string
  tier: ToolTier
  needs_approval: boolean
  input_schema: JsonSchema
}

/** A tool your app runs itself. The agent calls it; you answer with `submitToolResults`. */
export interface ClientTool {
  /** `^[a-z][a-z0-9_]{1,47}$` */
  name: string
  /** At most 500 characters. */
  description: string
  /** A JSON Schema object for the tool's arguments. */
  input_schema: JsonSchema
}

export type JsonSchema = Record<string, unknown>

export type TemplateFormat = 'html' | 'markdown' | 'text'

/** A server-side Mustache-subset template (no code, every value escaped for `format`). */
export interface Template {
  source: string
  format: TemplateFormat
}

export interface AgentContext {
  course_uuid?: string | null
  activity_uuid?: string | null
  locale?: string | null
}

export interface OutputConfig {
  mode: AgentOutputMode
  /** Required for `mode: 'json'`. */
  json_schema?: JsonSchema | null
  template?: Template | null
}

export interface ConversationTools {
  /** Restrict the agent to these tool names. null = everything the caller may use. */
  allow?: string[] | null
  /** Tools your app runs (at most 8). */
  client?: ClientTool[]
}

export type ConversationStatus = 'idle' | 'running' | 'requires_action'

export interface PendingToolCall {
  call_id: string
  name: string
  args: Record<string, unknown>
}

export interface Conversation {
  id: string
  object: 'conversation'
  agent_id: string
  title: string
  created_at: string
  updated_at: string
  status: ConversationStatus
  context: { course_uuid: string | null; activity_uuid: string | null; locale: string | null }
  instructions: string | null
  output: { mode: AgentOutputMode; json_schema: JsonSchema | null; template: Template | null }
  tools: { allow: string[] | null; client: ClientTool[] }
  metadata: Record<string, string | number | boolean>
  external_user_id: string | null
  pending_approvals: Approval[]
  pending_tool_calls: PendingToolCall[]
  /** Id of the last event of the latest run, e.g. `run_x.12.0`; pass to `resume()`. */
  last_event_id: string | null
  /** Id of the latest run. */
  last_run_id: string | null
}

export interface CreateConversationInput {
  /** Agent id: `atlas`, `copilot` or `agent_<uuid>`. */
  agent: string
  /** Required with a member session; API tokens and embed sessions carry their org. */
  org_id?: number
  title?: string
  context?: AgentContext
  /** Developer instructions layered on the agent's own (at most 2000 characters). */
  instructions?: string
  output?: OutputConfig
  tools?: ConversationTools
  /** At most 20 keys. */
  metadata?: Record<string, string | number | boolean>
  /** Your own user id, to list a user's conversations later (at most 128 characters). */
  external_user_id?: string
}

export interface SendMessageInput {
  /** At most 8000 characters. */
  content: string
  /** Override the conversation's output config for this turn. */
  output?: Partial<OutputConfig>
  /** Override the conversation's context for this turn. */
  context?: AgentContext
}

// ── Views ─────────────────────────────────────────────────────────────────

/** The 42 component types a view can hold. Exact props: `GET /views/schema`. */
export type ViewComponentType =
  | 'kpis' | 'table' | 'chart' | 'timeline' | 'steps' | 'comparison' | 'checklist' | 'progress'
  | 'kanban' | 'flow' | 'outline' | 'page' | 'diff' | 'quiz' | 'flashcards' | 'gallery' | 'callout'
  | 'choices' | 'cards' | 'text' | 'heatmap' | 'funnel' | 'cohort' | 'radar' | 'gauge' | 'leaderboard'
  | 'sparklines' | 'geo' | 'matrix' | 'tree' | 'mindmap' | 'gantt' | 'math' | 'code' | 'email'
  | 'profile' | 'rubric' | 'glossary' | 'matching' | 'ordering' | 'fill_blanks' | 'whatif'

/**
 * One component of a view: `type` plus its validated props, flat on the object.
 * Props vary per type; the precise interfaces below (KnownViewComponent) cover
 * the common ones, matching the server's validated models.
 */
export interface ViewComponent {
  type: ViewComponentType | (string & {})
  [prop: string]: unknown
}

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'accent'
export type ColumnFormat = 'text' | 'number' | 'percent' | 'duration' | 'date' | 'currency'
export type StepStatus = 'done' | 'current' | 'upcoming' | 'failed' | 'skipped'
export type Cell = string | number | boolean | null

/** A link inside a view: an entity (`kind` + `uuid`) and/or a relative LearnHouse `path`. Never a free URL. */
export interface ViewLink {
  kind?: string | null
  uuid?: string | null
  path?: string | null
}

export interface KpisComponent extends ViewComponent {
  type: 'kpis'
  title?: string | null
  items: { label: string; value: string | number; unit?: string | null; delta?: number | null; hint?: string | null; tone?: Tone | null }[]
}

/** A table row: cells by column key, plus an optional `_link` that makes the row open that item. */
export type TableRow = { [columnKey: string]: Cell | ViewLink | undefined } & { _link?: ViewLink | null }

export interface TableComponent extends ViewComponent {
  type: 'table'
  title?: string | null
  caption?: string | null
  columns: { key: string; label: string; format?: ColumnFormat; unit?: string | null }[]
  rows: TableRow[]
}

export interface ChartComponent extends ViewComponent {
  type: 'chart'
  title?: string | null
  kind: 'bar' | 'line' | 'area' | 'pie' | 'donut' | 'funnel'
  /** Key of each `data` row that holds the x label. */
  x_key: string
  series: { key: string; label: string }[]
  data: Record<string, Cell>[]
  unit?: string | null
  stacked?: boolean
}

export interface TimelineComponent extends ViewComponent {
  type: 'timeline'
  title?: string | null
  items: { time: string; title: string; detail?: string | null; tone?: Tone | null }[]
}

export interface StepsComponent extends ViewComponent {
  type: 'steps'
  title?: string | null
  items: { title: string; detail?: string | null; status?: StepStatus | null }[]
}

export interface ComparisonComponent extends ViewComponent {
  type: 'comparison'
  title?: string | null
  columns: { title: string; subtitle?: string | null; badge?: string | null; highlight?: boolean; items?: string[] }[]
}

export interface ChecklistComponent extends ViewComponent {
  type: 'checklist'
  title?: string | null
  items: { label: string; checked?: boolean; detail?: string | null }[]
}

export interface ProgressComponent extends ViewComponent {
  type: 'progress'
  title?: string | null
  items: { label: string; value: number; max?: number; unit?: string | null; tone?: Tone | null; link?: ViewLink | null }[]
}

export interface QuizComponent extends ViewComponent {
  type: 'quiz'
  title?: string | null
  questions: { text: string; options: { text: string; correct?: boolean }[]; explanation?: string | null }[]
}

export interface CalloutComponent extends ViewComponent {
  type: 'callout'
  tone?: Tone
  title?: string | null
  text: string
}

export interface CardsComponent extends ViewComponent {
  type: 'cards'
  title?: string | null
  /** Each card is an entity: `kind` + `uuid` link it. `image` is a file of the org (cover, avatar). */
  items: { kind: string; uuid?: string | null; name: string; subtitle?: string | null; badges?: string[]; image?: string | null }[]
}

export interface TextComponent extends ViewComponent {
  type: 'text'
  markdown: string
}

export interface CodeComponent extends ViewComponent {
  type: 'code'
  title?: string | null
  language?: string | null
  filename?: string | null
  code: string
  output?: string | null
  output_tone?: 'neutral' | 'success' | 'danger'
  /** 1-based line numbers to highlight. */
  highlight?: number[]
}

export interface ChoicesComponent extends ViewComponent {
  type: 'choices'
  title?: string | null
  /** Clicking an option sends its `prompt` as the user's next message. */
  options: { label: string; prompt: string }[]
}

export interface GlossaryComponent extends ViewComponent {
  type: 'glossary'
  title?: string | null
  terms: { term: string; definition: string; example?: string | null }[]
}

/** The component types with precise interfaces here (wire shapes, as `GET /views/schema` describes them). */
export type KnownViewComponent =
  | KpisComponent
  | TableComponent
  | ChartComponent
  | TimelineComponent
  | StepsComponent
  | ComparisonComponent
  | ChecklistComponent
  | ProgressComponent
  | QuizComponent
  | CalloutComponent
  | CardsComponent
  | TextComponent
  | CodeComponent
  | ChoicesComponent
  | GlossaryComponent

export interface View {
  id: string
  call_id: string | null
  schema_version: number
  title: string | null
  layout: 'stack' | 'grid'
  components: ViewComponent[]
  /** Markdown rendering of the same data, for clients that don't render a type. */
  fallback_markdown: string
}

export interface ViewsSchema {
  version: string
  schema_version: number
  view_schema: JsonSchema
  components: Record<string, { group: string; description: string; json_schema: JsonSchema; example: unknown }>
  types: string[]
}

// ── Message parts ─────────────────────────────────────────────────────────

export interface Citation {
  index: number
  id: string
  title: string
  source_type: string
  course_uuid: string | null
  course_name: string | null
  chapter_name: string
  activity_uuid: string | null
  activity_name: string
  /** Path on the LearnHouse site (`/course/…/activity/…`), or null. */
  url: string | null
  snippet: string
}

export type ApprovalStatus = 'pending' | 'approved' | 'denied' | 'expired' | 'superseded' | 'applied'

export interface ApprovalConfirmation {
  /** What the user must type to approve. */
  phrase: string
  kind: 'type_name' | 'type_phrase'
  action_label: string
  blast_radius: string
}

export interface Approval {
  id: string
  tool: string
  summary: string
  risk: 'write' | 'destructive'
  reason: string
  target: { kind: string; uuid?: string | null; name?: string | null; [extra: string]: unknown } | null
  args: Record<string, unknown>
  estimate_credits: number | null
  /** When set, approving needs `confirmationPhrase` equal to `confirmation.phrase`. */
  confirmation: ApprovalConfirmation | null
  status: ApprovalStatus
  can_approve: boolean
}

export interface ToolCallRecord {
  call_id: string
  name: string
  /** null while running, or for a client tool waiting on your result. */
  ok: boolean | null
  /** Run by your app (see `submitToolResults`). */
  client: boolean
  /** Client-side extras, filled while streaming. */
  args?: Record<string, unknown>
  progress?: { done: number; total: number; label: string | null }
  error?: string | null
  detail?: unknown
}

export interface PlanStep {
  id: string
  title: string
  status: string
}

export interface MessageOutput {
  format: 'json'
  data: unknown
  valid: boolean
  attempts: number
  errors: unknown[]
}

export interface MessageUsage {
  credits: number
  requests: number
  input_tokens: number
  output_tokens: number
}

/** `streaming` is client-side only: a message still being folded from a stream. */
export type MessageStatus = 'completed' | 'requires_action' | 'cancelled' | 'failed' | 'streaming'

export interface ActionApplied {
  approval_id: string
  tool: string
  summary: string
  auto: boolean
  undo_available: boolean
}

export interface Message {
  id: string
  role: 'user' | 'assistant'
  created_at: string
  status: MessageStatus
  text: string
  views: View[]
  citations: Citation[]
  tool_calls: ToolCallRecord[]
  approvals: Approval[]
  plan: PlanStep[] | null
  suggestions: string[]
  output: MessageOutput | null
  rendered: { format: TemplateFormat; content: string } | null
  usage: MessageUsage | null
  error: { code: string; message: string } | null
  /** Client-side: actions applied during the stream (`action.applied`). */
  actions?: ActionApplied[]
}

// ── Stream events ─────────────────────────────────────────────────────────

interface EventBase {
  conversation_id: string
  message_id: string
  /** The SSE `id:` of the frame (`run_x.12.0`). Pass the last one to `resume()`. */
  id?: string
}

export interface MessageStartEvent extends EventBase {
  type: 'message.start'
  agent_id: string
  role: 'assistant'
  created_at: string
  /** An approval / tool-result continuation of an existing message. */
  continued: boolean
}
export interface TextDeltaEvent extends EventBase {
  type: 'text.delta'
  delta: string
}
export interface ToolCallEvent extends EventBase {
  type: 'tool.call'
  call_id: string
  name: string
  args: Record<string, unknown>
  client: boolean
}
export interface ToolProgressEvent extends EventBase {
  type: 'tool.progress'
  call_id: string
  done: number
  total: number
  label: string | null
}
export interface ToolResultEvent extends EventBase {
  type: 'tool.result'
  call_id: string
  name: string
  ok: boolean
  error: string | null
  detail: unknown
}
export interface PlanEvent extends EventBase {
  type: 'plan'
  steps: PlanStep[]
}
export interface ViewEvent extends EventBase {
  type: 'view'
  view: View
}
export interface CitationEvent extends EventBase {
  type: 'citation'
  citation: Citation
}
export interface ApprovalRequiredEvent extends EventBase {
  type: 'approval.required'
  approval: Approval
}
export interface ApprovalResolvedEvent extends EventBase {
  type: 'approval.resolved'
  approval_id: string
  decision: 'approved' | 'denied' | 'expired' | 'superseded'
  waiting_on: unknown
}
export interface ActionAppliedEvent extends EventBase, ActionApplied {
  type: 'action.applied'
}
export interface SuggestionsEvent extends EventBase {
  type: 'suggestions'
  items: string[]
}
export interface TextDoneEvent extends EventBase {
  type: 'text.done'
  /** Full assistant text of this run. */
  text: string
}
export interface OutputEvent extends EventBase, MessageOutput {
  type: 'output'
}
export interface RenderedEvent extends EventBase {
  type: 'rendered'
  format: TemplateFormat
  content: string
}
export interface UsageEvent extends EventBase, MessageUsage {
  type: 'usage'
}
export type AgentStreamErrorCode =
  | 'out_of_credits' | 'budget_reached' | 'step_limit' | 'agent_error' | 'run_lost' | 'internal_error'
  | 'AI_DISABLED' | 'AI_FEATURE_DISABLED' | 'AI_STAFF_ONLY' | 'AI_MONTHLY_CAP_REACHED' | 'output_invalid'
  | (string & {})
export interface StreamErrorEvent extends EventBase {
  type: 'error'
  code: AgentStreamErrorCode
  message: string
  retriable: boolean
}
export interface MessageDoneEvent extends EventBase {
  type: 'message.done'
  status: 'completed' | 'requires_action' | 'cancelled' | 'failed'
  text: string
  /**
   * Set on short "waiting" answers (one of several approvals decided, or only
   * some tool results sent): the turn still needs the rest before it goes on.
   */
  note?: string | null
}

/** Every event of an agent stream, discriminated on `type`. `message.done` is always last. */
export type AgentEvent =
  | MessageStartEvent
  | TextDeltaEvent
  | ToolCallEvent
  | ToolProgressEvent
  | ToolResultEvent
  | PlanEvent
  | ViewEvent
  | CitationEvent
  | ApprovalRequiredEvent
  | ApprovalResolvedEvent
  | ActionAppliedEvent
  | SuggestionsEvent
  | TextDoneEvent
  | OutputEvent
  | RenderedEvent
  | UsageEvent
  | StreamErrorEvent
  | MessageDoneEvent

export type AgentEventType = AgentEvent['type']

/**
 * What a non-streaming approve / deny returns while the turn still waits on
 * other approvals or tool results (`stream: false`): no new message yet.
 */
export interface AgentWaiting {
  waiting_on: unknown
  events: AgentEvent[]
}

export interface ToolResultInput {
  call_id: string
  output: unknown
  is_error?: boolean
}
