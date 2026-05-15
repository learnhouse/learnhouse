'use client'

import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import {
  applyPendingEdit,
  AtlasChatSession,
  AtlasEvent,
  AtlasMessage,
  AtlasPageContextPayload,
  AtlasSession,
  AtlasToolCallPersisted,
  CandidateDTO,
  cancelPendingEdit,
  ConfirmationChallengeDTO,
  deleteAtlasChatSession,
  listAtlasChatSessions,
  loadAtlasChatMessages,
  refinePendingEdit,
  revokeAtlasSession,
  startAtlasSession,
  streamAtlasChat,
  updateAtlasChatSession,
} from '@services/ai/atlas'
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleX,
  ClipboardList,
  FileText,
  HelpCircle,
  Loader2,
  MessageCircle,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Send,
  Star,
  Trash2,
  Wrench,
  X as XIcon,
} from 'lucide-react'
import { GlobeStand } from '@phosphor-icons/react'
import dynamic from 'next/dynamic'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import AppliedPill from './cards/AppliedPill'
import ChapterPreviewCard from './cards/ChapterPreviewCard'
import CoursePreviewCard from './cards/CoursePreviewCard'
import ErrorCard from './cards/ErrorCard'
import StructureProposalCard, { EditableStructure } from './cards/StructureProposalCard'
import PageContextBreadcrumb from './composer/PageContextBreadcrumb'
import QuickActionChips from './composer/QuickActionChips'
import ReferencePicker from './composer/ReferencePicker'
import ActionTimeline from './timeline/ActionTimeline'

// Lazy import so the activity preview's heavy editor JSON renderers
// don't bloat the initial chat bundle.
const ActivityEditPreviewCardLazy = dynamic(() => import('./ActivityEditPreviewCard'), {
  ssr: false,
  loading: () => null,
})

// ─── design tokens ────────────────────────────────────────────────────────

const ATLAS_GRADIENT =
  'linear-gradient(0deg, rgba(0, 0, 0, 0.35) 0%, rgba(0, 0, 0, 0.35) 100%), ' +
  'radial-gradient(120% 110% at 50% -5%, rgba(139, 92, 246, 0.18) 0%, rgba(0, 0, 0, 0) 55%), ' +
  'rgb(2 1 20 / 100%)'

// ─── types ────────────────────────────────────────────────────────────────

interface ToolEvent {
  callId: string
  name: string
  args: Record<string, any>
  summary?: string
  guidance?: string
  isError?: boolean
  resolved: boolean
}

// Structured events the new backend SSE protocol emits alongside the
// streamed text. We attach them to the model message they belong to so
// the bubble can render typed preview / confirm / applied / results
// cards inline — without the old markdown-fence smuggling.
type PreviewEvent =
  | Extract<AtlasEvent, { type: 'preview.activity' }>
  | Extract<AtlasEvent, { type: 'preview.chapter' }>
  | Extract<AtlasEvent, { type: 'preview.course' }>

interface MessagePending {
  pendingId: string
  preview: PreviewEvent
  challenge?: ConfirmationChallengeDTO
  status: 'pending' | 'applying' | 'applied' | 'dropped' | 'error'
  versionAfter?: number
  undoToken?: string | null
  errorMessage?: string
}

interface AmbiguityCard {
  selector: string
  kind: 'course' | 'chapter' | 'activity'
  candidates: CandidateDTO[]
}

interface NotFoundCard {
  selector: string
  kind: 'course' | 'chapter' | 'activity'
  suggestions: CandidateDTO[]
}

interface ResultsCard {
  kind: string
  items: Record<string, any>[]
}

interface ErrorEntry {
  code: string
  message: string
  retriable: boolean
  // For retry: the user-message this turn responded to. The retry
  // handler re-sends it on a fresh turn.
  triggeredBy?: string
}

interface ChatMessage {
  id: string
  role: AtlasMessage['role']
  content: string
  toolCalls?: ToolEvent[]
  streaming?: boolean
  errored?: boolean
  // Full ordered event log for this turn — the ActionTimeline reads
  // directly from this list so it can render every tool/entity/applied
  // event without re-deriving them from the cache fields below.
  events?: AtlasEvent[]
  // New-protocol attachments (in arrival order; rendered alongside the
  // text body). Pending cards are indexed by pending_id so updates
  // (confirm.required, applied, pending.dropped) can mutate the right one.
  pendings?: Record<string, MessagePending>
  ambiguities?: AmbiguityCard[]
  notFounds?: NotFoundCard[]
  resultsCards?: ResultsCard[]
  structureTree?: Record<string, any>
  // Structured errors so we can render an ErrorCard with a Retry button
  // instead of appending italic prose to the message body.
  errorEntries?: ErrorEntry[]
  // entity.resolved announcements (rendered by the timeline).
  resolvedEntities?: Extract<AtlasEvent, { type: 'entity.resolved' }>[]
}

// ─── helpers ──────────────────────────────────────────────────────────────

// Marker the agent emits to ask for explicit user approval. Invisible to
// the user (HTML comments are stripped by react-markdown); the frontend
// detects it on the raw message text and renders Approve / Cancel chips
// under the bubble. Reusable across compose plans, destructive actions,
// or any "agent proposes, user decides" moment.
const ATLAS_CONFIRM_MARKER_RE = /<!--\s*atlas:confirm\s*-->/i

function stripConfirmMarker(text: string): string {
  return text.replace(ATLAS_CONFIRM_MARKER_RE, '').trimEnd()
}

function hasConfirmMarker(text: string): boolean {
  return ATLAS_CONFIRM_MARKER_RE.test(text)
}

// Structured course-plan payload the agent emits inside a fenced block.
// Detected by the frontend, parsed into a proper preview card. Falls back
// to plain markdown rendering if parsing fails.
interface CoursePlanActivity {
  name: string
  kind?: 'dynamic' | 'quiz' | 'video' | 'pdf' | 'assignment'
}
interface CoursePlanChapter {
  name: string
  activities?: CoursePlanActivity[]
}
interface CoursePlan {
  title?: string
  description?: string
  chapters: CoursePlanChapter[]
}

const ATLAS_PLAN_BLOCK_RE = /```atlas-course-plan\s*\n([\s\S]*?)\n```/

function extractCoursePlan(text: string): { plan: CoursePlan | null; rest: string } {
  const m = text.match(ATLAS_PLAN_BLOCK_RE)
  if (!m) return { plan: null, rest: text }
  let plan: CoursePlan | null = null
  try {
    const parsed = JSON.parse(m[1])
    if (parsed && Array.isArray(parsed.chapters)) {
      plan = parsed as CoursePlan
    }
  } catch {
    plan = null
  }
  const rest = text.replace(m[0], '').trim()
  return { plan, rest }
}

function formatArgs(args: Record<string, any>): string {
  const entries = Object.entries(args)
  if (!entries.length) return ''
  return entries
    .map(([k, v]) => {
      const str = typeof v === 'string' ? v : JSON.stringify(v)
      return `${k}=${str.length > 48 ? str.slice(0, 45) + '…' : str}`
    })
    .join(' · ')
}

