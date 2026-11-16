'use client'
import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getAPIUrl } from '@services/config/config'
import { apiFetch } from '@services/utils/ts/requests'
import { getAllOrgCourses } from '@services/courses/courses'

// The home page reads courses and members from more than one card. Each card
// calls these hooks so they share one request (and, for courses, the same
// cache entry the courses page uses, so opening it after home is instant).

export function useHomeCourses() {
  const org = useOrg() as any
  const session = useLHSession() as any
  const token = session?.data?.tokens?.access_token
  const orgslug = org?.slug
  return useQuery<any[]>({
    queryKey: queryKeys.courses.dashAll(orgslug),
    queryFn: () => getAllOrgCourses(orgslug, token),
    enabled: !!token && !!orgslug,
    staleTime: 60_000,
  })
}

export const RECENT_MEMBERS_LIMIT = 6

export function useHomeMembers() {
  const org = useOrg() as any
  const session = useLHSession() as any
  const token = session?.data?.tokens?.access_token
  const orgId = org?.id
  return useQuery<{ items?: any[]; total?: number }>({
    queryKey: [...queryKeys.org.users(orgId), 1, 'recent', RECENT_MEMBERS_LIMIT],
    queryFn: () =>
      apiFetch(`${getAPIUrl()}orgs/${orgId}/users?page=1&limit=${RECENT_MEMBERS_LIMIT}&sort_order=desc`, token),
    enabled: !!token && !!orgId,
    staleTime: 60_000,
  })
}
