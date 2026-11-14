import { getAPIUrl } from '@services/config/config'
import { RequestBodyWithAuthHeader, errorHandling } from '@services/utils/ts/requests'

/*
 Course language versions (multilingual courses). One course, many languages:
 the translations live next to the course and only replace texts. See the
 API's src/routers/courses/translations.py.

 Course uuids are the full `course_…` ids, activity uuids the full `activity_…`.
*/

export type TranslationStatus = 'draft' | 'published'
export type TranslatedBy = 'user' | 'atlas' | null

export interface LanguageProgress {
  activities_total: number
  activities_translated: number
  activities_published: number
  activities_outdated: number
  chapters_total: number
  chapters_translated: number
  course_translated: boolean
  course_outdated: boolean
}

export interface CourseLanguage {
  locale: string
  status: TranslationStatus
  translated_by: TranslatedBy
  name: string | null
  updated_at: string | null
  progress: LanguageProgress
}

export interface TranslationJob {
  job_id: string
  locale: string
  state: 'running' | 'done' | 'failed'
  done: number
  total: number
  failed: number
  label: string
  updated_at: number
}

export interface CourseLanguagesOverview {
  course_uuid: string
  default_locale: string
  languages: CourseLanguage[]
  jobs: TranslationJob[]
  rtl_locales: string[]
}

export interface CourseFields {
  name: string | null
  description: string | null
  about: string | null
  learnings: string | null
  tags: string | null
  seo: Record<string, any> | null
}

export interface CourseTranslation extends CourseFields {
  locale: string
  status: TranslationStatus
  translated_by: TranslatedBy
  slug: string | null
  outdated: boolean
  updated_at: string | null
  source: CourseFields
}

export interface OutlineActivityTranslation {
  name: string
  status: TranslationStatus
  translated_by: TranslatedBy
  source_version: number | null
  current_source_version: number
  outdated: boolean
  updated_at: string | null
}

export interface OutlineActivity {
  activity_uuid: string
  activity_type: string
  activity_sub_type: string
  name: string
  translatable: boolean
  translation: OutlineActivityTranslation | null
}

export interface OutlineChapter {
  chapter_uuid: string
  source: { name: string; description: string | null }
  translation: { name: string; description: string | null; status: TranslationStatus; outdated: boolean } | null
  activities: OutlineActivity[]
}

export interface TranslationOutline {
  locale: string
  course: { translated: boolean; outdated: boolean }
  chapters: OutlineChapter[]
}

export interface ActivityTranslation {
  activity_uuid: string
  locale: string
  exists: boolean
  name: string
  content: Record<string, any> | null
  extra: Record<string, any> | null
  status: TranslationStatus
  translated_by: TranslatedBy
  version: number
  source_version: number | null
  current_source_version: number
  outdated: boolean
  updated_at: string | null
  updated_by: string | null
  source?: { name: string; content: Record<string, any> | null }
}

export interface Glossary {
  do_not_translate: string[]
  terms: { source: string; translations: Record<string, string> }[]
  notes: string
}

export const RTL_LOCALES = ['ar', 'fa', 'he', 'ur']

/** True for right-to-left languages (`ar`, `fa-IR`, ...). */
export function isRtlLocale(locale?: string | null): boolean {
  if (!locale) return false
  return RTL_LOCALES.includes(locale.split('-')[0].toLowerCase())
}

/** Normalized locale code: `pt_br` -> `pt-BR`, `ZH-hans` -> `zh-Hans`. */
export function normalizeLocale(raw?: string | null): string | null {
  if (!raw) return null
  const parts = raw.trim().replace(/_/g, '-').split('-').filter(Boolean)
  if (!parts.length || !/^[a-zA-Z]{2,3}$/.test(parts[0])) return null
  const out = [parts[0].toLowerCase()]
  for (const p of parts.slice(1, 3)) {
    if (/^[a-zA-Z]{2}$/.test(p)) out.push(p.toUpperCase())
    else if (/^[a-zA-Z]{4}$/.test(p)) out.push(p[0].toUpperCase() + p.slice(1).toLowerCase())
    else if (/^\d{3}$/.test(p)) out.push(p)
    else break
  }
  return out.join('-')
}

/** Human name of a locale in `displayLocale` (falls back to the code). */
export function localeName(locale: string, displayLocale = 'en'): string {
  try {
    const dn = new Intl.DisplayNames([displayLocale], { type: 'language' })
    return dn.of(locale) || locale
  } catch {
    return locale
  }
}

/** Name of a locale in its own language ("Français"). */
export function localeNativeName(locale: string): string {
  const name = localeName(locale, locale)
  return name.charAt(0).toLocaleUpperCase(locale) + name.slice(1)
}

const base = () => getAPIUrl()

async function call<T = any>(method: string, path: string, body: any, token?: string | null): Promise<T> {
  const res = await fetch(`${base()}${path}`, RequestBodyWithAuthHeader(method, body, null, token || undefined))
  return errorHandling(res)
}

const enc = encodeURIComponent

// ── Languages ────────────────────────────────────────────────────────────

export const courseLanguagesUrl = (courseUuid: string) => `${base()}courses/${courseUuid}/languages`

export function getCourseLanguages(courseUuid: string, token?: string | null) {
  return call<CourseLanguagesOverview>('GET', `courses/${courseUuid}/languages`, null, token)
}

export function addCourseLanguage(courseUuid: string, locale: string, token?: string | null) {
  return call<CourseLanguage>('POST', `courses/${courseUuid}/languages`, { locale }, token)
}