export function applyEvent(msg: ChatMessage, event: AtlasEvent): ChatMessage {
  // Append every event to the ordered log first; cache fields below
  // are derived for fast rendering paths. The ActionTimeline component
  // reads the raw events[] log so nothing has to be re-derived later.
  const appended: ChatMessage = {
    ...msg,
    events: [...(msg.events || []), event],
  }
  switch (event.type) {
    case 'message.delta':
      return { ...appended, content: (msg.content || '') + (event.delta || '') }

    case 'tool.start': {
      const next: ToolEvent = {
        callId: event.call_id,
        name: event.name,
        args: event.args_redacted || {},
        resolved: false,
      }
      return { ...appended, toolCalls: [...(msg.toolCalls || []), next] }
    }
    case 'tool.end': {
      const updated = (msg.toolCalls || []).map((tc) =>
        tc.callId === event.call_id
          ? { ...tc, resolved: true, isError: !event.ok }
          : tc,
      )
      return { ...appended, toolCalls: updated }
    }

    case 'preview.activity':
    case 'preview.chapter':
    case 'preview.course': {
      const pendings = { ...(msg.pendings || {}) }
      pendings[event.pending_id] = {
        pendingId: event.pending_id,
        preview: event,
        status: 'pending',
      }
      return { ...appended, pendings }
    }

    case 'confirm.required': {
      const pendings = { ...(msg.pendings || {}) }
      const existing = pendings[event.pending_id]
      if (existing) {
        pendings[event.pending_id] = { ...existing, challenge: event.challenge }
      }
      return { ...appended, pendings }
    }

    case 'applied': {
      const pendings = { ...(msg.pendings || {}) }
      const existing = pendings[event.pending_id]
      if (existing) {
        pendings[event.pending_id] = {
          ...existing,
          status: 'applied',
          versionAfter: event.version_after,
          undoToken: event.undo_token,
        }
      }
      return { ...appended, pendings }
    }

    case 'pending.dropped': {
      const pendings = { ...(msg.pendings || {}) }
      const existing = pendings[event.pending_id]
      if (existing) {
        pendings[event.pending_id] = { ...existing, status: 'dropped' }
      }
      return { ...appended, pendings }
    }

    case 'entity.resolved':
      return { ...appended, resolvedEntities: [...(msg.resolvedEntities || []), event] }

    case 'entity.ambiguous':
      return {
        ...appended,
        ambiguities: [
          ...(msg.ambiguities || []),
          { selector: event.selector, kind: event.kind, candidates: event.candidates },
        ],
      }

    case 'entity.not_found':
      return {
        ...appended,
        notFounds: [
          ...(msg.notFounds || []),
          { selector: event.selector, kind: event.kind, suggestions: event.suggestions },
        ],
      }

    case 'results.list':
      return {
        ...appended,
        resultsCards: [...(msg.resultsCards || []), { kind: event.kind, items: event.items }],
      }

    case 'structure.proposal':
      return { ...appended, structureTree: event.tree }

    case 'done':
      return { ...appended, streaming: false }

    case 'error':
      return {
        ...appended,
        streaming: false,
        errored: true,
        errorEntries: [
          ...(msg.errorEntries || []),
          {
            code: event.code,
            message: event.message,
            retriable: !!event.retriable,
          },
        ],
      }

    default:
      return appended
  }
}

function persistedToolToEvent(tc: AtlasToolCallPersisted, idx: number): ToolEvent {
  return {
    callId: `persisted-${idx}-${tc.name || 'tool'}`,
    name: tc.name || 'tool',
    args: tc.args || {},
    summary: tc.summary,
    isError: !!tc.is_error,
    guidance: tc.guidance,
    resolved: true,
  }
}

// Re-hydrate a persisted model message into the same ChatMessage shape
// ``applyEvent`` builds during streaming. The new backend stores the
// full structured event log under ``tool_calls`` (each entry has a
// ``type`` field); legacy v1 entries are plain {name, args, summary}.
// We route the new-shape entries through ``applyEvent`` and treat the
// legacy ones as resolved tool rows.
function rehydratePersisted(m: AtlasMessage, idx: number): ChatMessage {
  let msg: ChatMessage = {
    id: `p-${idx}`,
    role: m.role,
    content: m.content || '',
  }
  const legacyTools: ToolEvent[] = []
  ;(m.tool_calls || []).forEach((entry, j) => {
    if (entry && typeof entry.type === 'string') {
      // New-shape event payload — route through applyEvent so the
      // rendering paths match the live stream exactly.
      msg = applyEvent(msg, entry as AtlasEvent)
    } else if (entry && entry.name) {
      legacyTools.push(persistedToolToEvent(entry, idx * 100 + j))
    }
  })
  if (legacyTools.length) msg.toolCalls = legacyTools
  return msg
}

export function persistedToChatMessages(loaded: AtlasMessage[]): ChatMessage[] {
  return loaded.map((m, i) => rehydratePersisted(m, i))
}

export type { ChatMessage, MessagePending }

function groupSessionsByAge(sessions: AtlasChatSession[]): { label: string; items: AtlasChatSession[] }[] {
  const now = Date.now()
  const buckets: { label: string; items: AtlasChatSession[] }[] = [
    { label: 'Favorites', items: [] },
    { label: 'Today', items: [] },
    { label: 'Previous 7 days', items: [] },
    { label: 'Older', items: [] },
  ]
  const sorted = [...sessions].sort((a, b) => {
    const da = a.created_at ? new Date(a.created_at).getTime() : 0
    const db = b.created_at ? new Date(b.created_at).getTime() : 0
    return db - da
  })
  for (const s of sorted) {
    if (s.favorite) {
      buckets[0].items.push(s)
      continue
    }
    const t = s.created_at ? new Date(s.created_at).getTime() : 0
    const ageDays = (now - t) / (1000 * 60 * 60 * 24)
    if (ageDays < 1) buckets[1].items.push(s)
    else if (ageDays < 7) buckets[2].items.push(s)
    else buckets[3].items.push(s)
  }
  return buckets.filter((b) => b.items.length > 0)
}

// ─── component ────────────────────────────────────────────────────────────

