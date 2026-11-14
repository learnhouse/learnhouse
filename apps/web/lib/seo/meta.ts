/**
 * Shared pieces of `generateMetadata` for public pages: robots, social image,
 * locale and verification tags. Safe to import from server and client code.
 */
import type { Metadata } from 'next'
import { getOrgOgImageMediaDirectory } from '@services/media/media'

export type OrgSeoConfig = {
  default_meta_title_suffix?: string
  default_title_template?: string
  default_meta_description?: string
  default_og_image?: string
  google_site_verification?: string
  bing_site_verification?: string
  yandex_verification?: string
  pinterest_verification?: string
  twitter_handle?: string
  noindex_communities?: boolean
  indexing_disabled?: boolean
  robots_extra_rules?: string
  organization_type?: string
}

export type ResourceSeo = {
  title?: string | null
  description?: string | null
  keywords?: string | null
  canonical_url?: string | null
  og_title?: string | null
  og_description?: string | null
  og_image?: string | null
  og_type?: string | null
  twitter_card?: 'summary' | 'summary_large_image' | string | null
  twitter_title?: string | null
  twitter_description?: string | null
  robots_noindex?: boolean
  robots_nofollow?: boolean
  enable_jsonld?: boolean
  image_alt?: string | null
  faq?: { question: string; answer: string }[]
  educational_level?: 'beginner' | 'intermediate' | 'advanced' | null
  in_language?: string | null
  workload_minutes?: number | null
  prerequisites?: string | null
  audience?: string | null
}

/**
 * A resource's social image: an absolute URL as-is, or the file name of an
 * image uploaded through the SEO settings (stored with the org OG images).
 */
export function seoImageUrl(orgUuid: string | undefined, value?: string | null): string | undefined {
  if (!value) return undefined
  if (/^https?:\/\//i.test(value)) return value
  if (!orgUuid || value.includes('/')) return undefined
  return getOrgOgImageMediaDirectory(orgUuid, value)
}

/** `robots` metadata from the org switch, the resource settings and visibility. */
export function robotsMetadata(opts: {
  orgSeo?: OrgSeoConfig
  seo?: ResourceSeo | null
  /** false for private/unpublished/members-only pages: never indexed. */
  indexable?: boolean
}): NonNullable<Metadata['robots']> {
  const index = opts.indexable !== false && !opts.orgSeo?.indexing_disabled && !opts.seo?.robots_noindex
  const follow = !opts.orgSeo?.indexing_disabled && !opts.seo?.robots_nofollow
  return {
    index,
    follow,
    googleBot: {
      index,
      follow,
      'max-image-preview': 'large',
      'max-snippet': -1,
      'max-video-preview': -1,
    },
  }
}

/** The org's content language (BCP 47 primary tag), `en` when unset. */
export function orgLanguage(org: any): string {
  const lang =
    org?.config?.config?.customization?.general?.default_language || org?.config?.config?.general?.default_language || 'en'
  return String(lang).split(/[-_]/)[0].toLowerCase() || 'en'
}

const OG_LOCALES: Record<string, string> = {
  en: 'en_US', fr: 'fr_FR', de: 'de_DE', es: 'es_ES', it: 'it_IT', pt: 'pt_BR', nl: 'nl_NL', pl: 'pl_PL',
  ru: 'ru_RU', uk: 'uk_UA', tr: 'tr_TR', ar: 'ar_AR', fa: 'fa_IR', hi: 'hi_IN', bn: 'bn_IN', id: 'id_ID',
  ja: 'ja_JP', ko: 'ko_KR', zh: 'zh_CN', th: 'th_TH', vi: 'vi_VN', sk: 'sk_SK', he: 'he_IL',
}

/**
 * Open Graph locale (`fr_FR`) for a language code. Full locales keep their
 * region (`pt-BR` → `pt_BR`); script subtags map to the usual region
 * (`zh-Hant` → `zh_TW`).
 */
export function ogLocale(lang: string): string {
  const [rawBase, sub] = String(lang || 'en').replace(/_/g, '-').split('-')
  const base = rawBase.toLowerCase()
  if (sub && /^[a-zA-Z]{2}$/.test(sub)) return `${base}_${sub.toUpperCase()}`
  if (base === 'zh' && sub?.toLowerCase() === 'hant') return 'zh_TW'
  if (sub === '419') return `${base}_LA`
  return OG_LOCALES[base] || `${base}_${base.toUpperCase()}`
}

/** Search engine site verification tags (home page). */
export function verificationMetadata(seo: OrgSeoConfig): Metadata['verification'] | undefined {
  const other: Record<string, string> = {}
  if (seo.bing_site_verification) other['msvalidate.01'] = seo.bing_site_verification
  if (seo.pinterest_verification) other['p:domain_verify'] = seo.pinterest_verification
  const v = {
    ...(seo.google_site_verification ? { google: seo.google_site_verification } : {}),
    ...(seo.yandex_verification ? { yandex: seo.yandex_verification } : {}),
    ...(Object.keys(other).length ? { other } : {}),
  }
  return Object.keys(v).length ? v : undefined
}

/** Keywords string → list (Next renders `keywords` from an array). */
export function keywordList(value?: string | string[] | null): string[] | undefined {
  if (!value) return undefined
  const list = (Array.isArray(value) ? value : String(value).split(','))
    .map((k) => String(k).trim())
    .filter(Boolean)
  return list.length ? list : undefined
}

/** Course "learnings" are stored as a JSON list of strings or {text} objects. */
export function parseLearnings(value: unknown): string[] {
  let list: unknown = value
  if (typeof value === 'string') {
    try {
      list = JSON.parse(value)
    } catch {
      list = value.split('\n')
    }
  }
  if (!Array.isArray(list)) return []
  return list
    .map((l: any) => (typeof l === 'string' ? l : l?.text))
    .filter((t: any): t is string => typeof t === 'string' && t.trim() !== '' && t !== 'null')
    .map((t) => t.trim())
}

/** Meta description clipped to ~160 characters on a word boundary. */
export function clipDescription(text?: string | null, max = 160): string {
  const plain = String(text || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  if (plain.length <= max) return plain
  const cut = plain.slice(0, max - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, '')}…`
}

/** Plain text of a ProseMirror/Tiptap JSON document (or a JSON string of one). */
export function prosemirrorText(doc: unknown, max = 2000): string {
  let node: any = doc
  if (typeof doc === 'string') {
    try {
      node = JSON.parse(doc)
    } catch {
      return doc.slice(0, max)
    }
  }
  const parts: string[] = []
  let length = 0
  const walk = (n: any) => {
    if (!n || length > max) return
    if (n.type === 'text' && typeof n.text === 'string') {
      parts.push(n.text)
      length += n.text.length
    }
    if (Array.isArray(n.content)) {
      for (const child of n.content) walk(child)
      if (['paragraph', 'heading', 'listItem', 'blockquote'].includes(n.type)) parts.push(' ')
    }
  }
  walk(node)
  return parts.join('').replace(/\s+/g, ' ').trim().slice(0, max)
}
