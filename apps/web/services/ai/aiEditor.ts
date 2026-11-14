// AI Editor service: the activity editor's AI panel on the Atlas engine.
//
// Mirrors apps/api/ee/routers/atlas_ai_editor.py. Each page's conversation is
// an Atlas chat (surface "ai_editor"); a turn is an Atlas background run, so
// the SSE stream can be dropped (panel closed) and picked up again with
// followAIEditorRun. Edits to the open page come back as proposals that the
// editor previews and applies itself (components/Objects/Editor/AI/engine).
//
// Open-source builds have no such API: getAIEditorStatus returns
// { available: false, legacy: true } and the panel falls back to the older
// editor stream (services/ai/ai.ts).

import { getAPIUrl } from '@services/config/config'
import { RequestBodyWithAuthHeader } from '@services/utils/ts/requests'

export type HunkKind = 'replace' | 'insert' | 'delete' | 'image'
export type HunkDecision = 'pending' | 'applied' | 'rejected' | 'reverted' | 'stale'

export interface AIEditorHunk {
  id: string
  kind: HunkKind
  /** Top-level index in the snapshot the proposal was made on. */
  index: number
  before: Record<string, any>[]
  after: Record<string, any>[]
  prev: Record<string, any> | null
  next: Record<string, any> | null
  /** Formatting on text this change removes: mark type -> count (comment, spoiler...). */
  lost?: Record<string, number>
  /** Image suggestions only. */
  prompt?: string
  alt?: string
}

export interface AIEditorProposal {
  id: string
  chat: string | null
  activity_uuid: string
  summary: string
  action?: string | null
  hunks: AIEditorHunk[]
  decisions: Record<string, HunkDecision>
  notes: string[]
  created_at?: number
  applied_at?: number | null
  version_label?: string | null
}

export interface AIEditorCosts {
  turn: number
  complete: number
  image: number
}

export interface AIEditorActiveRun {
  run_id: string
  status: string
  started_at: number
  user_message: string
  file_names: string[]
  frames: number
}

export interface AIEditorStatus {
  available: boolean
  /** No AI Editor API on this server (open-source build): use the legacy stream. */
  legacy?: boolean
  /** The org has Atlas (changes to other pages, "continue in Atlas"). */
  atlas?: boolean
  costs?: AIEditorCosts
  chat?: string | null
  chat_title?: string | null
  active_run?: AIEditorActiveRun | null
  error?: string
}

export interface AIEditorFile {
  id: string
  name: string
  kind: string
  size: number
  mime?: string
  pages?: number | null
  note?: string | null
}

// The Atlas SSE events the panel reacts to (subset of ee/services/ai/atlas.ts).
export type AIEditorEvent =
  | { type: 'session'; aichat_uuid: string }
  | { type: 'message.delta'; delta: string }
  | { type: 'tool.start'; call_id: string; name: string; args_redacted?: Record<string, any> }
  | { type: 'tool.end'; call_id: string; name?: string; ok: boolean; error?: string | null; detail?: string | null }
  | { type: 'ui.block'; call_id?: string; block: Record<string, any> }
  | {
      type: 'preview.action'
      pending_id: string
      tool: string
      tier: string
      target: Record<string, any>
      summary: string
      risk?: string
      reason?: string
      changes?: Record<string, any>[] | null
      tool_call_id?: string | null
    }
  | { type: 'confirm.required'; pending_id: string; challenge: Record<string, any> }
  | { type: 'applied'; pending_id: string; target: Record<string, any>; summary?: string; tool?: string }
  | { type: 'approval.recorded'; pending_id: string; decision: 'approved' | 'rejected'; waiting_on: number }
  | { type: 'pending.dropped'; pending_id: string; reason: string }
  | { type: 'suggestions'; items: { label?: string; prompt?: string; text?: string }[] }
  | { type: 'error'; code: string; message: string; retriable?: boolean }
  | { type: 'stopped' }
  | { type: 'done' }
  | { type: string; [key: string]: any }

export interface AIEditorPersistedMessage {
  role: 'user' | 'model'
  content: string
  blocks?: Record<string, any>[]
  tools?: (string | { name: string; [key: string]: any })[]
  files?: AIEditorFile[]
}

