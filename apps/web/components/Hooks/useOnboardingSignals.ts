'use client'
import { useQuery } from '@tanstack/react-query'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { dashCoursesQuery } from '@/lib/query/dashQueries'

/**
 * What the launch plan needs beyond the checklist itself: the course the admin
 * most recently edited, so "Add content" opens it directly. Which steps are
 * done now comes from the server (GET /onboarding/orgs/{id}), which reads the
 * org's data in one request instead of five from the browser (one of which,
 * communities, a free plan refused).
 */
export function useOnboardingSignals(enabled = true) {
  const org = useOrg() as any
  const session = useLHSession() as any
  const token = session?.data?.tokens?.access_token
  const orgslug = org?.slug
  const on = enabled && !!token && !!orgslug

  // The dashboard's own course list (same entry as home and the courses page).
  const courses = useQuery({ ...dashCoursesQuery(orgslug, token), enabled: on, staleTime: 15_000 })
  const courseList: any[] = Array.isArray(courses.data) ? courses.data : []
  const latest = [...courseList].sort((a, b) => String(b.update_date).localeCompare(String(a.update_date)))[0]

  return {
    ready: courses.isFetched,
    latestCourseUuid: (latest?.course_uuid as string | undefined) ?? null,
  }
}
