'use client'
import React from 'react'
import { useSearchParams } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@components/Contexts/AuthContext'
import { getActivityTranslation, normalizeLocale, type ActivityTranslation } from '@services/courses/translations'
import { setCommentsLocale } from '@services/courses/activityComments'
import { useCourseLanguages } from '@components/Dashboard/Pages/Course/EditCourseLanguages/useCourseLanguages'
import { EditorLocaleContext, type EditorLocaleValue } from './EditorLocaleContext'
import TranslationStartScreen, { TranslationUnavailable } from './TranslationStartScreen'

export const activityTranslationKey = (activityUuid: string, locale: string) =>
  ['courseI18n', 'activityTranslation', activityUuid, locale] as const

/** The language the activity editor works in (`?lang=fr`), null = source. */
export function useEditorLocaleParam(): string | null {
  const raw = useSearchParams()?.get('lang')
  return raw ? normalizeLocale(raw) : null
}

export interface TranslationOverride {
  /** The activity with the translation's version/name (base_version of saves). */
  activity: any
  content: any
}

/**
 * Between the editor bootstrap and the editor: in a translation (`?lang=`),
 * loads it (with the source), offers to start it when it doesn't exist yet,
 * then renders the editor on the translation's content inside
 * EditorLocaleContext. Without a locale it renders the editor as is.
 */
export default function TranslationGate({
  locale,
  activity,
  course,
  onReady,
  children,
}: {
  locale: string | null
  activity: any
  course: any
  onReady: () => void
  children: (_override: TranslationOverride | null) => React.ReactNode
}) {
  if (!locale) return <>{children(null)}</>
  return (
    <LocaleGate key={locale} locale={locale} activity={activity} course={course} onReady={onReady}>
      {children}
    </LocaleGate>
  )
}

function LocaleGate({
  locale,
  activity,
  course,
  onReady,
  children,
}: {
  locale: string
  activity: any
  course: any
  onReady: () => void
  children: (_override: TranslationOverride | null) => React.ReactNode
}) {
  const { accessToken } = useAuth()
  const queryClient = useQueryClient()
  const activityUuid: string = activity.activity_uuid
  const key = activityTranslationKey(activityUuid, locale)
  const { data: languages } = useCourseLanguages(course?.course_uuid)

  // Comments are per language: every comment call of this page carries it.
  // Set during render so the first thread fetch already has it.
  React.useMemo(() => setCommentsLocale(locale), [locale])
  React.useEffect(() => () => setCommentsLocale(null, locale), [locale])

  const { data, error, refetch } = useQuery<ActivityTranslation>({
    queryKey: key,
    queryFn: () => getActivityTranslation(activityUuid, locale, accessToken, true),
    enabled: !!accessToken,
    retry: false,
    staleTime: 30_000,
    // The editor owns the content once open (same as the bootstrap)
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })

  const showsScreen = !!error || (!!data && !data.exists)
  React.useEffect(() => {
    if (showsScreen) onReady()
  }, [showsScreen, onReady])

  const value = React.useMemo<EditorLocaleValue | null>(
    () =>
      data && data.exists
        ? { locale, sourceLocale: languages?.default_locale || 'en', translation: data, refresh: () => refetch() }
        : null,
    [data, locale, languages?.default_locale, refetch],
  )
  // Only the first loaded translation feeds the editor: later refetches
  // (name, status) must not reset the content it owns.
  const [override, setOverride] = React.useState<TranslationOverride | null>(null)
  if (data?.exists && !override) {
    setOverride({
      activity: { ...activity, current_version: data.version || 1 },
      content: data.content || { type: 'doc', content: [{ type: 'paragraph' }] },
    })
  }

  if (error) return <TranslationUnavailable locale={locale} status={(error as any)?.status} />
  if (!data) return null
  if (!data.exists) {
    return (
      <TranslationStartScreen
        locale={locale}
        activity={activity}
        course={course}
        translation={data}
        onStarted={(t) => queryClient.setQueryData(key, t)}
        onAtlasDone={() => refetch()}
      />
    )
  }
  if (!override || !value) return null
  return <EditorLocaleContext.Provider value={value}>{children(override)}</EditorLocaleContext.Provider>
}