export class AIEditorError extends Error {
  status: number
  code?: string
  constructor(status: number, message: string, code?: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

const BASE = () => `${getAPIUrl()}ai/atlas/ai-editor`

async function errorOf(res: Response): Promise<AIEditorError> {
  const body = await res.text().catch(() => '')
  let detail: any = null
  try {
    detail = JSON.parse(body)?.detail
  } catch {
    detail = null
  }
  const message = typeof detail === 'string' ? detail : detail?.message || body || `Request failed (${res.status})`
  return new AIEditorError(res.status, message, typeof detail === 'object' ? detail?.code : undefined)
}

async function getJSON<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${BASE()}${path}`, RequestBodyWithAuthHeader('GET', null, undefined, token))
  if (!res.ok) throw await errorOf(res)
  return res.json()
}

async function postJSON<T>(path: string, body: unknown, token: string): Promise<T> {
  const res = await fetch(`${BASE()}${path}`, RequestBodyWithAuthHeader('POST', body, undefined, token))
  if (!res.ok) throw await errorOf(res)
  return res.json()
}

export async function getAIEditorStatus(orgId: number, activityUuid: string, token: string): Promise<AIEditorStatus> {
  try {
    const res = await fetch(
      `${BASE()}/status?org_id=${orgId}&activity_uuid=${encodeURIComponent(activityUuid)}`,
      RequestBodyWithAuthHeader('GET', null, undefined, token)
    )
    // 404 on the route itself (no EE API) or a license gate: the legacy panel.
    if (res.status === 404 || res.status === 405 || res.status === 402) return { available: false, legacy: true }
    if (!res.ok) {
      const err = await errorOf(res)
      return { available: false, error: err.message }
    }
    return res.json()
  } catch {
    return { available: false, legacy: true }
  }
}

export interface AIEditorChatRequest {
  orgId: number
  activityUuid: string
  message: string
  doc: unknown
  selection?: { text?: string | null; path?: number[] | null } | null
  action?: string | null
  aichatUuid?: string | null
  fileIds?: string[]
  newChat?: boolean
  token: string
  signal?: AbortSignal
}

export async function* streamAIEditorChat(req: AIEditorChatRequest): AsyncGenerator<AIEditorEvent> {
  const res = await fetch(`${BASE()}/chat`, {
    ...RequestBodyWithAuthHeader(
      'POST',
      {
        org_id: req.orgId,
        activity_uuid: req.activityUuid,
        message: req.message,
        doc: req.doc,
        selection: req.selection || undefined,
        action: req.action || undefined,
        aichat_uuid: req.aichatUuid || undefined,
        file_ids: req.fileIds?.length ? req.fileIds : undefined,
        new_chat: req.newChat || undefined,
      },
      undefined,
      req.token
    ),
    signal: req.signal,
  })
  if (!res.ok || !res.body) throw await errorOf(res)
  yield* parseSSE(res.body)
}

export async function* followAIEditorRun(params: {
  orgId: number
  chat: string
  after?: number
  token: string
  signal?: AbortSignal
}): AsyncGenerator<AIEditorEvent> {
  const res = await fetch(`${BASE()}/chats/${encodeURIComponent(params.chat)}/run?org_id=${params.orgId}&after=${params.after || 0}`, {
    ...RequestBodyWithAuthHeader('GET', null, undefined, params.token),
    signal: params.signal,
  })
  if (!res.ok || !res.body) throw await errorOf(res)
  yield* parseSSE(res.body)
}

export async function stopAIEditorRun(orgId: number, chat: string, token: string): Promise<void> {
  await fetch(
    `${BASE()}/chats/${encodeURIComponent(chat)}/stop?org_id=${orgId}`,
    RequestBodyWithAuthHeader('POST', null, undefined, token)
  ).catch(() => undefined)
}

export async function loadAIEditorChat(
  orgId: number,
  chat: string,
  token: string
): Promise<{ messages: AIEditorPersistedMessage[]; active_run: AIEditorActiveRun | null }> {
  return getJSON(`/chats/${encodeURIComponent(chat)}/messages?org_id=${orgId}`, token)
}

export async function startNewAIEditorChat(orgId: number, activityUuid: string, token: string): Promise<void> {
  await postJSON(`/new-chat?org_id=${orgId}&activity_uuid=${encodeURIComponent(activityUuid)}`, null, token)
}

export async function getAIEditorProposal(orgId: number, id: string, token: string): Promise<AIEditorProposal> {
  return getJSON(`/proposals/${encodeURIComponent(id)}?org_id=${orgId}`, token)
}

export async function recordAIEditorDecisions(
  orgId: number,
  id: string,
  decisions: Record<string, HunkDecision>,
  token: string,
  versionLabel?: string | null
): Promise<AIEditorProposal | null> {
  try {
    return await postJSON(`/proposals/${encodeURIComponent(id)}/decisions`, { org_id: orgId, decisions, version_label: versionLabel || undefined }, token)
  } catch {
    return null
  }
}

export async function getAIEditorHistory(orgId: number, activityUuid: string, token: string): Promise<AIEditorProposal[]> {
  const body = await getJSON<{ items: AIEditorProposal[] }>(
    `/history?org_id=${orgId}&activity_uuid=${encodeURIComponent(activityUuid)}`,
    token
  )
  return Array.isArray(body?.items) ? body.items : []
}

export async function completeAIEditorText(
  params: { orgId: number; activityUuid: string; before: string; after?: string; token: string; signal?: AbortSignal }
): Promise<string> {
  const res = await fetch(`${BASE()}/complete`, {
    ...RequestBodyWithAuthHeader(
      'POST',
      { org_id: params.orgId, activity_uuid: params.activityUuid, before: params.before, after: params.after || '' },
      undefined,
      params.token
    ),
    signal: params.signal,
  })
  if (!res.ok) throw await errorOf(res)
  const body = await res.json()
  return typeof body?.text === 'string' ? body.text : ''
}

export async function* decideAIEditorPending(params: {
  orgId: number
  pendingId: string
  approve: boolean
  instruction?: string | null
  confirmationPhrase?: string | null
  token: string
  signal?: AbortSignal
}): AsyncGenerator<AIEditorEvent> {
  const res = await fetch(`${BASE()}/pending/${encodeURIComponent(params.pendingId)}/${params.approve ? 'apply' : 'reject'}`, {
    ...RequestBodyWithAuthHeader(
      'POST',
      {
        org_id: params.orgId,
        instruction: params.instruction || undefined,
        confirmation_phrase: params.confirmationPhrase || undefined,
      },
      undefined,
      params.token
    ),
    signal: params.signal,
  })
  if (!res.ok || !res.body) throw await errorOf(res)
  yield* parseSSE(res.body)
}

/** Upload a source file (checked and text-extracted like Atlas attachments). */
export function uploadAIEditorFile(params: {
  orgId: number
  file: File
  token: string
  onProgress?: (_fraction: number) => void
}): Promise<AIEditorFile> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${BASE()}/files?org_id=${params.orgId}`)
    xhr.withCredentials = true
    xhr.setRequestHeader('Authorization', `Bearer ${params.token}`)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) params.onProgress?.(e.loaded / e.total)
    }
    xhr.onload = () => {
      let body: any = null
      try {
        body = JSON.parse(xhr.responseText)
      } catch {
        body = null
      }
      if (xhr.status >= 200 && xhr.status < 300 && body?.id) return resolve(body as AIEditorFile)
      const detail = body?.detail
      reject(new AIEditorError(xhr.status, detail?.message || (typeof detail === 'string' ? detail : 'Upload failed'), detail?.code))
    }
    xhr.onerror = () => reject(new AIEditorError(0, 'Upload failed'))
    const form = new FormData()
    form.append('file', params.file, params.file.name)
    xhr.send(form)
  })
}

