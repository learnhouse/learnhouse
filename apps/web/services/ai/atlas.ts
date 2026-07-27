// Atlas service layer.
//
// Mirrors the typed SSE protocol the backend pipeline emits. The old
// chunk/tool_call/tool_result events are gone — every meaningful moment
// in a turn (text delta, entity resolution, preview card, applied result,
// error) is a discriminated union member here. UI hooks consume this
// shape directly via a typed switch.

import { getAPIUrl } from '@services/config/config'
import { RequestBodyWithAuthHeader } from '@services/utils/ts/requests'

// ─── Auth / session lifecycle ──────────────────────────────────────────

export interface AtlasSession {
  token: string
  token_uuid: string
  expires_at: string
  ttl_seconds: number
}

export interface AtlasChatSession {
  aichat_uuid: string
  title: string
  created_at: string | null
  favorite: boolean
}

export async function startAtlasSession(
  orgId: number,
  accessToken: string,
): Promise<AtlasSession> {
  const res = await fetch(
    `${getAPIUrl()}ai/atlas/session?org_id=${orgId}`,
    RequestBodyWithAuthHeader('POST', null, undefined, accessToken),
  )
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Failed to start Atlas session (${res.status}): ${body}`)
  }
  return res.json()
}

export async function revokeAtlasSession(
  tokenUuid: string,
  accessToken: string,
): Promise<void> {
  await fetch(
    `${getAPIUrl()}ai/atlas/session/revoke`,
    RequestBodyWithAuthHeader('POST', { token_uuid: tokenUuid }, undefined, accessToken),
  )
}

// ─── Page context + references (carried in chat requests) ──────────────

export interface AtlasReferencePayload {
  type: 'activity' | 'chapter'
  uuid: string
  name: string
  parent_course_uuid: string
  parent_chapter_id?: number
  parent_chapter_name?: string
  activity_type?: string
}

export interface AtlasPageContextPayload {
  course_uuid?: string
  course_name?: string
  chapter_uuid?: string
  chapter_id?: number
  chapter_name?: string
  activity_uuid?: string
  activity_name?: string
  references?: AtlasReferencePayload[]
}

// ─── Typed SSE event union (mirrors backend events.py) ─────────────────

export interface ResourceRefDTO {
  kind: 'course' | 'chapter' | 'activity'
  uuid: string
  name: string
  parent_course_uuid?: string
  parent_chapter_id?: number
}

export interface CandidateDTO {
  kind: 'course' | 'chapter' | 'activity'
  uuid: string
  name: string
  label: string
  score: number
  parent_course_uuid?: string
  parent_chapter_id?: number
}

export interface ConfirmationChallengeDTO {
  pending_id: string
  action_label: string
  blast_radius_summary: string
  challenge_phrase: string
  challenge_kind: 'type_name' | 'type_phrase'
}

export type AtlasEvent =
  | { type: 'session'; aichat_uuid: string }
  | { type: 'message.delta'; delta: string }
  | { type: 'tool.start'; call_id: string; name: string; args_redacted?: Record<string, any> }
  | { type: 'tool.end'; call_id: string; name?: string; ok: boolean; duration_ms?: number }
  | { type: 'entity.resolved'; kind: 'course' | 'chapter' | 'activity'; uuid: string; name: string; via: string; score?: number }
  | { type: 'entity.ambiguous'; kind: 'course' | 'chapter' | 'activity'; selector: string; candidates: CandidateDTO[] }
  | { type: 'entity.not_found'; kind: 'course' | 'chapter' | 'activity'; selector: string; suggestions: CandidateDTO[] }
  | {
      type: 'preview.activity'
      pending_id: string
      target: ResourceRefDTO
      proposed: Record<string, any>
      current?: Record<string, any> | null
      summary: string
      mode: 'rename' | 'create' | 'replace' | 'append' | 'duplicate' | 'publish' | 'delete'
      expected_version?: number
    }
  | {
      type: 'preview.chapter'
      pending_id: string
      target: ResourceRefDTO
      patch: Record<string, any>
      current?: Record<string, any> | null
      summary: string
      mode: 'rename' | 'create' | 'edit' | 'delete' | 'move_activities' | 'reorder'
    }
  | {
      type: 'preview.course'
      pending_id: string
      target: ResourceRefDTO
      patch: Record<string, any>
      current?: Record<string, any> | null
      summary: string
      mode: 'create' | 'edit' | 'delete' | 'reorder_chapters' | 'rename'
    }
  | { type: 'results.list'; kind: string; items: Record<string, any>[] }
  | { type: 'structure.proposal'; tree: Record<string, any> }
  | { type: 'confirm.required'; pending_id: string; challenge: ConfirmationChallengeDTO }
  | { type: 'applied'; pending_id: string; target: ResourceRefDTO; version_after?: number; undo_token?: string | null }
  | { type: 'pending.dropped'; pending_id: string; reason: 'superseded' | 'cancelled' | 'expired' | 'subject_change' }
  | { type: 'error'; code: string; message: string; retriable?: boolean }
  | { type: 'done' }

// ─── Chat streaming ────────────────────────────────────────────────────

export async function* streamAtlasChat(params: {
  orgId: number
  sessionToken: string
  message: string
  aichatUuid?: string
  accessToken: string
  signal?: AbortSignal
  pageContext?: AtlasPageContextPayload | null
}): AsyncGenerator<AtlasEvent> {
  const res = await fetch(`${getAPIUrl()}ai/atlas/chat`, {
    ...RequestBodyWithAuthHeader(
      'POST',
      {
        org_id: params.orgId,
        session_token: params.sessionToken,
        message: params.message,
        aichat_uuid: params.aichatUuid,
        page_context: params.pageContext || undefined,
      },
      undefined,
      params.accessToken,
    ),
    signal: params.signal,
  })
  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => '')
    throw new Error(`Atlas chat stream failed (${res.status}): ${body}`)
  }
  yield* parseSseStream(res.body)
}

// ─── Pending edit lifecycle ────────────────────────────────────────────

export async function* applyPendingEdit(params: {
  pendingId: string
  orgId: number
  sessionToken: string
  confirmationPhrase?: string | null
  accessToken: string
  signal?: AbortSignal
}): AsyncGenerator<AtlasEvent> {
  const res = await fetch(`${getAPIUrl()}ai/atlas/pending/${params.pendingId}/apply`, {
    ...RequestBodyWithAuthHeader(
      'POST',
      {
        org_id: params.orgId,
        session_token: params.sessionToken,
        confirmation_phrase: params.confirmationPhrase || undefined,
      },
      undefined,
      params.accessToken,
    ),
    signal: params.signal,
  })
  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => '')
    throw new Error(`Apply pending failed (${res.status}): ${body}`)
  }
  yield* parseSseStream(res.body)
}

export async function cancelPendingEdit(params: {
  pendingId: string
  orgId: number
  accessToken: string
}): Promise<boolean> {
  const res = await fetch(
    `${getAPIUrl()}ai/atlas/pending/${params.pendingId}/cancel`,
    RequestBodyWithAuthHeader('POST', { org_id: params.orgId }, undefined, params.accessToken),
  )
  return res.ok
}

export async function* refinePendingEdit(params: {
  pendingId: string
  orgId: number
  sessionToken: string
  instruction: string
  accessToken: string
  pageContext?: AtlasPageContextPayload | null
  signal?: AbortSignal
}): AsyncGenerator<AtlasEvent> {
  const res = await fetch(`${getAPIUrl()}ai/atlas/pending/${params.pendingId}/refine`, {
    ...RequestBodyWithAuthHeader(
      'POST',
      {
        org_id: params.orgId,
        session_token: params.sessionToken,
        instruction: params.instruction,
        page_context: params.pageContext || undefined,
      },
      undefined,
      params.accessToken,
    ),
    signal: params.signal,
  })
  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => '')
    throw new Error(`Refine pending failed (${res.status}): ${body}`)
  }
  yield* parseSseStream(res.body)
}

// ─── SSE wire parser (shared by chat / apply / refine) ─────────────────

export async function* parseSseStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<AtlasEvent> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let pendingEvent = ''

  // SSE frames are terminated by a blank line, which the spec allows to be
  // either ``\n\n`` (LF LF) or ``\r\n\r\n`` (CRLF CRLF). sse-starlette on
  // the backend emits CRLF; using only ``indexOf('\n\n')`` here silently
  // never matches inside CRLF data and the generator yields nothing while
  // still consuming the whole stream.
  const findFrameEnd = (s: string): { idx: number; sepLen: number } => {
    const crlf = s.indexOf('\r\n\r\n')
    const lf = s.indexOf('\n\n')
    if (crlf === -1 && lf === -1) return { idx: -1, sepLen: 0 }
    if (crlf === -1) return { idx: lf, sepLen: 2 }
    if (lf === -1) return { idx: crlf, sepLen: 4 }
    // Prefer whichever boundary appears first in the buffer.
    return crlf <= lf ? { idx: crlf, sepLen: 4 } : { idx: lf, sepLen: 2 }
  }

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let { idx, sepLen } = findFrameEnd(buffer)
    while (idx !== -1) {
      const raw = buffer.slice(0, idx)
      buffer = buffer.slice(idx + sepLen)
      let event = pendingEvent
      const dataParts: string[] = []
      for (const line of raw.split(/\r?\n/)) {
        if (line.startsWith('event: ')) {
          event = line.slice(7).trim()
        } else if (line.startsWith('data: ')) {
          dataParts.push(line.slice(6))
        }
      }
      pendingEvent = ''
      const data = dataParts.join('\n')
      if (data) {
        try {
          const parsed = JSON.parse(data) as Record<string, any>
          // The backend sets `event:` to the type; mirror it in the payload
          // so consumers can rely on a single `type` field regardless of
          // whether the type lives in the SSE event header or the body.
          if (event && !parsed.type) parsed.type = event
          yield parsed as AtlasEvent
        } catch {
          /* skip malformed frame */
        }
      }
      ;({ idx, sepLen } = findFrameEnd(buffer))
    }
  }
}

// ─── Session CRUD (unchanged) ──────────────────────────────────────────

export async function listAtlasChatSessions(
  orgId: number,
  accessToken: string,
): Promise<AtlasChatSession[]> {
  const res = await fetch(
    `${getAPIUrl()}ai/atlas/sessions?org_id=${orgId}`,
    RequestBodyWithAuthHeader('GET', null, undefined, accessToken),
  )
  if (!res.ok) return []
  const body = await res.json()
  return body?.sessions || []
}

// Persisted per-turn shape returned by the /messages endpoint. The new
// backend stores the full event log under ``tool_calls`` (legacy field
// name, kept for compatibility with the existing chat-history Redis
// schema); legacy v1 turns stored a flat list of {name, args, summary,
// is_error, guidance} entries. Both shapes flow through this type.
export interface AtlasToolCallPersisted {
  name?: string
  args?: Record<string, any>
  summary?: string
  is_error?: boolean
  guidance?: string
  // New-protocol payloads (preview.activity, applied, etc.) appear as a
  // ``type``-tagged blob; consumers should branch off this field.
  type?: string
  [key: string]: any
}

export interface AtlasMessage {
  role: 'user' | 'model'
  content: string
  tool_calls?: AtlasToolCallPersisted[]
}

// Alias kept for callers that prefer the more explicit name.
export type PersistedTurn = AtlasMessage

export async function loadAtlasChatMessages(
  aichatUuid: string,
  accessToken: string,
): Promise<AtlasMessage[]> {
  const res = await fetch(
    `${getAPIUrl()}ai/atlas/sessions/${aichatUuid}/messages`,
    RequestBodyWithAuthHeader('GET', null, undefined, accessToken),
  )
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Failed to load chat (${res.status}): ${body}`)
  }
  const data = await res.json()
  return (data?.messages || []) as AtlasMessage[]
}

