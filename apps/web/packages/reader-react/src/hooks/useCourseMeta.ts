'use client'

import { useQuery } from '@tanstack/react-query'
import { useReaderConfig } from '../Reader/ReaderProvider'
import { fetchCourseMeta } from '../services/api'
import type { CourseStructure } from '../types/activity'

export function useCourseMeta(courseUuid: string) {
  const { baseApiUrl, accessToken } = useReaderConfig()
  return useQuery<CourseStructure>({
    queryKey: ['lh-reader', 'course-meta', courseUuid, !!accessToken],
    queryFn: () => fetchCourseMeta(baseApiUrl, courseUuid, accessToken, true),
    enabled: !!courseUuid,
    staleTime: 60_000,
  })
}