export default function AtlasChat() {
  const session = useLHSession() as any
  const accessToken: string | undefined = session?.data?.tokens?.access_token
  const org = useOrg() as any
  const orgId: number | undefined = org?.id

  const [atlasSession, setAtlasSession] = useState<AtlasSession | null>(null)
  const [sessionError, setSessionError] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)

  // Chat session persistence.
  const [aichatUuid, setAichatUuid] = useState<string | null>(null)
  const [chatSessions, setChatSessions] = useState<AtlasChatSession[]>([])
  const [loadingChat, setLoadingChat] = useState(false)

  const abortRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  // ── session-token lifecycle ────────────────────────────────────────────
  const refreshSession = useCallback(async () => {
    if (!orgId || !accessToken) return
    try {
      const next = await startAtlasSession(orgId, accessToken)
      setAtlasSession(next)
      setSessionError(null)
    } catch (err: any) {
      setSessionError(err?.message || 'Could not start Atlas session.')
    }
  }, [orgId, accessToken])

  useEffect(() => {
    refreshSession()
  }, [refreshSession])

  useEffect(() => {
    if (!atlasSession?.expires_at) return
    const expiryMs = new Date(atlasSession.expires_at).getTime()
    const refreshAt = expiryMs - 2 * 60 * 1000
    const delay = Math.max(refreshAt - Date.now(), 10_000)
    const t = setTimeout(() => refreshSession(), delay)
    return () => clearTimeout(t)
  }, [atlasSession, refreshSession])

  useEffect(() => {
    return () => {
      if (atlasSession && accessToken) {
        revokeAtlasSession(atlasSession.token_uuid, accessToken).catch(() => {})
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  // ── chat session list ──────────────────────────────────────────────────
  const refreshSessionList = useCallback(async () => {
    if (!orgId || !accessToken) return
    try {
      const list = await listAtlasChatSessions(orgId, accessToken)
      setChatSessions(list)
    } catch {
      // Non-fatal — the sidebar just won't populate; keep the chat alive.
    }
  }, [orgId, accessToken])

  useEffect(() => {
    refreshSessionList()
  }, [refreshSessionList])

  // ── URL <-> chat sync (?chat=aichat_xxx) ───────────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    const param = url.searchParams.get('chat')
    if (param && param !== aichatUuid) {
      openChat(param)
    }
    // Only on initial mount — we own the URL from here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const syncUrl = useCallback((uuid: string | null) => {
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    if (uuid) url.searchParams.set('chat', uuid)
    else url.searchParams.delete('chat')
    window.history.replaceState({}, '', url.toString())
  }, [])

  const openChat = useCallback(
    async (uuid: string) => {
      if (!accessToken) return
      setLoadingChat(true)
      try {
        const loaded = await loadAtlasChatMessages(uuid, accessToken)
        setMessages(persistedToChatMessages(loaded))
        setAichatUuid(uuid)
        syncUrl(uuid)
      } catch (err: any) {
        setSessionError(err?.message || 'Could not load that chat.')
      } finally {
        setLoadingChat(false)
      }
    },
    [accessToken, syncUrl],
  )

  const startNewChat = useCallback(() => {
    if (sending) return
    abortRef.current?.abort()
    setMessages([])
    setAichatUuid(null)
    setInput('')
    syncUrl(null)
  }, [sending, syncUrl])

  const removeChat = useCallback(
    async (uuid: string) => {
      if (!accessToken) return
      try {
        await deleteAtlasChatSession(uuid, accessToken)
      } catch {
        /* ignore */
      }
      setChatSessions((prev) => prev.filter((s) => s.aichat_uuid !== uuid))
      if (uuid === aichatUuid) {
        startNewChat()
      }
    },
    [accessToken, aichatUuid, startNewChat],
  )

  const renameChat = useCallback(
    async (uuid: string, title: string) => {
      if (!accessToken) return
      await updateAtlasChatSession(uuid, { title }, accessToken)
      setChatSessions((prev) =>
        prev.map((s) => (s.aichat_uuid === uuid ? { ...s, title } : s)),
      )
    },
    [accessToken],
  )

  const toggleFavorite = useCallback(
    async (uuid: string, favorite: boolean) => {
      if (!accessToken) return
      await updateAtlasChatSession(uuid, { favorite }, accessToken)
      setChatSessions((prev) =>
        prev.map((s) => (s.aichat_uuid === uuid ? { ...s, favorite } : s)),
      )
    },
    [accessToken],
  )

  // ── sending ────────────────────────────────────────────────────────────
  const canSend = !!atlasSession && !!accessToken && !!orgId && !sending && input.trim().length > 0

  const sendMessage = useCallback(
    async (text: string) => {
      if (!atlasSession || !accessToken || !orgId) return
      const userMsg: ChatMessage = { id: `u-${Date.now()}`, role: 'user', content: text }
      const assistantMsg: ChatMessage = {
        id: `a-${Date.now() + 1}`,
        role: 'model',
        content: '',
        toolCalls: [],
        streaming: true,
      }
      setMessages((prev) => [...prev, userMsg, assistantMsg])
      setInput('')
      setSending(true)

      const controller = new AbortController()
      abortRef.current = controller

      let isNewChat = aichatUuid === null

      try {
        const stream = streamAtlasChat({
          orgId,
          sessionToken: atlasSession.token,
          message: text,
          aichatUuid: aichatUuid ?? undefined,
          accessToken,
          signal: controller.signal,
        })
        for await (const event of stream) {
          if (event.type === 'session') {
            setAichatUuid(event.aichat_uuid)
            syncUrl(event.aichat_uuid)
            continue
          }
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantMsg.id ? applyEvent(m, event) : m)),
          )
        }
      } catch (err: any) {
        if (err?.name === 'AbortError') {
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantMsg.id ? { ...m, streaming: false } : m)),
          )
        } else {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsg.id
                ? {
                    ...m,
                    streaming: false,
                    errored: true,
                    content: m.content || `Atlas encountered an error: ${err?.message || err}`,
                  }
                : m,
            ),
          )
        }
      } finally {
        setSending(false)
        abortRef.current = null
        // The first turn of a new chat creates the session row — refresh
        // the sidebar so the new entry pops in.
        if (isNewChat) refreshSessionList()
      }
    },
    [accessToken, aichatUuid, atlasSession, orgId, refreshSessionList, syncUrl],
  )

  const onSubmit = (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!canSend) return
    sendMessage(input.trim())
  }

  const stop = () => abortRef.current?.abort()

  const liveTools: ToolEvent[] | null = useMemo(() => {
    const last = messages[messages.length - 1]
    if (!last || last.role !== 'model' || !last.streaming) return null
    return last.toolCalls || null
  }, [messages])

  // ── pending edit lifecycle (apply / cancel / refine) ───────────────────
  //
  // Cross-cutting state keyed by pending_id. Apply streams its result
  // through the same SSE shape as /chat so we route those events into
  // the message that hosts the preview card.
  const [pendingBusy, setPendingBusy] = useState<Record<string, boolean>>({})

  const updatePending = useCallback(
    (pendingId: string, patch: (p: MessagePending) => MessagePending) => {
      setMessages((prev) =>
        prev.map((m) => {
          if (!m.pendings || !m.pendings[pendingId]) return m
          return {
            ...m,
            pendings: { ...m.pendings, [pendingId]: patch(m.pendings[pendingId]) },
          }
        }),
      )
    },
    [],
  )

  const handleApplyPending = useCallback(
    async (pendingId: string, opts?: { confirmationPhrase?: string }) => {
      if (!atlasSession || !accessToken || !orgId) return
      setPendingBusy((p) => ({ ...p, [pendingId]: true }))
      updatePending(pendingId, (p) => ({ ...p, status: 'applying' }))
      try {
        const stream = applyPendingEdit({
          pendingId,
          orgId,
          sessionToken: atlasSession.token,
          confirmationPhrase: opts?.confirmationPhrase,
          accessToken,
        })
        for await (const event of stream) {
          if (event.type === 'applied') {
            updatePending(pendingId, (p) => ({
              ...p,
              status: 'applied',
              versionAfter: event.version_after,
              undoToken: event.undo_token,
            }))
          } else if (event.type === 'error') {
            updatePending(pendingId, (p) => ({
              ...p,
              status: 'error',
              errorMessage: event.message,
            }))
          }
        }
      } catch (err: any) {
        updatePending(pendingId, (p) => ({
          ...p,
          status: 'error',
          errorMessage: err?.message || 'Apply failed.',
        }))
      } finally {
        setPendingBusy((p) => {
          const next = { ...p }
          delete next[pendingId]
          return next
        })
      }
    },
    [accessToken, atlasSession, orgId, updatePending],
  )

  const handleCancelPending = useCallback(
    async (pendingId: string) => {
      if (!accessToken || !orgId) return
      setPendingBusy((p) => ({ ...p, [pendingId]: true }))
      try {
        const ok = await cancelPendingEdit({ pendingId, orgId, accessToken })
        if (ok) updatePending(pendingId, (p) => ({ ...p, status: 'dropped' }))
      } finally {
        setPendingBusy((p) => {
          const next = { ...p }
          delete next[pendingId]
          return next
        })
      }
    },
    [accessToken, orgId, updatePending],
  )

  const handleRefinePending = useCallback(
    async (pendingId: string, instruction: string) => {
      if (!atlasSession || !accessToken || !orgId) return
      // Refine streams a fresh turn — surface it as a new model message
      // just like sendMessage does, but routed through the refine endpoint.
      const userMsg: ChatMessage = {
        id: `u-${Date.now()}`,
        role: 'user',
        content: `Refine: ${instruction}`,
      }
      const assistantMsg: ChatMessage = {
        id: `a-${Date.now() + 1}`,
        role: 'model',
        content: '',
        toolCalls: [],
        streaming: true,
      }
      setMessages((prev) => [...prev, userMsg, assistantMsg])
      setSending(true)
      try {
        const stream = refinePendingEdit({
          pendingId,
          orgId,
          sessionToken: atlasSession.token,
          instruction,
          accessToken,
        })
        for await (const event of stream) {
          if (event.type === 'session') continue
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantMsg.id ? applyEvent(m, event) : m)),
          )
        }
      } catch (err: any) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsg.id
              ? { ...m, streaming: false, errored: true, content: err?.message || 'Refine failed.' }
              : m,
          ),
        )
      } finally {
        setSending(false)
      }
    },
    [accessToken, atlasSession, orgId],
  )

  // ── structure proposal apply ────────────────────────────────────────────
  // We don't have a backend tool that consumes the edited tree wholesale
  // (yet). Until that lands, the Apply button sends the structured tree
  // back to the agent as a chat message; the agent then proposes the
  // course create + chapter/activity stubs through its normal tooling.
  const handleApplyStructure = useCallback(
    (structure: EditableStructure) => {
      const lines: string[] = []
      lines.push(`Apply this course structure as a new course.`)
      lines.push(`Title: ${structure.title || 'Untitled'}`)
      if (structure.description) lines.push(`Description: ${structure.description}`)
      if (structure.audience) lines.push(`Audience: ${structure.audience}`)
      lines.push(``)
      structure.chapters.forEach((ch, i) => {
        lines.push(`Chapter ${i + 1}: ${ch.name || `Chapter ${i + 1}`}`)
        ch.activities.forEach((a) => {
          lines.push(`  - ${a.name || '(unnamed)'} [${a.kind}]`)
        })
      })
      lines.push(``)
      lines.push(
        `Propose creating the course, then propose each chapter and activity in order.`,
      )
      sendMessage(lines.join('\n'))
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  const handleRefineStructure = useCallback(
    (instruction: string) => {
      sendMessage(
        `Regenerate the course structure with this constraint: ${instruction}`,
      )
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  const handleRetryError = useCallback(() => {
    // Re-send the most recent user message. Inputs the user typed get
    // cleared on send, so we walk the message list backwards.
    const lastUser = [...messages].reverse().find((m) => m.role === 'user')
    if (lastUser?.content) sendMessage(lastUser.content)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages])

  // ── layout ──────────────────────────────────────────────────────────────
  return (
    <div
      className="flex flex-row w-full h-[100svh] text-white gap-3 p-3 md:gap-4 md:p-5"
      style={{ background: ATLAS_GRADIENT }}
    >
      {/* sessions sidebar */}
      <SessionSidebar
        sessions={chatSessions}
        activeUuid={aichatUuid}
        onOpen={openChat}
        onNew={startNewChat}
        onDelete={removeChat}
        onRename={renameChat}
        onToggleFavorite={toggleFavorite}
        disabled={sending || loadingChat}
      />

      {/* main chat column */}
      <div className="flex flex-col flex-1 min-w-0 bg-white/[0.02] ring-1 ring-inset ring-white/[0.04] rounded-2xl overflow-hidden shadow-xl shadow-black/30">
        {sessionError && (
          <div className="flex-none flex items-center gap-2 bg-rose-500/10 text-rose-200 px-5 py-2 text-xs border-b border-rose-500/20">
            <AlertTriangle size={14} />
            <span className="flex-1">{sessionError}</span>
            <button className="font-semibold underline hover:text-rose-100" onClick={() => refreshSession()}>
              Retry
            </button>
          </div>
        )}

        <div
          ref={scrollRef}
          className="flex-1 min-h-0 overflow-y-auto scroll-smooth atlas-scroll"
        >
          {loadingChat ? (
            <div className="h-full min-h-[60vh] flex items-center justify-center text-white/40">
              <Loader2 size={18} className="animate-spin mr-2" />
              Loading chat…
            </div>
          ) : messages.length === 0 ? (
            <div className="h-full min-h-[60vh] flex items-center justify-center">
              <EmptyState onPick={(p) => sendMessage(p)} disabled={!atlasSession} />
            </div>
          ) : (
            <div className="flex flex-col gap-6 px-6 py-8">
              {messages.map((m, i) => (
                <MessageBubble
                  key={m.id}
                  message={m}
                  isLast={i === messages.length - 1}
                  disabled={sending}
                  onConfirm={() => sendMessage('go')}
                  onCancel={() => sendMessage('cancel')}
                  onApplyPending={handleApplyPending}
                  onCancelPending={handleCancelPending}
                  onRefinePending={handleRefinePending}
                  onApplyStructure={handleApplyStructure}
                  onRefineStructure={handleRefineStructure}
                  onRetryError={handleRetryError}
                  onPickCandidate={(cand) =>
                    sendMessage(`Use ${cand.kind} ${cand.uuid} (${cand.name}).`)
                  }
                  pendingBusy={pendingBusy}
                />
              ))}
            </div>
          )}
        </div>

        {liveTools && liveTools.length > 0 && (
          <div className="flex-none">
            <div className="px-6 py-2.5">
              <ActionDock tools={liveTools} />
            </div>
          </div>
        )}

        <div className="flex-none border-t border-white/[0.04]">
          {/* Current focus (course/chapter/activity), if any */}
          <PageContextBreadcrumb compact />

          {/* Contextual quick-action chips — only when the textarea is empty */}
          {input.trim().length === 0 && !sending && (
            <QuickActionChips
              onPick={(p) => setInput(p)}
              disabled={!atlasSession}
            />
          )}

          <form onSubmit={onSubmit} className="px-5 py-3 flex items-end gap-2">
            {/* Attach a chapter / activity by name from the focused course */}
            <ReferencePicker />

            <div
              className={`flex-1 rounded-xl bg-white/[0.02] transition-all ${
                sending
                  ? 'atlas-composer-glow'
                  : 'ring-1 ring-inset ring-white/[0.06] focus-within:ring-violet-400/30 focus-within:bg-white/[0.04]'
              }`}
            >
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    onSubmit()
                  }
                }}
                placeholder={atlasSession ? 'Ask Atlas to build, edit, or explore…' : 'Starting Atlas…'}
                rows={1}
                className="w-full resize-none bg-transparent outline-none text-sm text-white placeholder:text-white/30 px-3.5 py-2.5 min-h-[40px] max-h-48"
                disabled={!atlasSession}
              />
            </div>
            {sending ? (
              <button
                type="button"
                onClick={stop}
                className="flex items-center gap-1.5 bg-white/10 hover:bg-white/15 text-white/80 ring-1 ring-inset ring-white/10 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition-colors"
              >
                <Loader2 size={14} className="animate-spin" />
                Stop
              </button>
            ) : (
              <button
                type="submit"
                disabled={!canSend}
                className="flex items-center gap-1.5 bg-violet-600 hover:bg-violet-500 disabled:bg-white/5 disabled:text-white/30 text-white ring-1 ring-inset ring-violet-400/30 disabled:ring-white/10 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition-colors"
              >
                <Send size={14} />
                Send
              </button>
            )}
          </form>
        </div>
      </div>

      <style jsx>{`
        .atlas-scroll {
          scrollbar-width: thin;
          scrollbar-color: rgba(255, 255, 255, 0.15) transparent;
        }
        .atlas-scroll::-webkit-scrollbar { width: 8px; }
        .atlas-scroll::-webkit-scrollbar-track { background: transparent; }
        .atlas-scroll::-webkit-scrollbar-thumb {
          background-color: rgba(255, 255, 255, 0.1);
          border-radius: 4px;
        }
        .atlas-scroll::-webkit-scrollbar-thumb:hover {
          background-color: rgba(255, 255, 255, 0.2);
        }
        /* Composer ring glow while Atlas is streaming. The ring itself is
           a layered box-shadow so it works on any background and stays
           crisp at 1px in the inner edge. */
        .atlas-composer-glow {
          box-shadow:
            inset 0 0 0 1px rgba(167, 139, 250, 0.45),
            0 0 14px 0 rgba(167, 139, 250, 0.25),
            0 0 28px 0 rgba(167, 139, 250, 0.12);
          animation: atlas-composer-glow 2.4s ease-in-out infinite;
        }
        @keyframes atlas-composer-glow {
          0%, 100% {
            box-shadow:
              inset 0 0 0 1px rgba(167, 139, 250, 0.35),
              0 0 12px 0 rgba(167, 139, 250, 0.18),
              0 0 24px 0 rgba(167, 139, 250, 0.08);
          }
          50% {
            box-shadow:
              inset 0 0 0 1px rgba(167, 139, 250, 0.60),
              0 0 20px 0 rgba(167, 139, 250, 0.38),
              0 0 40px 0 rgba(167, 139, 250, 0.18);
          }
        }
      `}</style>
    </div>
  )
}

