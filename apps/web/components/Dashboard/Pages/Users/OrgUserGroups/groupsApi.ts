'use client'
// Data layer for the user groups area (list, detail tabs, dialogs, the
// group space and "My groups"). Every call carries ?org_id= like the rest of
// the usergroups API (the plan gate reads it; the group id wins server-side).
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { getAPIUrl } from '@services/config/config'
import { detailMessage } from '@services/utils/ts/requests'

export type GroupKind = 'manual' | 'smart' | 'hybrid'
export type GroupFeatures = { smart: boolean; nesting: boolean; managers: boolean; space: boolean; messaging: boolean }
export type Person = {
  id: number
  user_uuid: string
  username: string
  first_name?: string | null
  last_name?: string | null
  avatar_image?: string | null
  email?: string | null
}
export type GroupListItem = {
  id: number
  usergroup_uuid: string
  name: string
  description: string
  kind: GroupKind
  types: string[]
  color: string | null
  parent_id: number | null
  parent_name: string | null
  member_count: number
  inherited_count: number
  resource_counts: Record<string, number>
  managers: Person[]
  active_codes: number
  space_enabled: boolean
  creation_date: string
}
export type Condition = { type: string; negate?: boolean; [k: string]: any }
export type Rules = { match: 'all' | 'any'; conditions: Condition[] }
export type GroupSettings = {
  space_enabled: boolean
  space_show_members: boolean
  notify_on_join: boolean
  notify_on_leave: boolean
  auto_join_domains: string[]
}
export type Capabilities = { role: 'admin' | 'manager' | 'none'; members: boolean; progress: boolean; post: boolean; admin: boolean }
export type GroupDetail = {
  id: number
  usergroup_uuid: string
  org_id: number
  name: string
  description: string
  kind: GroupKind
  rules: Rules
  types: string[]
  color: string | null
  parent: { id: number; usergroup_uuid: string; name: string } | null
  children: { id: number; usergroup_uuid: string; name: string }[]
  settings: GroupSettings
  member_count: number
  members_by_source: Record<string, number>
  pending_schedules: number
  managers: (Person & { can_manage_members: boolean; can_view_progress: boolean; can_post: boolean; digest: boolean })[]
  creation_date: string
  last_synced_at: string | null
  capabilities: Capabilities
  features: GroupFeatures
}

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export async function ugRequest<T = any>(
  method: string,
  path: string,
  orgId: number | undefined,
  token: string | undefined,
  body?: any
): Promise<T> {
  const sep = path.includes('?') ? '&' : '?'
  const res = await fetch(`${getAPIUrl()}usergroups/${path}${orgId ? `${sep}org_id=${orgId}` : ''}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    credentials: 'include',
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const isJson = (res.headers.get('content-type') || '').includes('application/json')
  const data = isJson ? await res.json().catch(() => null) : await res.text()
  if (!res.ok) throw new ApiError(detailMessage((data as any)?.detail, res.statusText || 'Request failed'), res.status)
  return data as T
}

export function useUG() {
  const org = useOrg() as any
  const session = useLHSession() as any
  const token: string | undefined = session?.data?.tokens?.access_token
  const orgId: number | undefined = org?.id
  const call = <T = any>(method: string, path: string, body?: any) => ugRequest<T>(method, path, orgId, token, body)
  return { org, orgId, token, call, ready: !!orgId && !!token }
}

export const ugKeys = {
  overview: (orgId?: number) => ['usergroups', 'v2', orgId, 'overview'] as const,
  detail: (id: number) => ['usergroups', 'v2', 'detail', id] as const,
  members: (id: number, q = '', source = '', page = 1) => ['usergroups', 'v2', 'members', id, q, source, page] as const,
  access: (id: number) => ['usergroups', 'v2', 'access', id] as const,
  codes: (id: number) => ['usergroups', 'v2', 'codes', id] as const,
  progress: (id: number) => ['usergroups', 'v2', 'progress', id] as const,
  history: (id: number, page = 1) => ['usergroups', 'v2', 'history', id, page] as const,
  announcements: (id: number) => ['usergroups', 'v2', 'announcements', id] as const,
  options: (orgId?: number) => ['usergroups', 'v2', orgId, 'rule-options'] as const,
  mine: (orgId?: number) => ['usergroups', 'v2', orgId, 'mine'] as const,
  memberGroups: (orgId: number | undefined, userId: number) => ['usergroups', 'v2', orgId, 'member', userId] as const,
}

export function useGroupsOverview() {
  const { orgId, call, ready } = useUG()
  return useQuery({
    queryKey: ugKeys.overview(orgId),
    queryFn: () => call<{ items: GroupListItem[]; features: GroupFeatures; can_admin: boolean }>('GET', `org/${orgId}/overview`),
    enabled: ready,
    staleTime: 30_000,
  })
}

export function useGroupDetail(id: number | null) {
  const { call, ready } = useUG()
  return useQuery({
    queryKey: ugKeys.detail(id ?? 0),
    queryFn: () => call<GroupDetail>('GET', `${id}/detail`),
    enabled: ready && !!id,
    staleTime: 15_000,
  })
}

export function useRuleOptions(enabled = true) {
  const { orgId, call, ready } = useUG()
  return useQuery({
    queryKey: ugKeys.options(orgId),
    queryFn: () => call<any>('GET', `org/${orgId}/rules/options`),
    enabled: ready && enabled,
    staleTime: 120_000,
  })
}

/** Refresh everything that shows groups after a change. */
export function useInvalidateGroups() {
  const qc = useQueryClient()
  return (id?: number) => {
    qc.invalidateQueries({ queryKey: ['usergroups'] })
    qc.invalidateQueries({ queryKey: ['org'] })
    if (id) qc.invalidateQueries({ queryKey: ugKeys.detail(id) })
  }
}

export function personName(p?: Partial<Person> | null): string {
  if (!p) return ''
  const full = [p.first_name, p.last_name].filter(Boolean).join(' ').trim()
  return full || p.username || ''
}

// Group colors: a flat tile tint and its icon color (kept to the kit's hues).
export const GROUP_COLORS: Record<string, { tile: string; dot: string }> = {
  violet: { tile: 'bg-violet-50 text-violet-600', dot: 'bg-violet-500' },
  sky: { tile: 'bg-sky-50 text-sky-600', dot: 'bg-sky-500' },
  emerald: { tile: 'bg-emerald-50 text-emerald-600', dot: 'bg-emerald-500' },
  amber: { tile: 'bg-amber-50 text-amber-600', dot: 'bg-amber-500' },
  rose: { tile: 'bg-rose-50 text-rose-600', dot: 'bg-rose-500' },
  indigo: { tile: 'bg-indigo-50 text-indigo-600', dot: 'bg-indigo-500' },
  teal: { tile: 'bg-teal-50 text-teal-600', dot: 'bg-teal-500' },
  orange: { tile: 'bg-orange-50 text-orange-600', dot: 'bg-orange-500' },
}
export const groupTile = (color?: string | null, kind?: GroupKind) =>
  GROUP_COLORS[color || '']?.tile ?? (kind && kind !== 'manual' ? 'bg-violet-50 text-violet-600' : 'bg-sky-50 text-sky-600')

/** yyyy-mm-dd for <input type="date"> from an ISO string. */
export const dateInput = (iso?: string | null) => (iso ? iso.slice(0, 10) : '')
export const formatDate = (iso: string | null | undefined, locale: string) => {
  if (!iso) return ''
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '' : new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(d)
}
