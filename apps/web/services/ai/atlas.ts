import { getAPIUrl } from '@services/config/config'
import { RequestBodyWithAuthHeader } from '@services/utils/ts/requests'

export type AtlasRole = 'user' | 'model'

export interface AtlasToolCallPersisted {
  name: string
  args: Record<string, any>
  summary?: string
  is_error?: boolean
  guidance?: string
}

export interface AtlasMessage {
  role: AtlasRole
  content: string
  // Present only on model messages reloaded from history.
  tool_calls?: AtlasToolCallPersisted[]
}

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

export type AtlasEvent =
  | { type: 'session'; aichat_uuid: string }
  | { type: 'start' }
  | { type: 'chunk'; content: string }
  | { type: 'tool_call'; name: string; args: Record<string, any>; call_id: string }
  | { type: 'tool_result'; call_id: string; summary: string; is_error: boolean; guidance?: string }
  | { type: 'done' }
  | { type: 'error'; message: string }

// ─── session-token lifecycle ────────────────────────────────────────────

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

// ─── chat stream ────────────────────────────────────────────────────────

export async function* streamAtlasChat(params: {
  orgId: number
  sessionToken: string
  message: string
  aichatUuid?: string
  accessToken: string
  signal?: AbortSignal
}): AsyncGenerator<AtlasEvent> {
  const res = await fetch(
    `${getAPIUrl()}ai/atlas/chat`,
    {
      ...RequestBodyWithAuthHeader(
        'POST',
        {
          org_id: params.orgId,
          session_token: params.sessionToken,
          message: params.message,
          aichat_uuid: params.aichatUuid,
        },
        undefined,
        params.accessToken,
      ),
      signal: params.signal,
    },
  )
  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => '')
    throw new Error(`Atlas chat stream failed (${res.status}): ${body}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let sepIdx = buffer.indexOf('\n\n')
    while (sepIdx !== -1) {
      const raw = buffer.slice(0, sepIdx)
      buffer = buffer.slice(sepIdx + 2)
      const data = raw
        .split('\n')
        .filter((l) => l.startsWith('data: '))
        .map((l) => l.slice(6))
        .join('\n')
      if (data) {
        try {
          yield JSON.parse(data) as AtlasEvent
        } catch {
          /* skip malformed SSE frames */
        }
      }
      sepIdx = buffer.indexOf('\n\n')
    }
  }
}

// ─── session CRUD ───────────────────────────────────────────────────────

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
