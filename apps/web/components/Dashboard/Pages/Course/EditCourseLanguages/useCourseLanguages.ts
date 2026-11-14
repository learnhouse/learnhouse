'use client'
import { useCallback, useMemo } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getCourseLanguages, normalizeLocale, type CourseLanguagesOverview } from '@services/courses/translations'
import { resolveEditingLocale, runningJobs, withLangParam } from './courseLanguagesModel'

export const courseLanguagesKey = (courseUuid: string) => ['courseI18n', 'languages', courseUuid] as const
export const courseTranslationKey = (courseUuid: string, locale: string) => ['courseI18n', 'translation', courseUuid, locale] as const
export const translationOutlineKey = (courseUuid: string, locale: string) => ['courseI18n', 'outline', courseUuid, locale] as const

const POLL_MS = 3000

export function useAccessToken(): string | undefined {
  const session = useLHSession() as any
  return session?.data?.tokens?.access_token
}

/**
 * The course's language versions and running translation jobs. Polls every
 * 3 s while a job runs. `missing` = the API has no translations routes (or
 * the course can't be read): callers then hide the feature.
 */
export function useCourseLanguages(courseUuid: string | null | undefined) {
  const token = useAccessToken()
  const query = useQuery<CourseLanguagesOverview>({
    queryKey: courseLanguagesKey(courseUuid || ''),
    queryFn: () => getCourseLanguages(courseUuid!, token),
    enabled: !!courseUuid && !!token,
    staleTime: 10_000,
    retry: (count, err: any) => err?.status !== 404 && err?.status !== 403 && count < 2,
    refetchInterval: (q) => (runningJobs(q.state.data?.jobs).length ? POLL_MS : false),
  })
  const queryClient = useQueryClient()
  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ['courseI18n'], predicate: (q) => q.queryKey.includes(courseUuid || '') }),
    [queryClient, courseUuid],
  )
  return { ...query, refresh }
}

/**
 * The language the course editor works in (`?lang=fr`), null = the source
 * language. Only languages the course has count once they are loaded.
 */
export function useEditingLocale(courseUuid: string | null | undefined) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const raw = searchParams?.get('lang') ?? null
  const { data } = useCourseLanguages(raw ? courseUuid : null)
  const locale = useMemo(
    () =>
      resolveEditingLocale(
        raw,
        data ? data.languages.map((l) => l.locale) : null,
        data?.default_locale ?? null,
        (v) => normalizeLocale(v),
      ),
    [raw, data],
  )
  const setLocale = useCallback(
    (next: string | null) => {
      const current = `${pathname}${searchParams?.toString() ? `?${searchParams.toString()}` : ''}`
      router.replace(withLangParam(current, next), { scroll: false })
    },
    [pathname, router, searchParams],
  )
  return { locale, rawLocale: raw, setLocale, overview: data ?? null }
}
