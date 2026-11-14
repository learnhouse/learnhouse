import { getAPIUrl } from '@services/config/config'

// Private learner notes: /notes. Every endpoint answers for the signed-in
// person only (see apps/api/src/services/courses/activities/learner_notes.py).

export type NoteAnchor = {
  kind: 'heading' | 'block' | 'video'
  ref?: string | null
  label?: string | null
  seconds?: number | null
}

export type NoteDoc = { type: 'doc'; content?: any[] }

export type LearnerNote = {
  note_uuid: string
  activity_uuid: string
  course_uuid: string
  content: NoteDoc
  plain_text: string
  anchor: NoteAnchor | null
  created_at: string
  updated_at: string
}

export type LearnerNoteWithContext = LearnerNote & {
  course: { course_uuid: string; name: string; slug: string | null; thumbnail_image: string | null }
  activity: { activity_uuid: string; name: string; activity_type: string; chapter_name: string | null }
}

export class NotesApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function call<T>(path: string, method: string, token: string | undefined, body?: unknown): Promise<T> {
  const res = await fetch(`${getAPIUrl()}notes${path}`, {
    method,
    headers: token
      ? { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
      : { 'Content-Type': 'application/json' },
    credentials: 'include',
    cache: 'no-store',
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) {
    let detail = res.statusText
    try {
      const data = await res.json()
      if (typeof data?.detail === 'string') detail = data.detail
    } catch {
      // Not JSON: keep the status text.
    }
    throw new NotesApiError(res.status, detail)
  }
  return (await res.json()) as T
}

export function listActivityNotes(activityUuid: string, token?: string) {
  return call<LearnerNote[]>(`/activity/${encodeURIComponent(activityUuid)}`, 'GET', token)
}

export function createNote(
  activityUuid: string,
  data: { content: NoteDoc; anchor?: NoteAnchor | null },
  token?: string
) {
  return call<LearnerNote>(`/activity/${encodeURIComponent(activityUuid)}`, 'POST', token, data)
}

export function updateNote(
  noteUuid: string,
  data: { content?: NoteDoc; anchor?: NoteAnchor | null; clear_anchor?: boolean },
  token?: string
) {
  return call<LearnerNote>(`/${encodeURIComponent(noteUuid)}`, 'PATCH', token, data)
}

export function deleteNote(noteUuid: string, token?: string) {
  return call<{ detail: string }>(`/${encodeURIComponent(noteUuid)}`, 'DELETE', token)
}

export function listMyNotes(
  orgId: number,
  opts: { courseUuid?: string; q?: string; limit?: number } = {},
  token?: string
) {
  const params = new URLSearchParams({ org_id: String(orgId) })
  if (opts.courseUuid) params.set('course_uuid', opts.courseUuid)
  if (opts.q) params.set('q', opts.q)
  if (opts.limit) params.set('limit', String(opts.limit))
  return call<{ notes: LearnerNoteWithContext[]; total: number }>(`?${params.toString()}`, 'GET', token)
}
