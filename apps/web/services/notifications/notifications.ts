import { getAPIUrl } from '@services/config/config'

/* ------------------------------------------------------------------------ */
/* Types (mirror apps/api/src/services/notifications)                        */
/* ------------------------------------------------------------------------ */

export const PERSONAL_CATEGORIES = [
  'messages',
  'assignments',
  'courses',
  'live',
  'community',
  'groups',
  'billing',
  'boards',
] as const
export const ADMIN_CATEGORIES = ['teaching', 'people', 'integrations', 'newsletter', 'plan', 'automation'] as const

export type PersonalCategory = (typeof PERSONAL_CATEGORIES)[number]
export type AdminCategory = (typeof ADMIN_CATEGORIES)[number]
export type NotificationCategory = PersonalCategory | AdminCategory
export type NotificationAudience = 'personal' | 'admin'
export type NotificationChannel = 'in_app' | 'email' | 'push'
export type EmailDigest = 'off' | 'daily' | 'weekly'

export type NotificationActor = {
  id: number
  user_uuid: string
  username: string
  name: string
  avatar_image: string | null
}

export type NotificationItem = {
  notification_uuid: string
  org_id: number | null
  type: string
  category: NotificationCategory
  title: string
  body: string
  data: Record<string, any>
  image: string | null
  count: number
  read: boolean
  read_at: string | null
  created_at: string
  audience: NotificationAudience
  priority: 'normal' | 'important'
  important: boolean
  actor: NotificationActor | null
  archived: boolean
  archived_at: string | null
  expires_at: string | null
  path: string | null
}

export type UnreadCounts = {
  unread_count: number
  unread_by_category: Partial<Record<NotificationCategory, number>>
  unread_important: number
}

export type NotificationPage = UnreadCounts & {
  items: NotificationItem[]
  next_cursor: string | null
}

export type BothCounts = { personal: UnreadCounts; admin: UnreadCounts }

export type NotificationPreferences = {
  push_enabled: boolean
  push_categories: Record<NotificationCategory, boolean>
  channels: Record<NotificationCategory, Record<NotificationChannel, boolean>>
  email_digest: EmailDigest
  categories: { key: NotificationCategory; audience: NotificationAudience }[]
}

export type RoleGroup = 'admins' | 'maintainers' | 'course_authors'

export type OrgRouting = {
  org_id: number
  role_groups: RoleGroup[]
  types: Record<string, { category: AdminCategory; priority: 'normal' | 'important'; roles: RoleGroup[]; default_roles: RoleGroup[] }>
}

export type BulkAction = 'read' | 'unread' | 'archive' | 'unarchive' | 'delete'

export type ListParams = {
  org_id?: number
  audience?: NotificationAudience
  unread_only?: boolean
  category?: NotificationCategory | null
  archived?: boolean
  important?: boolean
  q?: string
  cursor?: string | null
  limit?: number
}

export type StreamEvent =
  | { type: 'hello'; counts: BothCounts }
  | { type: 'notification.new'; org_id: number | null; audience: NotificationAudience; item: NotificationItem }
  | { type: 'notification.changed'; org_id: number | null }
  | { type: 'error'; message: string }

/* ------------------------------------------------------------------------ */
/* Calls                                                                    */
/* ------------------------------------------------------------------------ */

export class NotificationsError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function call<T>(path: string, token: string, init: { method?: string; body?: any } = {}): Promise<T> {
  const res = await fetch(`${getAPIUrl()}notifications${path}`, {
    method: init.method || 'GET',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    credentials: 'include',
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    const detail = typeof data?.detail === 'string' ? data.detail : data?.detail?.message
    throw new NotificationsError(detail || `Request failed (${res.status})`, res.status)
  }
  return res.json()
}

export const query = (params: Record<string, string | number | boolean | undefined | null>) =>
  Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== false)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&')

export const listNotifications = (p: ListParams, token: string) =>
  call<NotificationPage>(
    `?${query({
      org_id: p.org_id,
      audience: p.audience || 'personal',
      unread_only: p.unread_only,
      category: p.category,
      archived: p.archived,
      important: p.important,
      q: p.q?.trim(),
      cursor: p.cursor,
      limit: p.limit ?? 30,
    })}`,
    token
  )

export const getCounts = (orgId: number | undefined, token: string) =>
  call<BothCounts>(`/counts?${query({ org_id: orgId })}`, token)

export const markRead = (
  token: string,
  body: { notification_uuids?: string[]; all?: boolean; org_id?: number; category?: NotificationCategory | null; audience?: NotificationAudience }
) => call<UnreadCounts & { marked: number }>(`/read`, token, { method: 'POST', body: { audience: 'personal', ...body } })

export const bulkAction = (
  token: string,
  body: {
    action: BulkAction
    notification_uuids?: string[]
    all?: boolean
    org_id?: number
    category?: NotificationCategory | null
    audience?: NotificationAudience
  }
) => call<UnreadCounts & { changed?: number; marked?: number }>(`/bulk`, token, { method: 'POST', body: { audience: 'personal', ...body } })

export const getPreferences = (token: string) => call<NotificationPreferences>(`/preferences`, token)

export const updatePreferences = (
  token: string,
  body: {
    push_enabled?: boolean
    channels?: Partial<Record<NotificationCategory, Partial<Record<NotificationChannel, boolean>>>>
    email_digest?: EmailDigest
  }
) => call<NotificationPreferences>(`/preferences`, token, { method: 'PUT', body })

export const getOrgRouting = (orgId: number, token: string) => call<OrgRouting>(`/org/${orgId}/routing`, token)

export const updateOrgRouting = (orgId: number, routing: Record<string, RoleGroup[]>, token: string) =>
  call<OrgRouting>(`/org/${orgId}/routing`, token, { method: 'PUT', body: { routing } })

/**
 * Open the SSE stream with fetch (EventSource can't send the bearer token).
 * Resolves when the stream ends; abort the signal to close it.
 */
export async function openNotificationStream(
  orgId: number | undefined,
  token: string,
  onEvent: (_event: StreamEvent) => void,
  signal: AbortSignal
): Promise<void> {
  const res = await fetch(`${getAPIUrl()}notifications/stream?${query({ org_id: orgId })}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
    credentials: 'include',
    signal,
  })
  if (!res.ok || !res.body) throw new NotificationsError(`Stream failed (${res.status})`, res.status)
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const frames = buffer.split('\n\n')
    buffer = frames.pop() || ''
    for (const frame of frames) {
      for (const line of frame.split('\n')) {
        if (!line.startsWith('data: ')) continue
        try {
          onEvent(JSON.parse(line.slice(6)))
        } catch {
          // A malformed frame shouldn't take the stream down.
        }
      }
    }
  }
}