export function removeCourseLanguage(courseUuid: string, locale: string, token?: string | null) {
  return call('DELETE', `courses/${courseUuid}/languages/${enc(locale)}`, null, token)
}

export function setCourseLanguageStatus(
  courseUuid: string,
  locale: string,
  status: TranslationStatus,
  token?: string | null,
  includeItems = true,
) {
  return call<CourseLanguage>('PUT', `courses/${courseUuid}/languages/${enc(locale)}/status`, { status, include_items: includeItems }, token)
}

export function setCourseDefaultLocale(courseUuid: string, locale: string, token?: string | null) {
  return call<{ default_locale: string }>('PUT', `courses/${courseUuid}/default-locale`, { locale }, token)
}

export function getTranslationGlossary(courseUuid: string, token?: string | null) {
  return call<Glossary>('GET', `courses/${courseUuid}/translation-glossary`, null, token)
}

export function updateTranslationGlossary(courseUuid: string, glossary: Glossary, token?: string | null) {
  return call<Glossary>('PUT', `courses/${courseUuid}/translation-glossary`, glossary, token)
}

export function getPublicCourseLanguages(courseUuid: string, next?: any, token?: string | null) {
  return fetch(`${base()}courses/${courseUuid}/languages/public`, RequestBodyWithAuthHeader('GET', null, next, token || undefined)).then(
    errorHandling,
  ) as Promise<{ default_locale: string; locales: { locale: string; name: string; slug: string | null }[] }>
}

// ── Course fields & outline ──────────────────────────────────────────────

export const courseTranslationUrl = (courseUuid: string, locale: string) => `${base()}courses/${courseUuid}/translations/${enc(locale)}`
export const translationOutlineUrl = (courseUuid: string, locale: string) =>
  `${base()}courses/${courseUuid}/translations/${enc(locale)}/outline`

export function getCourseTranslation(courseUuid: string, locale: string, token?: string | null) {
  return call<CourseTranslation>('GET', `courses/${courseUuid}/translations/${enc(locale)}`, null, token)
}

export function updateCourseTranslation(
  courseUuid: string,
  locale: string,
  data: Partial<CourseFields> & { slug?: string | null },
  token?: string | null,
) {
  return call<CourseTranslation>('PUT', `courses/${courseUuid}/translations/${enc(locale)}`, data, token)
}

export function getTranslationOutline(courseUuid: string, locale: string, token?: string | null) {
  return call<TranslationOutline>('GET', `courses/${courseUuid}/translations/${enc(locale)}/outline`, null, token)
}

export function updateChapterTranslation(
  courseUuid: string,
  locale: string,
  chapterUuid: string,
  data: { name?: string; description?: string; status?: TranslationStatus },
  token?: string | null,
) {
  return call('PUT', `courses/${courseUuid}/translations/${enc(locale)}/chapters/${chapterUuid}`, data, token)
}

// ── Activity translations ────────────────────────────────────────────────

export const activityTranslationUrl = (activityUuid: string, locale: string, includeSource = false) =>
  `${base()}activities/${activityUuid}/translations/${enc(locale)}${includeSource ? '?include_source=true' : ''}`

export function listActivityTranslations(activityUuid: string, token?: string | null) {
  return call<{ locale: string; status: TranslationStatus; outdated: boolean; translated_by: TranslatedBy; updated_at: string | null }[]>(
    'GET',
    `activities/${activityUuid}/translations`,
    null,
    token,
  )
}

export function getActivityTranslation(activityUuid: string, locale: string, token?: string | null, includeSource = false) {
  return call<ActivityTranslation>(
    'GET',
    `activities/${activityUuid}/translations/${enc(locale)}${includeSource ? '?include_source=true' : ''}`,
    null,
    token,
  )
}

export function updateActivityTranslation(
  activityUuid: string,
  locale: string,
  data: { name?: string; content?: Record<string, any>; extra?: Record<string, any>; base_version?: number; status?: TranslationStatus },
  token?: string | null,
) {
  return call<ActivityTranslation>('PUT', `activities/${activityUuid}/translations/${enc(locale)}`, data, token)
}

export function seedActivityTranslation(activityUuid: string, locale: string, from: 'source' | 'empty' = 'source', token?: string | null) {
  return call<ActivityTranslation>('POST', `activities/${activityUuid}/translations/${enc(locale)}/seed`, { from }, token)
}

export function setActivityTranslationStatus(activityUuid: string, locale: string, status: TranslationStatus, token?: string | null) {
  return call<ActivityTranslation>('PUT', `activities/${activityUuid}/translations/${enc(locale)}/status`, { status }, token)
}

export function deleteActivityTranslation(activityUuid: string, locale: string, token?: string | null) {
  return call('DELETE', `activities/${activityUuid}/translations/${enc(locale)}`, null, token)
}

// ── Learner side ─────────────────────────────────────────────────────────

/**
 * The preference list sent as `lang=` (most preferred first): explicit
 * choice, then the UI language, then the browser languages. The API serves
 * the first published one and falls back to the course default.
 */
export function contentLanguagePreferences(opts: {
  explicit?: string | null
  uiLanguage?: string | null
  browser?: readonly string[] | null
}): string[] {
  const out: string[] = []
  const add = (v?: string | null) => {
    const n = normalizeLocale(v)
    if (n && !out.includes(n)) out.push(n)
  }
  add(opts.explicit)
  add(opts.uiLanguage)
  for (const b of opts.browser || []) add(b)
  return out.slice(0, 8)
}

export const CONTENT_LANG_STORAGE_KEY = 'lh_content_lang'