// ─── sessions sidebar ─────────────────────────────────────────────────────

function SessionSidebar({
  sessions,
  activeUuid,
  onOpen,
  onNew,
  onDelete,
  onRename,
  onToggleFavorite,
  disabled,
}: {
  sessions: AtlasChatSession[]
  activeUuid: string | null
  onOpen: (uuid: string) => void
  onNew: () => void
  onDelete: (uuid: string) => void
  onRename: (uuid: string, title: string) => Promise<void>
  onToggleFavorite: (uuid: string, favorite: boolean) => Promise<void>
  disabled: boolean
}) {
  const groups = useMemo(() => groupSessionsByAge(sessions), [sessions])
  return (
    <aside className="flex-none w-[260px] hidden md:flex flex-col bg-white/[0.02] ring-1 ring-inset ring-white/[0.04] rounded-2xl overflow-hidden shadow-xl shadow-black/30">
      <div className="flex-none px-3 pt-3 pb-2 flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wider font-semibold text-white/40">Chats</span>
        <button
          type="button"
          onClick={onNew}
          disabled={disabled}
          className="flex items-center justify-center bg-white/[0.04] hover:bg-white/[0.08] disabled:opacity-40 text-white/70 hover:text-white/90 ring-1 ring-inset ring-white/[0.06] rounded-md p-1.5 transition-colors"
          title="New chat"
          aria-label="New chat"
        >
          <Plus size={14} />
        </button>
      </div>
      <nav className="flex-1 min-h-0 overflow-y-auto atlas-scroll px-2 pb-3">
        {groups.length === 0 ? (
          <p className="text-center text-xs text-white/30 py-6">
            No past chats yet. Say hi on the right to start one.
          </p>
        ) : (
          groups.map((group) => (
            <div key={group.label} className="mb-4">
              <div className="text-[10px] uppercase tracking-wider text-white/30 font-semibold px-2 pb-1.5">
                {group.label}
              </div>
              <ul className="flex flex-col gap-0.5">
                {group.items.map((s) => (
                  <SessionRow
                    key={s.aichat_uuid}
                    session={s}
                    active={s.aichat_uuid === activeUuid}
                    onOpen={() => onOpen(s.aichat_uuid)}
                    onDelete={() => onDelete(s.aichat_uuid)}
                    onRename={(title) => onRename(s.aichat_uuid, title)}
                    onToggleFavorite={() => onToggleFavorite(s.aichat_uuid, !s.favorite)}
                  />
                ))}
              </ul>
            </div>
          ))
        )}
      </nav>
      <style jsx>{`
        .atlas-scroll {
          scrollbar-width: thin;
          scrollbar-color: rgba(255, 255, 255, 0.12) transparent;
        }
      `}</style>
    </aside>
  )
}

