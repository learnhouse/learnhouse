/**
 * Which language a learner reads a course in (multilingual courses).
 *
 * Order: an explicit choice (`?lang=` in the URL, the `?lang=` seen earlier in
 * this tab, then the language picked in the course language switcher), the UI
 * language, the browser languages. The API serves the first published
 * translation that matches and falls back to the course default, so the list
 * only expresses preferences. Pure: the hook in hooks/useContentLanguage.ts
 * feeds it from the URL, storage, i18next and `navigator`.
 */
import { CONTENT_LANG_STORAGE_KEY, contentLanguagePreferences, normalizeLocale } from '@services/courses/translations'

/** Tab-scoped copy of a `?lang=` the visitor arrived with (survives in-app navigation). */
export const CONTENT_LANG_SESSION_KEY = `${CONTENT_LANG_STORAGE_KEY}:url`

/** First valid locale of a `?lang=` value (`fr`, `fr,en`, `pt_br`), else null. */
export function parseLangParam(raw?: string | string[] | null): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw
  if (!value) return null
  for (const part of String(value).split(',')) {
    const locale = normalizeLocale(part)
    if (locale) return locale
  }
  return null
}

/** localStorage keys of the remembered choice, most specific first (per user, then global). */
export function contentLangStorageKeys(userId?: string | number | null): string[] {
  return userId != null && userId !== '' ? [`${CONTENT_LANG_STORAGE_KEY}:${userId}`, CONTENT_LANG_STORAGE_KEY] : [CONTENT_LANG_STORAGE_KEY]
}

/** The learner's preference list, most preferred first. */
export function resolveContentLanguagePrefs(opts: {
  urlLang?: string | null
  sessionLang?: string | null
  storedLang?: string | null
  uiLanguage?: string | null
  browser?: readonly string[] | null
}): string[] {
  const explicit = parseLangParam(opts.urlLang) || parseLangParam(opts.sessionLang) || parseLangParam(opts.storedLang)
  return contentLanguagePreferences({ explicit, uiLanguage: opts.uiLanguage, browser: opts.browser })
}

/** The `lang=` query value for a preference list ('' when empty). */
export function langParam(prefs: readonly string[]): string {
  return prefs.join(',')
}

/** Default locale of a course read (`default_locale`, else the fallback, else `en`). */
export function courseDefaultLocale(course: any, fallback?: string | null): string {
  return normalizeLocale(course?.default_locale) || normalizeLocale(fallback) || 'en'
}

/**
 * Every language a learner can read the course in: the default first, then the
 * published translations. Just the default when there are none.
 */
export function courseLocales(course: any, fallback?: string | null): string[] {
  const out = [courseDefaultLocale(course, fallback)]
  for (const raw of Array.isArray(course?.available_locales) ? course.available_locales : []) {
    const locale = normalizeLocale(raw)
    if (locale && !out.includes(locale)) out.push(locale)
  }
  return out
}

/** True when the course has at least one published translation (show the switcher). */
export function hasTranslations(course: any): boolean {
  return courseLocales(course).length > 1
}

/** The language a course read is served in (`locale`, else its default). */
export function servedLocale(item: any, fallback?: string | null): string {
  return normalizeLocale(item?.locale) || courseDefaultLocale(item, fallback)
}

/**
 * The activity shows the original because its translation isn't published,
 * while the course is served in another language.
 */
export function showsTranslationFallback(activity: any, course: any): boolean {
  if (!activity?.translation_fallback || !course) return false
  return servedLocale(course) !== courseDefaultLocale(course)
}

/** `cookie` string remembering the choice for a year (read by nothing secret). */
export function contentLangCookie(locale: string | null): string {
  const value = locale ? encodeURIComponent(locale) : ''
  const maxAge = locale ? 60 * 60 * 24 * 365 : 0
  return `${CONTENT_LANG_STORAGE_KEY}=${value}; path=/; max-age=${maxAge}; SameSite=Lax`
}
