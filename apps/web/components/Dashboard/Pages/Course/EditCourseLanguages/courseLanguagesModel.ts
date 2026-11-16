// Pure helpers behind the course editor's Languages tab and translation mode.
// No React, no Next, no fetch: unit tested in tests/course-languages-model.test.mjs.

/** The 22 languages the LearnHouse UI ships in; offered first when adding a language. */
export const UI_LOCALES = [
  'ar', 'bn', 'de', 'en', 'es', 'fa', 'fr', 'hi', 'id', 'it', 'ja',
  'ko', 'nl', 'pl', 'pt', 'ru', 'sk', 'th', 'tr', 'uk', 'vi', 'zh',
] as const

/**
 * Other codes the free search knows about (ISO 639-1 plus common regional and
 * script variants). Any other well-formed code typed by hand is offered too.
 */
export const OTHER_LOCALES = [
  'af', 'am', 'az', 'be', 'bg', 'bs', 'ca', 'cs', 'cy', 'da', 'el', 'eo', 'et', 'eu', 'fi', 'fil', 'ga', 'gl',
  'gu', 'ha', 'he', 'hr', 'hu', 'hy', 'ig', 'is', 'jv', 'ka', 'kk', 'km', 'kn', 'ku', 'ky', 'la', 'lb', 'lo',
  'lt', 'lv', 'mg', 'mi', 'mk', 'ml', 'mn', 'mr', 'ms', 'mt', 'my', 'ne', 'no', 'nb', 'pa', 'ps', 'ro', 'rw',
  'si', 'sl', 'so', 'sq', 'sr', 'sv', 'sw', 'ta', 'te', 'tg', 'tk', 'tl', 'ur', 'uz', 'xh', 'yo', 'zu',
  'pt-BR', 'pt-PT', 'es-419', 'es-MX', 'en-GB', 'en-US', 'fr-CA', 'zh-Hans', 'zh-Hant', 'zh-TW', 'de-CH',
] as const

export type ItemTranslationState = 'missing' | 'outdated' | 'translated'

/** Translation state of one outline item (chapter or activity). */
export function itemTranslationState(translation: { outdated?: boolean } | null | undefined): ItemTranslationState {
  if (!translation) return 'missing'
  return translation.outdated ? 'outdated' : 'translated'
}

export interface ProgressLike {
  activities_total: number
  activities_translated: number
  activities_outdated: number
  chapters_total?: number
  chapters_translated?: number
  course_translated?: boolean
}

/** "x/y pages translated" numbers, clamped, with a 0-100 percent. */
export function progressSummary(progress: ProgressLike | null | undefined) {
  const total = Math.max(0, progress?.activities_total ?? 0)
  const translated = Math.min(total, Math.max(0, progress?.activities_translated ?? 0))
  const outdated = Math.max(0, progress?.activities_outdated ?? 0)
  const percent = total === 0 ? (progress?.course_translated ? 100 : 0) : Math.round((translated / total) * 100)
  return { total, translated, outdated, percent }
}

export interface JobLike {
  locale: string
  state: string
  done: number
  total: number
}

/** Jobs still running, optionally for one locale. */
export function runningJobs<T extends JobLike>(jobs: T[] | null | undefined, locale?: string): T[] {
  return (jobs || []).filter((j) => j.state === 'running' && (!locale || j.locale === locale))
}

/** 0-100 progress of a job. */
export function jobPercent(job: JobLike): number {
  if (!job.total) return 0
  return Math.min(100, Math.round((job.done / job.total) * 100))
}

export interface LanguageOption {
  code: string
  /** Name in the UI language ("French"). */
  name: string
  /** Name in the language itself ("Français"). */
  native: string
  ui: boolean
}

/**
 * Locales for the "Add language" picker. UI locales first (in list order),
 * then the other known codes, then the typed code itself when it is a valid
 * code not listed. Locales already on the course (and the default) are left
 * out. `nameOf(code, display)` gives a language name (Intl.DisplayNames in
 * the app), `normalize` a canonical code or null.
 */
