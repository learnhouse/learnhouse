import { getAPIUrl } from '@services/config/config'

// Editor comments on an activity: /activities/{activity_uuid}/comments.
// Only people who can edit the activity reach these endpoints.

export type CommentAuthor = {
  id: number
  user_uuid: string
  username: string
  first_name: string
  last_name: string
  avatar_image: string
}

export type ActivityComment = {
  comment_uuid: string
  author: CommentAuthor | null
  body: string
  mentions: number[]
  edited_at: string | null
  created_at: string
  deleted: boolean
}

export type CommentThread = {
  thread_uuid: string
  quote: string
  status: 'open' | 'resolved'
  created_by: CommentAuthor | null
  resolved_by: CommentAuthor | null
  resolved_at: string | null
  created_at: string
  updated_at: string
  comments: ActivityComment[]
}

export type CommentThreadList = {
  threads: CommentThread[]
  can_moderate: boolean
  current_user_id: number
}

export class CommentsApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const base = (activityUuid: string) =>
  `${getAPIUrl()}activities/${encodeURIComponent(activityUuid)}/comments`

// Comments are per language: while the editor edits a translation
// (`?lang=fr`, set by Editor/Translation/TranslationGate) every call carries
// `locale=`. Null = the source language.
let commentsLocale: string | null = null
export function setCommentsLocale(locale: string | null, onlyIf?: string) {
  // `onlyIf`: a page leaving clears only its own locale (the next one may be set already)
  if (onlyIf !== undefined && commentsLocale !== onlyIf) return
  commentsLocale = locale
}
const withLocale = (url: string) =>
  commentsLocale ? `${url}${url.includes('?') ? '&' : '?'}locale=${encodeURIComponent(commentsLocale)}` : url

async function call<T>(url: string, method: string, token: string, body?: unknown): Promise<T> {
  const res = await fetch(withLocale(url), {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
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
    throw new CommentsApiError(res.status, detail)
  }
  return (await res.json()) as T
}

export function listCommentThreads(activityUuid: string, token: string) {
  return call<CommentThreadList>(base(activityUuid), 'GET', token)
}

export function listMentionable(activityUuid: string, q: string, token: string) {
  return call<CommentAuthor[]>(`${base(activityUuid)}/mentionable?q=${encodeURIComponent(q)}`, 'GET', token)
}

export function createCommentThread(
  activityUuid: string,
  data: { quote: string; body: string; mentions: number[] },
  token: string
) {
  return call<CommentThread>(base(activityUuid), 'POST', token, data)
}

export function replyToThread(
  activityUuid: string,
  threadUuid: string,
  data: { body: string; mentions: number[] },
  token: string
) {
  return call<CommentThread>(`${base(activityUuid)}/${threadUuid}/replies`, 'POST', token, data)
}

export function editComment(
  activityUuid: string,
  threadUuid: string,
  commentUuid: string,
  data: { body: string; mentions: number[] },
  token: string
) {
  return call<CommentThread>(`${base(activityUuid)}/${threadUuid}/${commentUuid}`, 'PATCH', token, data)
}

export function deleteComment(activityUuid: string, threadUuid: string, commentUuid: string, token: string) {
  return call<CommentThread>(`${base(activityUuid)}/${threadUuid}/${commentUuid}`, 'DELETE', token)
}

export function setThreadStatus(
  activityUuid: string,
  threadUuid: string,
  status: 'open' | 'resolved',
  token: string
) {
  return call<CommentThread>(`${base(activityUuid)}/${threadUuid}`, 'PATCH', token, { status })
}
