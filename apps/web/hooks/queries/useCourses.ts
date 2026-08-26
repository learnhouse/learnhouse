'use client'

import { useQuery } from '@tanstack/react-query'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { queryKeys } from '@lib/query/keys'
import { getOrgCourses, getCourseMetadata } from '@services/courses/courses'

type CourseListItem = {
  course_uuid: string
  name: string
  [key: string]: any
}

function serviceCourseUuid(courseUuid: string) {
  if (!courseUuid) return ''
  return courseUuid.startsWith('course_') ? courseUuid.slice('course_'.length) : courseUuid
}

export function useCourses(orgSlug: string) {
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token as string | undefined

  return useQuery<CourseListItem[]>({
    queryKey: queryKeys.courses.list(orgSlug),
    queryFn: async () => (await getOrgCourses(orgSlug, {}, accessToken)) as CourseListItem[],
    enabled: !!orgSlug,
    staleTime: 60_000,
  })
}

export function useCourseMeta(courseUuid: string) {
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token as string | undefined
  const serviceUuid = serviceCourseUuid(courseUuid)

  return useQuery({
    queryKey: queryKeys.courses.meta(serviceUuid),
    queryFn: () => getCourseMetadata(serviceUuid, {}, accessToken, { slim: true }),
    enabled: !!serviceUuid,
    staleTime: 60_000,
  })
}
