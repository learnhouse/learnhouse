/**
 * Language versions of a course page for search engines (multilingual
 * courses). One URL per language: the default language at the plain URL,
 * every published translation at `?lang=xx`. Pure helpers for
 * `generateMetadata`, the JSON-LD slot and the sitemap.
 */
import { normalizeLocale } from '@services/courses/translations'

/** The default locale first, then published translations (deduplicated, normalized). */
export function courseLocaleList(defaultLocale?: string | null, available?: readonly (string | null | undefined)[] | null): string[] {
  const out = [normalizeLocale(defaultLocale) || 'en']
  for (const raw of available || []) {
    const locale = normalizeLocale(raw)
    if (locale && !out.includes(locale)) out.push(locale)
  }
  return out
}

/**
 * The translation a `?lang=` asks for, when it is a published one (not the
 * default). Matches exactly, then by base language (`fr-CA` → `fr`).
 */
export function publishedLocaleFor(
  requested: string | null | undefined,
  defaultLocale?: string | null,
  available?: readonly (string | null | undefined)[] | null,
): string | null {
  const want = normalizeLocale(requested)
  if (!want) return null
  const [def, ...translations] = courseLocaleList(defaultLocale, available)
  if (want === def) return null
  if (translations.includes(want)) return want
  const base = want.split('-')[0]
  if (def.split('-')[0] === base) return null
  return translations.find((l) => l.split('-')[0] === base) || null
}

/** `url` with `?lang=` set (or removed for null), keeping other params. */
export function withLangParam(url: string, locale: string | null | undefined): string {
  const [beforeHash, hash = ''] = url.split('#')
  const [path, query = ''] = beforeHash.split('?')
  const params = new URLSearchParams(query)
  if (locale) params.set('lang', locale)
  else params.delete('lang')
  const qs = params.toString()
  return `${path}${qs ? `?${qs}` : ''}${hash ? `#${hash}` : ''}`
}

/**
 * `alternates.languages` for Next metadata: one hreflang per language version
 * plus `x-default` (the plain URL). Undefined when there is no translation,
 * so single-language pages render exactly as before.
 */
export function languageAlternates(
  baseUrl: string,
  defaultLocale?: string | null,
  available?: readonly (string | null | undefined)[] | null,
): Record<string, string> | undefined {
  const locales = courseLocaleList(defaultLocale, available)
  if (locales.length < 2) return undefined
  const [def] = locales
  const out: Record<string, string> = {}
  for (const locale of locales) out[locale] = withLangParam(baseUrl, locale === def ? null : locale)
  out['x-default'] = withLangParam(baseUrl, null)
  return out
}

/** Sitemap `<xhtml:link rel="alternate">` entries (same set as the page's hreflang tags). */
export function sitemapLanguageLinks(
  baseUrl: string,
  defaultLocale?: string | null,
  available?: readonly (string | null | undefined)[] | null,
): { hreflang: string; href: string }[] {
  const map = languageAlternates(baseUrl, defaultLocale, available)
  return map ? Object.entries(map).map(([hreflang, href]) => ({ hreflang, href })) : []
}

/** Canonical URL of a language version: the plain URL for the default, `?lang=` otherwise. */
export function canonicalForLocale(baseUrl: string, served: string | null | undefined, defaultLocale?: string | null): string {
  const s = normalizeLocale(served)
  const d = normalizeLocale(defaultLocale) || 'en'
  return withLangParam(baseUrl, s && s !== d ? s : null)
}

export type CourseLanguageSeo = {
  /** The published translation being served, or null for the default language. */
  translation: string | null
  /** Language of the served version. */
  locale: string
  canonical: string
  /** hreflang map (undefined without translations). */
  languages?: Record<string, string>
  /** Other language versions (content locales), empty without translations. */
  alternateLocales: string[]
  /** Every language version, default first. */
  locales: string[]
}

/**
 * SEO language data of a course URL. A `?lang=` naming a published
 * translation (and actually served by the API) gets its own canonical
 * `?lang=xx`; anything else is the default version at the plain URL.
 */
export function courseLanguageSeo(opts: {
  baseUrl: string
  requested?: string | null
  /** `locale` of the course read fetched with `lang=<requested>`. */
  servedByApi?: string | null
  defaultLocale?: string | null
  available?: readonly (string | null | undefined)[] | null
}): CourseLanguageSeo {
  const locales = courseLocaleList(opts.defaultLocale, opts.available)
  const def = locales[0]
  const translation = opts.requested ? publishedLocaleFor(opts.servedByApi, def, opts.available) : null
  const locale = translation || def
  return {
    translation,
    locale,
    canonical: canonicalForLocale(opts.baseUrl, translation, def),
    languages: languageAlternates(opts.baseUrl, def, opts.available),
    alternateLocales: locales.length > 1 ? locales.filter((l) => l !== locale) : [],
    locales,
  }
}
