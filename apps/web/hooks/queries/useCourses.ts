'use client'

import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { queryKeys } from '@lib/query/keys'
import { getOrgCourses, getCourseMetadata } from '@services/courses/courses'

// The catalog (published courses the viewer can see). Shared with the nav
// prefetch so a warmed list lands under the same key. `lang` = the learner's
// content language list (localized names), `language` = a language filter.
export function coursesQueryOptions(orgSlug: string, accessToken?: string, i18n?: { lang?: string; language?: string }) {
  const lang = i18n?.lang || undefined
  const language = i18n?.language || undefined
  return {
    queryKey: queryKeys.courses.catalog(orgSlug, lang, language),
    queryFn: () => getOrgCourses(orgSlug, {}, accessToken, false, lang || language ? { lang, language } : undefined),
    staleTime: 60_000,
  }
}

export function useCourses(orgSlug: string, opts?: { lang?: string; language?: string; enabled?: boolean }) {
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token as string | undefined

  return useQuery({
    ...coursesQueryOptions(orgSlug, accessToken, opts),
    enabled: !!orgSlug && opts?.enabled !== false,
  })
}

// Same cache entry as the course page (CourseClient) for a given `lang`.
export function courseMetaQueryOptions(courseUuid: string, accessToken?: string, lang?: string) {
  return {
    queryKey: queryKeys.courses.meta(courseUuid, lang || undefined),
    queryFn: () => getCourseMetadata(courseUuid, {}, accessToken, { slim: true, lang: lang || undefined }),
    staleTime: 60_000,
  }
}

export function useCourseMeta(courseUuid: string, opts?: { lang?: string; enabled?: boolean }) {
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token as string | undefined

  return useQuery({
    ...courseMetaQueryOptions(courseUuid, accessToken, opts?.lang),
    enabled: !!courseUuid && opts?.enabled !== false,
    // Switching the content language keeps the page up while the other version loads.
    placeholderData: opts?.lang ? keepPreviousData : undefined,
  })
}