export function languageOptions(opts: {
  query: string
  exclude: readonly string[]
  displayLocale: string
  nameOf: (_code: string, _display: string) => string
  normalize: (_raw: string) => string | null
  limit?: number
}): LanguageOption[] {
  const exclude = new Set(opts.exclude.map((c) => c.toLowerCase()))
  const q = opts.query.trim().toLowerCase()
  const make = (code: string, ui: boolean): LanguageOption => ({
    code,
    name: opts.nameOf(code, opts.displayLocale),
    native: opts.nameOf(code, code),
    ui,
  })
  const matches = (o: LanguageOption) =>
    !q || o.code.toLowerCase().startsWith(q) || o.name.toLowerCase().includes(q) || o.native.toLowerCase().includes(q)

  const out: LanguageOption[] = []
  const seen = new Set<string>()
  const push = (o: LanguageOption) => {
    const key = o.code.toLowerCase()
    if (seen.has(key) || exclude.has(key) || !matches(o)) return
    seen.add(key)
    out.push(o)
  }
  UI_LOCALES.forEach((c) => push(make(c, true)))
  if (q) OTHER_LOCALES.forEach((c) => push(make(c, false)))
  if (q) {
    const typed = opts.normalize(opts.query)
    if (typed && !seen.has(typed.toLowerCase()) && !exclude.has(typed.toLowerCase())) {
      seen.add(typed.toLowerCase())
      out.push({ ...make(typed, false) })
    }
  }
  return out.slice(0, opts.limit ?? 60)
}

/** `href` with `lang` set (or removed when null), other params kept. */
export function withLangParam(href: string, lang: string | null | undefined): string {
  const hashAt = href.indexOf('#')
  const hash = hashAt >= 0 ? href.slice(hashAt) : ''
  const noHash = hashAt >= 0 ? href.slice(0, hashAt) : href
  const qAt = noHash.indexOf('?')
  const path = qAt >= 0 ? noHash.slice(0, qAt) : noHash
  const params = new URLSearchParams(qAt >= 0 ? noHash.slice(qAt + 1) : '')
  if (lang) params.set('lang', lang)
  else params.delete('lang')
  const qs = params.toString()
  return `${path}${qs ? `?${qs}` : ''}${hash}`
}

/**
 * The language the editor works in, from the `lang` URL param: only a
 * language the course has (and not the default one), else null (source).
 */
export function resolveEditingLocale(
  raw: string | null | undefined,
  languages: readonly string[] | null | undefined,
  defaultLocale: string | null | undefined,
  normalize: (_raw: string) => string | null,
): string | null {
  if (!raw) return null
  const code = normalize(raw)
  if (!code || code === defaultLocale) return null
  if (languages && !languages.includes(code)) return null
  return code
}

// ── Learnings (JSON list of { id, text, emoji, link? }) ─────────────────

export interface LearningItem {
  id: string
  text: string
  emoji?: string
  link?: string
}

export function parseLearningItems(value: string | null | undefined): LearningItem[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    if (Array.isArray(parsed)) {
      return parsed
        .filter((it) => it && typeof it === 'object')
        .map((it, i) => ({ ...it, id: typeof it.id === 'string' ? it.id : `l_${i}`, text: String(it.text ?? '') }))
    }
  } catch {
    // not JSON: one plain-text item
  }
  return [{ id: 'l_0', text: String(value) }]
}

/**
 * The translated learnings in the source's shape: each source item keeps its
 * id, emoji and link and takes the translated text (by id, else by position).
 */
export function mergeLearningTexts(source: LearningItem[], texts: Record<string, string>): string {
  return JSON.stringify(source.map((item) => ({ ...item, text: texts[item.id] ?? '' })))
}

/** Translated texts of a learnings value, keyed by the source item ids. */
export function learningTextsById(source: LearningItem[], translated: string | null | undefined): Record<string, string> {
  const items = parseLearningItems(translated)
  const byId = new Map(items.map((it) => [it.id, it.text]))
  const sourceIds = new Set(source.map((it) => it.id))
  const out: Record<string, string> = {}
  source.forEach((item, i) => {
    // Same id, else the item at the same position when its id is unknown
    const positional = items[i] && !sourceIds.has(items[i].id) ? items[i].text : undefined
    out[item.id] = byId.get(item.id) ?? positional ?? ''
  })
  return out
}

// ── SEO ──────────────────────────────────────────────────────────────────

/** SEO keys that hold text to translate (the rest are shared with the source). */
export const TRANSLATABLE_SEO_KEYS = [
  'title',
  'description',
  'keywords',
  'og_title',
  'og_description',
  'twitter_title',
  'twitter_description',
  'image_alt',
  'audience',
  'prerequisites',
] as const

export type TranslatableSeoKey = (typeof TRANSLATABLE_SEO_KEYS)[number]

/** Only the translatable SEO fields with a value (empty strings dropped). */
export function cleanTranslatedSeo(seo: Record<string, any> | null | undefined): Record<string, any> {
  const out: Record<string, any> = {}
  for (const key of TRANSLATABLE_SEO_KEYS) {
    const v = seo?.[key]
    if (typeof v === 'string' && v.trim()) out[key] = v
  }
  const faq = Array.isArray(seo?.faq) ? seo!.faq.filter((f: any) => f && (f.question?.trim() || f.answer?.trim())) : []
  if (faq.length) out.faq = faq.map((f: any) => ({ question: String(f.question ?? ''), answer: String(f.answer ?? '') }))
  return out
}