function SessionRow({
  session,
  active,
  onOpen,
  onDelete,
  onRename,
  onToggleFavorite,
}: {
  session: AtlasChatSession
  active: boolean
  onOpen: () => void
  onDelete: () => void
  onRename: (title: string) => Promise<void>
  onToggleFavorite: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(session.title)

  useEffect(() => {
    if (!editing) setDraft(session.title)
  }, [editing, session.title])

  const commitRename = async () => {
    const next = draft.trim()
    if (next && next !== session.title) {
      await onRename(next)
    }
    setEditing(false)
  }

  return (
    <li
      className={`group relative rounded-lg transition-colors ${
        active ? 'bg-violet-500/15 ring-1 ring-inset ring-violet-400/25' : 'hover:bg-white/[0.04]'
      }`}
    >
      {editing ? (
        <div className="flex items-center gap-1 px-2 py-1.5">
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename()
              if (e.key === 'Escape') setEditing(false)
            }}
            onBlur={commitRename}
            className="flex-1 bg-transparent text-sm text-white outline-none ring-1 ring-inset ring-white/10 rounded-md px-2 py-1"
          />
          <button
            className="p-1 text-white/60 hover:text-white"
            onMouseDown={(e) => {
              e.preventDefault()
              commitRename()
            }}
          >
            <Check size={12} />
          </button>
        </div>
      ) : (
        // The row is split into two SIBLING interactive areas: a main
        // title button and an action-icon cluster. They must not nest
        // inside each other — nested <button> is invalid HTML and breaks
        // React hydration. The parent <li> acts as the hover group for
        // revealing the action icons.
        <div className="flex items-center gap-1 pr-1">
          <button
            type="button"
            onClick={onOpen}
            className="flex-1 min-w-0 text-left flex items-center gap-2 px-2.5 py-2"
          >
            <MessageCircle
              size={13}
              className={`flex-none ${
                active ? 'text-violet-300' : 'text-white/30 group-hover:text-white/50'
              }`}
            />
            <span
              className={`text-sm truncate flex-1 ${
                active ? 'text-white' : 'text-white/70 group-hover:text-white/90'
              }`}
            >
              {session.title || 'Untitled'}
            </span>
            {session.favorite && !active && (
              <Star
                size={10}
                className="text-amber-300 flex-none group-hover:hidden"
                fill="currentColor"
              />
            )}
          </button>
          <div className="hidden group-hover:flex items-center gap-0.5 flex-none">
            <button
              type="button"
              onClick={onToggleFavorite}
              title={session.favorite ? 'Unfavorite' : 'Favorite'}
              className="p-1 text-white/40 hover:text-amber-300"
            >
              <Star
                size={12}
                fill={session.favorite ? 'currentColor' : 'none'}
                className={session.favorite ? 'text-amber-300' : ''}
              />
            </button>
            <button
              type="button"
              onClick={() => setEditing(true)}
              title="Rename"
              className="p-1 text-white/40 hover:text-white/80"
            >
              <Pencil size={12} />
            </button>
            <button
              type="button"
              onClick={() => {
                if (confirm(`Delete "${session.title}"?`)) onDelete()
              }}
              title="Delete"
              className="p-1 text-white/40 hover:text-rose-300"
            >
              <Trash2 size={12} />
            </button>
          </div>
        </div>
      )}
    </li>
  )
}

// ─── message bubble ───────────────────────────────────────────────────────

export function MessageBubble({
  message,
  onConfirm,
  onCancel,
  disabled,
  isLast,
  onApplyPending,
  onCancelPending,
  onRefinePending,
  onPickCandidate,
  onApplyStructure,
  onRefineStructure,
  onRetryError,
  pendingBusy,
}: {
  message: ChatMessage
  onConfirm: () => void
  onCancel: () => void
  disabled: boolean
  isLast: boolean
  onApplyPending?: (pendingId: string, opts?: { confirmationPhrase?: string }) => void
  onCancelPending?: (pendingId: string) => void
  onRefinePending?: (pendingId: string, instruction: string) => void
  onPickCandidate?: (cand: CandidateDTO) => void
  onApplyStructure?: (structure: EditableStructure) => void
  onRefineStructure?: (instruction: string) => void
  onRetryError?: () => void
  pendingBusy?: Record<string, boolean>
}) {
  const isUser = message.role === 'user'
  const toolCount = message.toolCalls?.length || 0
  const errCount = (message.toolCalls || []).filter((t) => t.isError).length
  // Legacy approval marker — old chat history may still carry it.
  const wantsConfirm =
    !isUser && !message.streaming && hasConfirmMarker(message.content)
  const baseContent = wantsConfirm ? stripConfirmMarker(message.content) : message.content
  // Legacy markdown-fence smuggling for atlas-course-plan — replaced by
  // the structured ``structure.proposal`` event but old history may still
  // include it.
  const { plan: legacyPlan, rest: proseContent } = !isUser
    ? extractCoursePlan(baseContent)
    : { plan: null as CoursePlan | null, rest: baseContent }

  // New-protocol structured attachments.
  const pendings = message.pendings ? Object.values(message.pendings) : []
  const hasStructureTree = !isUser && !!message.structureTree
  const hasTimeline = !isUser && (message.events?.length ?? 0) > 0
  const errorEntries = message.errorEntries || []
  // Legacy plan still renders read-only (old chat history); new structure
  // events render via the editable StructureProposalCard.
  const plan = legacyPlan
  const wide = Boolean(
    plan ||
      pendings.length ||
      hasStructureTree ||
      (message.resultsCards?.length ?? 0) ||
      errorEntries.length,
  )

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`${wide ? 'max-w-[88%] w-full' : 'max-w-[78%]'} rounded-xl text-[13px] leading-snug ${
          isUser
            ? 'bg-violet-500/15 ring-1 ring-inset ring-violet-400/25 text-white/95 rounded-tr-sm px-3 py-2'
            : message.errored
            ? 'bg-rose-500/10 ring-1 ring-inset ring-rose-400/25 text-rose-100 rounded-tl-sm px-3 py-2'
            : 'bg-white/[0.03] ring-1 ring-inset ring-white/[0.08] text-white/90 rounded-tl-sm px-3 py-2'
        }`}
      >
        {proseContent ? (
          <div className="prose prose-sm prose-invert max-w-none text-[13px] leading-snug prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 prose-pre:my-1.5 prose-headings:mt-2.5 prose-headings:mb-0.5 prose-headings:text-white/95 prose-h3:text-violet-200 prose-h3:font-semibold prose-h3:text-[14px] prose-strong:text-white prose-a:text-violet-300 hover:prose-a:text-violet-200 prose-code:text-violet-200 prose-code:bg-white/5 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none prose-pre:bg-black/40 prose-pre:ring-1 prose-pre:ring-white/10 prose-blockquote:border-l-violet-400/40 prose-blockquote:text-white/80 prose-blockquote:my-1">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{proseContent}</ReactMarkdown>
          </div>
        ) : (
          message.streaming && !plan && pendings.length === 0 && <ThinkingDots />
        )}
        {plan && (
          <div className={proseContent ? 'mt-3' : ''}>
            <CoursePlanCard plan={plan} />
          </div>
        )}

        {/* Live per-turn activity timeline (tools + entity.resolved + applied) */}
        {hasTimeline && (
          <ActionTimeline events={message.events} streaming={message.streaming} />
        )}

        {/* New-protocol entity resolution cards */}
        {(message.ambiguities || []).map((amb, i) => (
          <DisambiguationCard
            key={`amb-${i}`}
            kind={amb.kind}
            selector={amb.selector}
            candidates={amb.candidates}
            onPick={onPickCandidate}
          />
        ))}
        {(message.notFounds || []).map((nf, i) => (
          <NotFoundCard
            key={`nf-${i}`}
            kind={nf.kind}
            selector={nf.selector}
            suggestions={nf.suggestions}
            onPick={onPickCandidate}
          />
        ))}

        {/* Pending preview / confirm / applied cards */}
        {pendings.map((p) => (
          <PendingCard
            key={p.pendingId}
            pending={p}
            busy={!!pendingBusy?.[p.pendingId]}
            onApply={(phrase) =>
              onApplyPending?.(p.pendingId, phrase ? { confirmationPhrase: phrase } : undefined)
            }
            onCancel={() => onCancelPending?.(p.pendingId)}
            onRefine={(instr) => onRefinePending?.(p.pendingId, instr)}
          />
        ))}

        {/* Editable structure proposal (from suggest_course_structure) */}
        {hasStructureTree && message.structureTree && (
          <StructureProposalCard
            tree={message.structureTree}
            onApply={(structure) => onApplyStructure?.(structure)}
            onRefine={(instr) => onRefineStructure?.(instr)}
          />
        )}

        {/* Read-only results cards (replaces atlas-results fenced block) */}
        {(message.resultsCards || []).map((card, i) => (
          <ResultsListCard key={`rl-${i}`} kind={card.kind} items={card.items} />
        ))}

        {/* Structured error cards (replaces inline italic error prose) */}
        {errorEntries.map((err, i) => (
          <ErrorCard
            key={`err-${i}`}
            code={err.code}
            message={err.message}
            retriable={err.retriable}
            onRetry={err.retriable && isLast ? onRetryError : undefined}
          />
        ))}

        {wantsConfirm && isLast && (
          <ConfirmActions onConfirm={onConfirm} onCancel={onCancel} disabled={disabled} />
        )}
        {!isUser && !message.streaming && toolCount > 0 && (
          <ToolsSummary tools={message.toolCalls || []} totalErrors={errCount} />
        )}
      </div>
    </div>
  )
}

