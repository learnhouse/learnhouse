'use client'
import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getCourseTranslation,
  updateCourseTranslation,
  type CourseFields,
  type CourseTranslation,
} from '@services/courses/translations'
import { courseLanguagesKey, courseTranslationKey, useAccessToken } from './useCourseLanguages'

/** One course language version (texts + source) and its save. */
export function useCourseTranslation(courseUuid: string | undefined, locale: string) {
  const token = useAccessToken()
  const queryClient = useQueryClient()
  const key = courseTranslationKey(courseUuid || '', locale)
  const query = useQuery<CourseTranslation>({
    queryKey: key,
    queryFn: () => getCourseTranslation(courseUuid!, locale, token),
    enabled: !!courseUuid && !!token,
    retry: false,
    refetchOnWindowFocus: false,
  })
  const save = useCallback(
    async (patch: Partial<CourseFields> & { slug?: string | null }) => {
      const saved = await updateCourseTranslation(courseUuid!, locale, patch, token)
      queryClient.setQueryData(key, saved)
      queryClient.invalidateQueries({ queryKey: courseLanguagesKey(courseUuid || '') })
      return saved
    },
    // key is derived from courseUuid + locale
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [courseUuid, locale, token, queryClient],
  )
  return { ...query, save }
}
