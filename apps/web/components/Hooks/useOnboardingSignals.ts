'use client'
import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getAPIUrl } from '@services/config/config'
import { apiFetch } from '@services/utils/ts/requests'
import { getOrgCourses } from '@services/courses/courses'
import { getCommunities } from '@services/communities/communities'

// Short stale time: the onboarding page refetches on focus, so a step done in
// another tab ticks off when the admin comes back.
const STALE = 15_000

/**
 * Which onboarding steps the org's real data already satisfies. A step is done
 * when the thing exists (a course, a lesson, a logo, a member or invite, a
 * community), not when its settings page was opened. `ready` is false until
 * every query has answered once, so a slow request never reads as "not done".
 */
export function useOnboardingSignals(enabled = true) {
  const org = useOrg() as any
  const session = useLHSession() as any
  const token = session?.data?.tokens?.access_token
  const orgId = org?.id
  const orgslug = org?.slug
  const on = enabled && !!token && !!orgId && !!orgslug

  const courses = useQuery({
    queryKey: [...queryKeys.courses.list(orgslug), 'onboarding'],
    queryFn: () => getOrgCourses(orgslug, null, token, true),
    enabled: on,
    staleTime: STALE,
  })
  const courseList: any[] = Array.isArray(courses.data) ? courses.data : []

  // Lessons live inside course meta; the three most recently edited courses are
  // where a first lesson would be.
  const recent = [...courseList]
    .sort((a, b) => String(b.update_date).localeCompare(String(a.update_date)))
    .slice(0, 3)
    .map((c) => c.course_uuid as string)
  const content = useQuery({
    queryKey: ['onboarding', 'content', ...recent],
    queryFn: async () => {
      for (const uuid of recent) {
        const meta: any = await apiFetch(
          `${getAPIUrl()}courses/${uuid}/meta?with_unpublished_activities=true&slim=true`,
          token
        ).catch(() => null)
        if (meta?.chapters?.some((ch: any) => ch?.activities?.length > 0)) return true
      }
      return false
    },
    enabled: on && courses.isSuccess,
    staleTime: STALE,
  })

  const members = useQuery({
    queryKey: [...queryKeys.org.users(orgId), 'onboarding'],
    queryFn: () => apiFetch(`${getAPIUrl()}orgs/${orgId}/users?page=1&limit=1`, token),
    enabled: on,
    staleTime: STALE,
  })
  const invites = useQuery({
    queryKey: ['org', orgId, 'invites', 'onboarding'],
    queryFn: () => apiFetch(`${getAPIUrl()}orgs/${orgId}/invites/users`, token).catch(() => []),
    enabled: on,
    staleTime: STALE,
  })
  const communities = useQuery({
    queryKey: [...queryKeys.community.list(orgId), 'onboarding'],
    queryFn: () => getCommunities(orgId, 1, 5, null, token).catch(() => []),
    enabled: on,
    staleTime: STALE,
  })

  const inviteCount = Array.isArray(invites.data) ? invites.data.length : 0
  const done = {
    create_course: courseList.length > 0,
    add_content: content.data === true,
    brand_school: !!org?.logo_image,
    invite_learners: (members.data?.total ?? 0) > 1 || inviteCount > 0,
    build_community: Array.isArray(communities.data) && communities.data.length > 0,
  }
  const ready =
    courses.isFetched &&
    (content.isFetched || courseList.length === 0) &&
    members.isFetched &&
    invites.isFetched &&
    communities.isFetched

  return {
    ready,
    done: Object.entries(done)
      .filter(([, v]) => v)
      .map(([k]) => k),
    // Something the admin can link to straight away on the add-content step.
    latestCourseUuid: recent[0] ?? null,
  }
}
