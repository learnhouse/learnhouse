import type { QueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { getAllOrgCourses } from '@services/courses/courses'
import { getAssignmentsFromACourse } from '@services/courses/assignments'
import { getOrgPaths } from '@services/paths/paths'
import { getBoards } from '@ee/services/boards/boards'
import { getCommunities } from '@services/communities/communities'
import { getOrgPodcasts } from '@services/podcasts/podcasts'
import { asArray } from '@services/utils/ts/requests'

// Query options for the dashboard's main lists, shared by the pages that read
// them and by the sidebar, which warms them on hover. Same key + same fetcher
// in both places, so a prefetch is exactly the entry the page then reads.

export type DashQueryCtx = {
  orgslug?: string
  orgId?: number
  token?: string
}

// Every course incl. drafts, as the dashboard lists them.
export const dashCoursesQuery = (orgslug: string, token?: string) => ({
  queryKey: queryKeys.courses.dashAll(orgslug),
  queryFn: () => getAllOrgCourses(orgslug, token),
  staleTime: 60_000,
})

// One course's assignments. There is no org-wide endpoint, so the assignments
// page asks once per course; the sidebar's "recent assignments" menu reads the
// same entries. A failed or non-array answer collapses to [] so one bad course
// never takes the whole list down.
export const courseAssignmentsQuery = (courseUuid: string, token?: string) => ({
  queryKey: queryKeys.assignments.byCourse(courseUuid),
  queryFn: async (): Promise<any[]> => {
    try {
      const res: any = await getAssignmentsFromACourse(courseUuid, token as string)
      return res?.success && Array.isArray(res.data) ? res.data : []
    } catch {
      return []
    }
  },
  staleTime: 60_000,
})

export const dashPathsQuery = (orgId: number, token?: string) => ({
  queryKey: queryKeys.paths.list(orgId),
  queryFn: () => getOrgPaths(orgId, token),
  staleTime: 30_000,
})

export const dashBoardsQuery = (orgslug: string, orgId: number, token: string) => ({
  queryKey: queryKeys.boards.list(orgslug),
  queryFn: () => getBoards(orgId, token),
  staleTime: 60_000,
})

export const dashCommunitiesQuery = (orgId: number, token?: string) => ({
  queryKey: queryKeys.community.list(orgId),
  queryFn: () => getCommunities(orgId, 1, 100, null, token),
  staleTime: 30_000,
})

export const dashPodcastsQuery = (orgslug: string, token?: string) => ({
  queryKey: queryKeys.podcasts.dashList(orgslug),
  queryFn: async () => asArray<any>(await getOrgPodcasts(orgslug, null, token, true)),
  staleTime: 30_000,
})

// Strip the org prefix (subdomain or /orgs/<slug>) so a dashboard href can be
// matched whatever form the link was built in.
function dashPath(href: string): string {
  const path = href.replace(/^https?:\/\/[^/]+/, '').split(/[?#]/)[0]
  const i = path.indexOf('/dash')
  return i === -1 ? path : path.slice(i).replace(/\/$/, '') || '/dash'
}

const MAX_ASSIGNMENT_PREFETCH_COURSES = 40

/**
 * Warm the data a dashboard page reads first, before the user lands on it.
 * prefetchQuery skips anything still fresh, so hovering back and forth costs
 * nothing once the cache is warm.
 */
export function prefetchDashData(queryClient: QueryClient, href: string, ctx: DashQueryCtx) {
  const { orgslug, orgId, token } = ctx
  if (!token || !orgslug) return
  const path = dashPath(href)
  switch (path) {
    case '/dash':
    case '/dash/courses':
      queryClient.prefetchQuery(dashCoursesQuery(orgslug, token))
      break
    case '/dash/assignments':
      // The page asks per course, so the course list comes first. A large
      // org would turn one hover into a burst of requests; there the page
      // loads its assignments itself.
      queryClient
        .ensureQueryData(dashCoursesQuery(orgslug, token))
        .then((courses: any) => {
          const list = asArray<any>(courses)
          if (list.length > MAX_ASSIGNMENT_PREFETCH_COURSES) return
          list.forEach((c) => {
            if (c?.course_uuid) queryClient.prefetchQuery(courseAssignmentsQuery(c.course_uuid, token))
          })
        })
        .catch(() => {})
      break
    case '/dash/paths':
      if (orgId) queryClient.prefetchQuery(dashPathsQuery(orgId, token))
      break
    case '/dash/boards':
      if (orgId) queryClient.prefetchQuery(dashBoardsQuery(orgslug, orgId, token))
      break
    case '/dash/communities':
      if (orgId) queryClient.prefetchQuery(dashCommunitiesQuery(orgId, token))
      break
    case '/dash/podcasts':
      queryClient.prefetchQuery(dashPodcastsQuery(orgslug, token))
      break
  }
}