// Map the new ``structure.proposal`` event tree onto the existing
// CoursePlan shape so the original CoursePlanCard can render it
// without changes.
function structureTreeToPlan(tree: Record<string, any>): CoursePlan {
  const chapters: CoursePlanChapter[] = []
  const raw = Array.isArray(tree?.chapters) ? tree.chapters : []
  for (const ch of raw) {
    const activities = Array.isArray(ch?.activities) ? ch.activities : []
    chapters.push({
      name: ch?.name || '',
      activities: activities.map((a: any) => ({
        name: a?.name || a?.title || '',
        kind: a?.kind,
      })),
    })
  }
  return {
    title: tree?.topic || tree?.title,
    description: tree?.audience ? `Audience: ${tree.audience}` : undefined,
    chapters,
  }
}

function ConfirmActions({
  onConfirm,
  onCancel,
  disabled,
}: {
  onConfirm: () => void
  onCancel: () => void
  disabled: boolean
}) {
  return (
    <div className="mt-3 pt-3 border-t border-white/10 flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={onConfirm}
        disabled={disabled}
        className="flex items-center gap-1.5 bg-violet-600 hover:bg-violet-500 disabled:bg-white/5 disabled:text-white/30 text-white ring-1 ring-inset ring-violet-400/30 disabled:ring-white/10 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors"
      >
        <Check size={13} />
        Approve
      </button>
      <button
        type="button"
        onClick={onCancel}
        disabled={disabled}
        className="flex items-center gap-1.5 bg-white/5 hover:bg-white/10 disabled:opacity-40 text-white/70 hover:text-white/90 ring-1 ring-inset ring-white/10 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors"
      >
        <XIcon size={13} />
        Cancel
      </button>
      <span className="text-[11px] text-white/35 ml-1">
        Or type a change in the box below.
      </span>
    </div>
  )
}

function ThinkingDots() {
  return (
    <div className="flex items-center gap-1.5 py-1">
      <span className="w-1.5 h-1.5 bg-violet-300/60 rounded-full animate-pulse [animation-delay:0ms]" />
      <span className="w-1.5 h-1.5 bg-violet-300/60 rounded-full animate-pulse [animation-delay:150ms]" />
      <span className="w-1.5 h-1.5 bg-violet-300/60 rounded-full animate-pulse [animation-delay:300ms]" />
    </div>
  )
}

// ─── course-plan card ─────────────────────────────────────────────────────

const ACTIVITY_KIND_META: Record<
  string,
  { icon: React.ComponentType<{ size?: number; className?: string }>; label: string; color: string }
> = {
  dynamic: { icon: FileText, label: 'Page', color: 'text-sky-300' },
  quiz: { icon: HelpCircle, label: 'Quiz', color: 'text-amber-300' },
  video: { icon: Play, label: 'Video', color: 'text-rose-300' },
  pdf: { icon: FileText, label: 'PDF', color: 'text-emerald-300' },
  assignment: { icon: ClipboardList, label: 'Assignment', color: 'text-violet-300' },
}