/** SSE frames (LF or CRLF framed) as parsed events. */
export async function* parseSSE(body: ReadableStream<Uint8Array>): AsyncGenerator<AIEditorEvent> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const frameEnd = (s: string): [number, number] => {
    const crlf = s.indexOf('\r\n\r\n')
    const lf = s.indexOf('\n\n')
    if (crlf === -1 && lf === -1) return [-1, 0]
    if (crlf === -1) return [lf, 2]
    if (lf === -1) return [crlf, 4]
    return crlf <= lf ? [crlf, 4] : [lf, 2]
  }
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let [idx, len] = frameEnd(buffer)
    while (idx !== -1) {
      const raw = buffer.slice(0, idx)
      buffer = buffer.slice(idx + len)
      let event = ''
      const data: string[] = []
      for (const line of raw.split(/\r?\n/)) {
        if (line.startsWith('event: ')) event = line.slice(7).trim()
        else if (line.startsWith('data: ')) data.push(line.slice(6))
      }
      if (data.length) {
        try {
          const parsed = JSON.parse(data.join('\n'))
          if (event && !parsed.type) parsed.type = event
          yield parsed as AIEditorEvent
        } catch {
          // a malformed frame is skipped
        }
      }
      ;[idx, len] = frameEnd(buffer)
    }
  }
}