export async function deleteAtlasChatSession(
  aichatUuid: string,
  accessToken: string,
): Promise<void> {
  const res = await fetch(
    `${getAPIUrl()}ai/atlas/sessions/${aichatUuid}`,
    RequestBodyWithAuthHeader('DELETE', null, undefined, accessToken),
  )
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Failed to delete chat (${res.status}): ${body}`)
  }
}

export async function updateAtlasChatSession(
  aichatUuid: string,
  updates: { title?: string; favorite?: boolean },
  accessToken: string,
): Promise<AtlasChatSession | null> {
  const res = await fetch(
    `${getAPIUrl()}ai/atlas/sessions/${aichatUuid}`,
    RequestBodyWithAuthHeader('PATCH', updates, undefined, accessToken),
  )
  if (!res.ok) return null
  const body = await res.json()
  return body?.session || null
}

// ─── Undo applied pending ──────────────────────────────────────────────

export async function* undoPendingEdit(params: {
  pendingId: string
  orgId: number
  sessionToken: string
  accessToken: string
  signal?: AbortSignal
}): AsyncGenerator<AtlasEvent> {
  const res = await fetch(`${getAPIUrl()}ai/atlas/pending/${params.pendingId}/undo`, {
    ...RequestBodyWithAuthHeader(
      'POST',
      { org_id: params.orgId, session_token: params.sessionToken },
      undefined,
      params.accessToken,
    ),
    signal: params.signal,
  })
  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => '')
    throw new Error(`Undo failed (${res.status}): ${body}`)
  }
  yield* parseSseStream(res.body)
}

// ─── Live pending list for a chat session ──────────────────────────────

export interface PersistedPending {
  pending_id: string
  tool_name: string
  tier: 'READ' | 'CREATE' | 'EDIT' | 'DESTRUCTIVE'
  target: ResourceRefDTO
  status:
    | 'proposed'
    | 'awaiting_confirm'
    | 'applying'
    | 'applied'
    | 'cancelled'
    | 'superseded'
    | 'reverted'
    | 'failed'
  summary: string
  version_after?: number | null
  undo_token?: string | null
  expires_at?: string | null
}

export async function listPendingsForChat(
  aichatUuid: string,
  orgId: number,
  accessToken: string,
): Promise<PersistedPending[]> {
  const res = await fetch(
    `${getAPIUrl()}ai/atlas/sessions/${aichatUuid}/pendings?org_id=${orgId}`,
    RequestBodyWithAuthHeader('GET', null, undefined, accessToken),
  )
  if (!res.ok) return []
  const body = await res.json()
  return (body?.pendings || []) as PersistedPending[]
}

// ─── Course-from-structure (one-shot provisioning) ─────────────────────

export interface CourseStructureActivity {
  name: string
  kind: 'dynamic' | 'quiz' | 'video' | 'pdf' | 'assignment'
  initial_brief?: string | null
}

export interface CourseStructureChapter {
  name: string
  description?: string | null
  activities: CourseStructureActivity[]
}

export interface CourseStructurePayload {
  name: string
  description?: string | null
  about?: string | null
  learnings?: string[] | null
  chapters: CourseStructureChapter[]
}

// ─── Atlas health probe ────────────────────────────────────────────────

export interface AtlasHealth {
  mcp_reachable: boolean
  redis_reachable: boolean
  gemini_key_present: boolean
  plan_ok: boolean
}

export async function getAtlasHealth(accessToken: string): Promise<AtlasHealth | null> {
  const res = await fetch(
    `${getAPIUrl()}ai/atlas/health`,
    RequestBodyWithAuthHeader('GET', null, undefined, accessToken),
  )
  if (!res.ok) return null
  return res.json()
}
