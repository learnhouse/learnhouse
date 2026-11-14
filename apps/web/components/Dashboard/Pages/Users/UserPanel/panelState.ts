'use client'
import { useSearchParams } from 'next/navigation'
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { queryKeys } from '@/lib/query/keys'
import { getMemberActivity, getMemberAssignments, getMemberSummary } from '@services/organizations/memberPanel'
import { getAPIUrl } from '@services/config/config'
import { apiFetch } from '@services/utils/ts/requests'
import { neighboursInIds, scanForNeighbours, type MembersPage, type Neighbours } from './neighbours'

// The open member lives in the URL (`?user=<id>&utab=<tab>`), written with the
// History API (state `null`: passing Next's own state marks the entry as
// internal and useSearchParams would not see it): Next keeps useSearchParams in sync without a server round trip,
// and only the panel (the one reader) re-renders, never the members table.
// Opening pushes an entry, so Back closes the panel; stepping between members
// and switching tabs replace it.

export const PANEL_TABS = ['overview', 'learning', 'assignments', 'activity', 'analytics', 'security'] as const
export type PanelTab = (typeof PANEL_TABS)[number]
export const USER_PARAM = 'user'
export const TAB_PARAM = 'utab'

// Whether this page load pushed the entry the panel is showing, so closing can
// pop it (Back-like) instead of leaving a dead history step behind.
let pushedByUs = false

function withParams(mutate: (_p: URLSearchParams) => void): string {
  const url = new URL(window.location.href)
  mutate(url.searchParams)
  return `${url.pathname}${url.search}${url.hash}`
}

export function openUserPanel(userId: number, tab?: PanelTab) {
  const current = new URLSearchParams(window.location.search).get(USER_PARAM)
  const href = withParams((p) => {
    p.set(USER_PARAM, String(userId))
    if (tab && tab !== 'overview') p.set(TAB_PARAM, tab)
    else if (!current || tab === 'overview') p.delete(TAB_PARAM)
  })
  if (current) {
    window.history.replaceState(null, '', href)
  } else {
    window.history.pushState(null, '', href)
    pushedByUs = true
  }
}

export function setUserPanelTab(tab: PanelTab) {
  const href = withParams((p) => (tab === 'overview' ? p.delete(TAB_PARAM) : p.set(TAB_PARAM, tab)))
  window.history.replaceState(null, '', href)
}

export function closeUserPanel() {
  if (pushedByUs) {
    pushedByUs = false
    window.history.back()
    return
  }
  const href = withParams((p) => {
    p.delete(USER_PARAM)
    p.delete(TAB_PARAM)
  })
  window.history.replaceState(null, '', href)
}

/** Back/forward lands on whatever entry it lands on: forget our push. */
export function forgetPanelPush() {
  pushedByUs = false
}

export function useUserPanelParams(): { userId: number | null; tab: PanelTab } {
  const params = useSearchParams()
  const raw = Number(params?.get(USER_PARAM))
  const userId = Number.isInteger(raw) && raw > 0 ? raw : null
  const tabParam = params?.get(TAB_PARAM) as PanelTab | null
  const tab = tabParam && (PANEL_TABS as readonly string[]).includes(tabParam) ? tabParam : 'overview'
  return { userId, tab }
}

// ---- queries ----
// Under the org users key, so every member mutation on the page refreshes them.

export const memberKey = (orgId: number, userId: number, part: string) =>
  [...queryKeys.org.users(orgId), 'member', userId, part] as const

const STALE = 30_000

export function usePanelAuth() {
  const org = useOrg() as any
  const session = useLHSession() as any
  return { orgId: org?.id as number | undefined, token: session?.data?.tokens?.access_token as string | undefined }
}

export function useMemberSummary(userId: number | null) {
  const { orgId, token } = usePanelAuth()
  return useQuery({
    queryKey: memberKey(orgId ?? 0, userId ?? 0, 'summary'),
    queryFn: () => getMemberSummary(orgId!, userId!, token!),
    enabled: !!orgId && !!token && !!userId,
    staleTime: STALE,
  })
}

export function useMemberAssignments(userId: number, enabled = true) {
  const { orgId, token } = usePanelAuth()
  return useQuery({
    queryKey: memberKey(orgId ?? 0, userId, 'assignments'),
    queryFn: () => getMemberAssignments(orgId!, userId, token!),
    enabled: enabled && !!orgId && !!token,
    staleTime: STALE,
  })
}

export function useMemberActivity(userId: number, page: number, pageSize: number) {
  const { orgId, token } = usePanelAuth()
  return useQuery({
    queryKey: memberKey(orgId ?? 0, userId, `activity:${page}`),
    queryFn: () => getMemberActivity(orgId!, userId, token!, page * pageSize, pageSize),
    enabled: !!orgId && !!token,
    staleTime: STALE,
    placeholderData: (prev) => prev,
  })
}

/** Warm the summary when the pointer rests on a row, so opening is instant. */
export function prefetchMemberSummary(queryClient: QueryClient, orgId: number | undefined, token: string | undefined, userId: number) {
  if (!orgId || !token) return
  queryClient.prefetchQuery({
    queryKey: memberKey(orgId, userId, 'summary'),
    queryFn: () => getMemberSummary(orgId, userId, token),
    staleTime: STALE,
  })
}

export function useInvalidateMember() {
  const queryClient = useQueryClient()
  const { orgId } = usePanelAuth()
  return () => queryClient.invalidateQueries({ queryKey: queryKeys.org.users(orgId ?? 0) })
}

/**
 * Previous / next member for j/k, walking the list with the table's own
 * filters and sort (`listQuery`, its query string without page/limit), so it
 * works for a member who is not on the loaded page (deep link, search) and
 * across page edges. `null` while that lookup runs; `total: 0` means the
 * answer came from the loaded page alone.
 */
export function useMemberNeighbours(userId: number, pageIds: number[], listQuery: string | null): Neighbours | null {
  const { orgId, token } = usePanelAuth()
  const queryClient = useQueryClient()
  const local = neighboursInIds(pageIds, userId)
  const { data } = useQuery({
    queryKey: [...queryKeys.org.users(orgId ?? 0), 'neighbours', listQuery, userId],
    queryFn: () =>
      scanForNeighbours(
        (page, limit) =>
          queryClient.fetchQuery({
            queryKey: [...queryKeys.org.users(orgId ?? 0), 'scan', listQuery, page, limit],
            queryFn: () =>
              apiFetch(`${getAPIUrl()}orgs/${orgId}/users?${listQuery ? `${listQuery}&` : ''}page=${page}&limit=${limit}`, token) as Promise<MembersPage>,
            staleTime: STALE,
          }),
        userId
      ),
    enabled: listQuery != null && !!orgId && !!token,
    staleTime: STALE,
  })
  // The walk gives list-wide positions and crosses the table's page edges;
  // the loaded page answers instantly meanwhile (without a position).
  if (data?.status === 'found') return data
  if (local) return { ...local, total: 0 }
  if (listQuery == null) return { status: 'outside' }
  return data ?? null
}