function CoursePlanCard({ plan }: { plan: CoursePlan }) {
  const totalActivities = plan.chapters.reduce(
    (sum, ch) => sum + (ch.activities?.length || 0),
    0,
  )
  return (
    <div className="rounded-xl ring-1 ring-inset ring-white/10 bg-black/20 overflow-hidden">
      {/* card header — title + description + counts */}
      {(plan.title || plan.description) && (
        <div className="px-5 py-4 border-b border-white/10 bg-gradient-to-b from-violet-500/10 to-transparent">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider font-semibold text-violet-300/80 mb-1.5">
            <GlobeStand size={11} weight="duotone" />
            Course preview
          </div>
          {plan.title && (
            <h2 className="text-xl font-bold text-white tracking-tight leading-snug">
              {plan.title}
            </h2>
          )}
          {plan.description && (
            <p className="text-[13px] text-white/65 leading-relaxed mt-1.5">
              {plan.description}
            </p>
          )}
          <div className="flex items-center gap-3 mt-3 text-[11px] text-white/45">
            <span>
              <span className="font-semibold text-white/70">{plan.chapters.length}</span>{' '}
              {plan.chapters.length === 1 ? 'chapter' : 'chapters'}
            </span>
            <span className="w-px h-3 bg-white/15" />
            <span>
              <span className="font-semibold text-white/70">{totalActivities}</span>{' '}
              {totalActivities === 1 ? 'activity' : 'activities'}
            </span>
          </div>
        </div>
      )}
      {/* chapters */}
      <ul className="flex flex-col">
        {plan.chapters.map((ch, ci) => (
          <li
            key={`${ci}-${ch.name}`}
            className={`px-5 py-3 ${ci > 0 ? 'border-t border-white/[0.06]' : ''}`}
          >
            <div className="flex items-center gap-2 mb-2">
              <span className="flex items-center justify-center text-[10px] font-bold w-5 h-5 rounded-md bg-white/10 text-white/70">
                {ci + 1}
              </span>
              <span className="text-[14px] font-semibold text-white/90 leading-tight">
                {ch.name || `Chapter ${ci + 1}`}
              </span>
            </div>
            {ch.activities && ch.activities.length > 0 ? (
              <ul className="flex flex-col gap-1 pl-7">
                {ch.activities.map((a, ai) => {
                  const meta = ACTIVITY_KIND_META[a.kind || 'dynamic'] || ACTIVITY_KIND_META.dynamic
                  const Icon = meta.icon
                  return (
                    <li
                      key={`${ai}-${a.name}`}
                      className="flex items-center gap-2 text-[13px] text-white/75"
                    >
                      <Icon size={11} className={`${meta.color} flex-none`} />
                      <span className="truncate">{a.name}</span>
                      {a.kind && a.kind !== 'dynamic' && (
                        <span className="text-[10px] uppercase tracking-wider text-white/35 ml-auto flex-none">
                          {meta.label}
                        </span>
                      )}
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="pl-7 text-[12px] italic text-white/35">No activities yet.</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

function ToolsSummary({ tools, totalErrors }: { tools: ToolEvent[]; totalErrors: number }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-3 pt-2 border-t border-white/10">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-[11px] text-white/40 hover:text-white/70 transition-colors"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Wrench size={11} />
        <span>
          {tools.length} tool{tools.length === 1 ? '' : 's'}
          {totalErrors > 0 && (
            <span className="text-rose-300"> · {totalErrors} error{totalErrors === 1 ? '' : 's'}</span>
          )}
        </span>
      </button>
      {open && (
        <ul className="mt-2 flex flex-col gap-1.5">
          {tools.map((t) => (
            <ToolRow key={t.callId} tool={t} />
          ))}
        </ul>
      )}
    </div>
  )
}

function ToolRow({ tool }: { tool: ToolEvent }) {
  return (
    <li
      className={`flex items-start gap-2 rounded-lg px-2.5 py-1.5 text-[11px] ring-1 ring-inset ${
        tool.isError
          ? 'bg-rose-500/10 text-rose-200 ring-rose-400/20'
          : 'bg-white/[0.03] text-white/70 ring-white/10'
      }`}
    >
      <span className="pt-0.5">
        {tool.isError ? (
          <CircleX size={11} className="text-rose-300" />
        ) : (
          <CircleCheck size={11} className="text-emerald-300" />
        )}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="font-mono font-semibold text-white/85">{tool.name}</span>
          {Object.keys(tool.args).length > 0 && (
            <span className="font-mono text-white/40 truncate">{formatArgs(tool.args)}</span>
          )}
        </div>
        {tool.guidance && <div className="mt-1 italic text-white/50">{tool.guidance}</div>}
      </div>
    </li>
  )
}

export function ActionDock({ tools }: { tools: ToolEvent[] }) {
  const visible = tools.slice(-4)
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-violet-300/80 font-semibold pb-1.5">
        <span className="flex items-center gap-1">
          <span className="w-1 h-1 bg-violet-300/60 rounded-full animate-pulse [animation-delay:0ms]" />
          <span className="w-1 h-1 bg-violet-300/60 rounded-full animate-pulse [animation-delay:150ms]" />
          <span className="w-1 h-1 bg-violet-300/60 rounded-full animate-pulse [animation-delay:300ms]" />
        </span>
        Atlas is working
      </div>
      <ul className="flex flex-col gap-1">
        {visible.map((t) => (
          <li
            key={t.callId}
            className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[11px] ring-1 ring-inset ${
              t.resolved
                ? t.isError
                  ? 'bg-rose-500/10 text-rose-200 ring-rose-400/20'
                  : 'bg-emerald-500/10 text-emerald-200 ring-emerald-400/20'
                : 'bg-white/[0.04] text-white/70 ring-white/10'
            }`}
          >
            {t.resolved ? (
              t.isError ? (
                <CircleX size={11} />
              ) : (
                <CircleCheck size={11} />
              )
            ) : (
              <Loader2 size={11} className="animate-spin" />
            )}
            <span className="font-mono font-semibold">{t.name}</span>
            {Object.keys(t.args).length > 0 && (
              <span className="font-mono text-white/40 truncate flex-1 min-w-0">{formatArgs(t.args)}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

// ─── empty state ──────────────────────────────────────────────────────────

// ─── new-protocol cards (preview / confirm / disambiguation / results) ────
//
// These render the structured SSE events the new backend pipeline emits.
// Styling mirrors the rest of AtlasChat (violet-on-near-black, ring-1
// insets, rounded-xl) so they read as the same surface, not bolted-on.

function PendingCard({
  pending,
  busy,
  onApply,
  onCancel,
  onRefine,
}: {
  pending: MessagePending
  busy: boolean
  onApply: (confirmationPhrase?: string) => void
  onCancel: () => void
  onRefine: (instruction: string) => void
}) {
  if (pending.preview.type === 'preview.activity') {
    return (
      <div className="mt-3">
        <ActivityEditPreviewCardLazy
          pending={pending}
          busy={busy}
          onApply={() => onApply()}
          onCancel={onCancel}
          onRefine={onRefine}
        />
        {pending.challenge && pending.status !== 'applied' && pending.status !== 'dropped' && (
          <DestructiveChallenge
            challenge={pending.challenge}
            busy={busy}
            onConfirm={(phrase) => onApply(phrase)}
            onCancel={onCancel}
          />
        )}
        {pending.status === 'applied' && (
          <AppliedPill
            label={(pending.preview as any).target?.name || 'Activity'}
            versionAfter={pending.versionAfter}
            undoToken={pending.undoToken}
          />
        )}
      </div>
    )
  }
  // Chapter and course previews use their dedicated typed renderers
  // (FieldDiff / KeyValueDiff / BlastRadiusList) — no more raw JSON dumps.
  return (
    <>
      {pending.preview.type === 'preview.chapter' ? (
        <ChapterPreviewCard pending={pending} />
      ) : (
        <CoursePreviewCard pending={pending} />
      )}
      <div className="mt-1 rounded-b-xl ring-1 ring-inset ring-white/10 bg-black/20 overflow-hidden -mt-3 pt-3">
        <PendingFooter pending={pending} busy={busy} onApply={() => onApply()} onCancel={onCancel} onRefine={() => {}} canRefine={false} />
        {pending.challenge && pending.status !== 'applied' && pending.status !== 'dropped' && (
          <DestructiveChallenge
            challenge={pending.challenge}
            busy={busy}
            onConfirm={(phrase) => onApply(phrase)}
            onCancel={onCancel}
          />
        )}
      </div>
      {pending.status === 'applied' && (
        <AppliedPill
          label={(pending.preview as any).target?.name || (pending.preview.type === 'preview.chapter' ? 'Chapter' : 'Course')}
          versionAfter={pending.versionAfter}
          undoToken={pending.undoToken}
        />
      )}
    </>
  )
}

function PendingFooter({
  pending,
  busy,
  onApply,
  onCancel,
  onRefine,
  canRefine = true,
}: {
  pending: MessagePending
  busy: boolean
  onApply: () => void
  onCancel: () => void
  onRefine?: (instruction: string) => void
  canRefine?: boolean
}) {
  const [refineOpen, setRefineOpen] = useState(false)
  const [refineText, setRefineText] = useState('')

  if (pending.status === 'applied') {
    // The AppliedPill is rendered outside the card by the caller —
    // PendingFooter just collapses to nothing in the applied state so
    // the card itself doesn't carry a redundant strip.
    return null
  }
  if (pending.status === 'dropped') {
    return (
      <div className="px-4 py-2 border-t border-white/10 text-[11px] italic text-white/40">
        Proposal dropped.
      </div>
    )
  }
  if (pending.status === 'error') {
    return (
      <div className="flex items-start gap-2 px-4 py-2 border-t border-white/10 bg-rose-500/10 text-rose-200 text-xs">
        <CircleX size={13} className="mt-0.5" />
        <span>{pending.errorMessage || 'Apply failed.'}</span>
      </div>
    )
  }
  if (pending.challenge) {
    // Destructive: the inline DestructiveChallenge renders its own action bar.
    return null
  }
  return (
    <div className="border-t border-white/10">
      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5">
        <button
          type="button"
          onClick={onApply}
          disabled={busy}
          className="flex items-center gap-1.5 bg-violet-600 hover:bg-violet-500 disabled:bg-white/5 disabled:text-white/30 text-white ring-1 ring-inset ring-violet-400/30 disabled:ring-white/10 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors"
        >
          <Check size={13} />
          {busy ? 'Applying…' : 'Apply'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="flex items-center gap-1.5 bg-white/5 hover:bg-white/10 disabled:opacity-40 text-white/70 hover:text-white/90 ring-1 ring-inset ring-white/10 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors"
        >
          <XIcon size={13} />
          Cancel
        </button>
        {canRefine && onRefine && (
          <button
            type="button"
            onClick={() => setRefineOpen((v) => !v)}
            disabled={busy}
            className="flex items-center gap-1.5 bg-white/5 hover:bg-white/10 disabled:opacity-40 text-white/70 hover:text-white/90 ring-1 ring-inset ring-white/10 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors"
          >
            <Pencil size={12} />
            Refine
          </button>
        )}
      </div>
      {refineOpen && onRefine && (
        <form
          className="px-4 pb-3 flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            const text = refineText.trim()
            if (!text) return
            onRefine(text)
            setRefineText('')
            setRefineOpen(false)
          }}
        >
          <input
            autoFocus
            type="text"
            value={refineText}
            onChange={(e) => setRefineText(e.target.value)}
            placeholder="Change the proposal…"
            className="flex-1 rounded-lg bg-black/30 ring-1 ring-inset ring-white/10 focus:ring-violet-400/40 outline-none text-sm text-white px-2 py-1.5"
          />
          <button
            type="submit"
            className="flex items-center gap-1.5 bg-violet-600 hover:bg-violet-500 text-white ring-1 ring-inset ring-violet-400/30 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors"
          >
            <RotateCcw size={12} />
            Send
          </button>
        </form>
      )}
    </div>
  )
}

function DestructiveChallenge({
  challenge,
  busy,
  onConfirm,
  onCancel,
}: {
  challenge: ConfirmationChallengeDTO
  busy: boolean
  onConfirm: (phrase: string) => void
  onCancel: () => void
}) {
  const [typed, setTyped] = useState('')
  const match = typed.trim() === challenge.challenge_phrase.trim()
  return (
    <div className="border-t border-rose-400/20 bg-rose-500/10 px-4 py-3 space-y-2">
      <div className="flex items-start gap-2">
        <AlertTriangle size={14} className="text-rose-300 mt-0.5" />
        <div>
          <div className="text-sm font-semibold text-rose-100">{challenge.action_label}</div>
          <div className="text-[11px] text-rose-200/80 mt-0.5">{challenge.blast_radius_summary}</div>
        </div>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!match) return
          onConfirm(typed.trim())
        }}
        className="space-y-2"
      >
        <label className="block text-[11px] text-rose-200/90">
          To confirm, type{' '}
          <span className="rounded bg-black/30 px-1 py-0.5 font-mono text-rose-200">
            {challenge.challenge_phrase}
          </span>
        </label>
        <input
          autoFocus
          type="text"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          className="w-full rounded-lg bg-black/30 ring-1 ring-inset ring-rose-400/30 focus:ring-rose-300/60 outline-none text-sm text-white px-2 py-1.5"
        />
        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={!match || busy}
            className="flex items-center gap-1.5 bg-rose-600 hover:bg-rose-500 disabled:bg-white/5 disabled:text-white/30 text-white ring-1 ring-inset ring-rose-400/30 disabled:ring-white/10 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors"
          >
            <Check size={13} />
            {busy ? 'Applying…' : 'Confirm'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="flex items-center gap-1.5 bg-white/5 hover:bg-white/10 disabled:opacity-40 text-white/70 hover:text-white/90 ring-1 ring-inset ring-white/10 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors"
          >
            <XIcon size={13} />
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}

function DisambiguationCard({
  kind,
  selector,
  candidates,
  onPick,
}: {
  kind: 'course' | 'chapter' | 'activity'
  selector: string
  candidates: CandidateDTO[]
  onPick?: (cand: CandidateDTO) => void
}) {
  return (
    <div className="mt-3 rounded-xl ring-1 ring-inset ring-amber-400/30 bg-amber-500/10 px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-wider font-semibold text-amber-200/90">
        Which {kind}?
      </div>
      <div className="text-xs text-amber-100/90 mt-0.5">
        Atlas found multiple matches for &ldquo;{selector}&rdquo;.
      </div>
      <ul className="mt-2 flex flex-col gap-1">
        {candidates.map((c) => (
          <li key={c.uuid}>
            <button
              type="button"
              onClick={() => onPick?.(c)}
              className="w-full text-left bg-black/20 hover:bg-black/30 ring-1 ring-inset ring-white/10 rounded-lg px-3 py-2"
            >
              <div className="text-sm font-medium text-white">{c.label || c.name}</div>
              <div className="text-[11px] text-white/40">{kind} · {c.uuid.slice(0, 18)}…</div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function NotFoundCard({
  kind,
  selector,
  suggestions,
  onPick,
}: {
  kind: 'course' | 'chapter' | 'activity'
  selector: string
  suggestions: CandidateDTO[]
  onPick?: (cand: CandidateDTO) => void
}) {
  return (
    <div className="mt-3 rounded-xl ring-1 ring-inset ring-white/10 bg-white/[0.03] px-3 py-2.5 text-xs text-white/75">
      No {kind} matched &ldquo;{selector}&rdquo;.
      {suggestions.length > 0 && (
        <>
          {' '}Did you mean:{' '}
          {suggestions.map((s, i) => (
            <React.Fragment key={s.uuid}>
              <button
                type="button"
                onClick={() => onPick?.(s)}
                className="underline text-violet-300 hover:text-violet-200"
              >
                {s.label || s.name}
              </button>
              {i < suggestions.length - 1 ? ', ' : ''}
            </React.Fragment>
          ))}
          ?
        </>
      )}
    </div>
  )
}

function ResultsListCard({ kind, items }: { kind: string; items: Record<string, any>[] }) {
  if (!items.length) {
    return (
      <div className="mt-3 rounded-xl ring-1 ring-inset ring-white/10 bg-white/[0.03] px-3 py-2 text-xs italic text-white/40">
        No {kind} matched.
      </div>
    )
  }
  return (
    <div className="mt-3 rounded-xl ring-1 ring-inset ring-white/10 bg-black/20 overflow-hidden">
      <div className="px-3 py-1.5 border-b border-white/10 text-[10px] uppercase tracking-wider text-white/40 font-semibold">
        {kind} · {items.length}
      </div>
      <ul className="divide-y divide-white/[0.06]">
        {items.slice(0, 25).map((it, i) => (
          <li key={`${it.uuid || it.id || i}`} className="px-3 py-2">
            <div className="text-sm font-medium text-white/90">
              {it.name || it.title || it.uuid || '—'}
            </div>
            {it.description && (
              <div className="text-[11px] text-white/55 line-clamp-2">{it.description}</div>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

export function EmptyState({ onPick, disabled }: { onPick: (prompt: string) => void; disabled: boolean }) {
  const prompts = [
    'Create a course about Python fundamentals with 4 chapters.',
    'Publish every activity in my DNS course.',
    'Add a quiz about DNS records to the "What is DNS?" activity.',
    'Show me my 5 most recently updated courses.',
  ]
  return (
    <div className="flex flex-col items-center p-10 gap-6 text-center max-w-xl">
      <div className="bg-white/5 ring-1 ring-inset ring-white/10 p-4 rounded-2xl">
        <GlobeStand size={32} weight="duotone" className="text-violet-300" />
      </div>
      <div className="space-y-1.5">
        <p className="text-lg font-semibold text-white/90 tracking-tight">
          Ask me to build or edit a course.
        </p>
        <p className="text-sm text-white/50 leading-relaxed max-w-sm mx-auto">
          I focus one course at a time and work by name — no UUIDs to copy.
          Creating, renaming, publishing, reordering, writing content, adding
          quizzes: just say it.
        </p>
      </div>
      <div className="flex flex-col gap-2 w-full max-w-md">
        {prompts.map((p) => (
          <button
            key={p}
            disabled={disabled}
            onClick={() => onPick(p)}
            className="text-left text-sm bg-white/[0.03] hover:bg-white/[0.06] ring-1 ring-inset ring-white/10 hover:ring-white/20 disabled:opacity-40 rounded-xl px-4 py-2.5 text-white/75 hover:text-white/95 transition-colors"
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  )
}
