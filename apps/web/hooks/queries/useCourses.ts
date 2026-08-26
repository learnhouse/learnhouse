'use client'

import { useQuery } from '@tanstack/react-query'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { queryKeys } from '@lib/query/keys'
import { getOrgCourses, getCourseMetadata } from '@services/courses/courses'

function normalizeCourseUuid(courseUuid: string) {
  if (!courseUuid) return ''
  return courseUuid.startsWith('course_') ? courseUuid : `course_${courseUuid}`
}

export function useCourses(orgSlug: string) {
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token as string | undefined

  return useQuery<any[]>({
    queryKey: queryKeys.courses.list(orgSlug),
    queryFn: async () => (await getOrgCourses(orgSlug, {}, accessToken)) as any[],
    enabled: !!orgSlug,
    staleTime: 60_000,
  })
}

export function useCourseMeta(courseUuid: string) {
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token as string | undefined
  const normalizedUuid = normalizeCourseUuid(courseUuid)

  return useQuery({
    queryKey: queryKeys.courses.meta(normalizedUuid),
    queryFn: () => getCourseMetadata(normalizedUuid, {}, accessToken, { slim: true }),
    enabled: !!normalizedUuid,
    staleTime: 60_000,
  })
}
