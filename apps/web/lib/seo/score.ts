/**
 * SEO checklist + score for one resource. Used live in the editor and, over
 * every resource, by the org SEO health report, so both always agree.
 */
import { UUID_LIKE_RE } from './slugify'
import type { SeoResourceType } from './paths'

export type SeoCheckLevel = 'pass' | 'warn' | 'fail' | 'info'
export type SeoCheck = {
  id: string
  level: SeoCheckLevel
  /** Weight in the score; info checks weigh 0. */
  weight: number
  /** i18n key suffix under `seo.checks.*` and values for interpolation. */
  params?: Record<string, string | number>
}

export type SeoFacts = {
  type: SeoResourceType
  name: string
  slug?: string | null
  description?: string | null
  /** Long-form text on the page (course "about", path "about", ...). */
  body?: string | null
  hasImage: boolean
  seo: {
    title?: string | null
    description?: string | null
    keywords?: string | null
    canonical_url?: string | null
    og_image?: string | null
    image_alt?: string | null
    robots_noindex?: boolean
    faq?: { question: string; answer: string }[]
  }
  /** Characters the org appends to every title (" | Academy"). */
  titleSuffixLength?: number
  /** Course only. */
  learnings?: number
  chapters?: number
  /** Whether the resource is public (+ published): only then can it rank. */
  isPublic?: boolean
}

export const TITLE_RANGE = { min: 30, max: 60 }
export const DESCRIPTION_RANGE = { min: 70, max: 160 }

export function wordCount(text?: string | null): number {
  if (!text) return 0
  const plain = String(text).replace(/<[^>]*>/g, ' ').trim()
  return plain ? plain.split(/\s+/).length : 0
}

export function effectiveTitle(f: SeoFacts): string {
  return (f.seo.title || f.name || '').trim()
}

export function effectiveDescription(f: SeoFacts): string {
  return (f.seo.description || f.description || '').trim()
}

export function seoChecks(f: SeoFacts): SeoCheck[] {
  const checks: SeoCheck[] = []
  const title = effectiveTitle(f)
  const fullTitle = title.length + (f.titleSuffixLength ?? 0)
  if (!title) checks.push({ id: 'title_missing', level: 'fail', weight: 3 })
  else if (fullTitle > TITLE_RANGE.max) checks.push({ id: 'title_long', level: 'warn', weight: 3, params: { count: fullTitle, max: TITLE_RANGE.max } })
  else if (fullTitle < TITLE_RANGE.min) checks.push({ id: 'title_short', level: 'warn', weight: 3, params: { count: fullTitle, min: TITLE_RANGE.min } })
  else checks.push({ id: 'title_ok', level: 'pass', weight: 3, params: { count: fullTitle } })

  const description = effectiveDescription(f)
  if (!description) checks.push({ id: 'description_missing', level: 'fail', weight: 3 })
  else if (description.length > DESCRIPTION_RANGE.max) checks.push({ id: 'description_long', level: 'warn', weight: 3, params: { count: description.length, max: DESCRIPTION_RANGE.max } })
  else if (description.length < DESCRIPTION_RANGE.min) checks.push({ id: 'description_short', level: 'warn', weight: 3, params: { count: description.length, min: DESCRIPTION_RANGE.min } })
  else checks.push({ id: 'description_ok', level: 'pass', weight: 3, params: { count: description.length } })

  const slug = f.slug || ''
  const slugWords = slug ? slug.split('-').length : 0
  if (!slug || UUID_LIKE_RE.test(slug)) checks.push({ id: 'slug_missing', level: 'fail', weight: 2 })
  else if (slug.length > 60 || slugWords > 8) checks.push({ id: 'slug_long', level: 'warn', weight: 2, params: { count: slug.length } })
  else if (/-\d+$/.test(slug) && !/\d/.test(f.name)) checks.push({ id: 'slug_numbered', level: 'warn', weight: 2 })
  else checks.push({ id: 'slug_ok', level: 'pass', weight: 2 })

  const hasImage = f.hasImage || !!f.seo.og_image
  checks.push(hasImage ? { id: 'image_ok', level: 'pass', weight: 2 } : { id: 'image_missing', level: 'warn', weight: 2 })
  if (f.hasImage) {
    checks.push(f.seo.image_alt?.trim() ? { id: 'alt_ok', level: 'pass', weight: 1 } : { id: 'alt_missing', level: 'warn', weight: 1 })
  }

  const keyword = (f.seo.keywords || '').split(',')[0]?.trim().toLowerCase()
  if (keyword) {
    const inTitle = title.toLowerCase().includes(keyword)
    const inDescription = description.toLowerCase().includes(keyword)
    checks.push(
      inTitle && inDescription
        ? { id: 'keyword_ok', level: 'pass', weight: 1, params: { keyword } }
        : { id: inTitle ? 'keyword_not_in_description' : 'keyword_not_in_title', level: 'warn', weight: 1, params: { keyword } },
    )
  }

  if (f.type === 'course') {
    const words = wordCount(f.body) + wordCount(f.description)
    checks.push(
      words >= 150
        ? { id: 'content_ok', level: 'pass', weight: 2, params: { count: words } }
        : { id: 'content_thin', level: 'warn', weight: 2, params: { count: words, min: 150 } },
    )
    const learnings = f.learnings ?? 0
    checks.push(learnings >= 3 ? { id: 'learnings_ok', level: 'pass', weight: 1, params: { count: learnings } } : { id: 'learnings_short', level: 'warn', weight: 1, params: { count: learnings } })
    if (f.chapters != null) {
      checks.push(f.chapters > 0 ? { id: 'syllabus_ok', level: 'pass', weight: 1, params: { count: f.chapters } } : { id: 'syllabus_empty', level: 'warn', weight: 1 })
    }
    checks.push((f.seo.faq || []).length > 0 ? { id: 'faq_ok', level: 'pass', weight: 0 } : { id: 'faq_missing', level: 'info', weight: 0 })
  }

  if (f.seo.robots_noindex) checks.push({ id: 'noindex', level: 'fail', weight: 4 })
  if (f.isPublic === false) checks.push({ id: 'not_public', level: 'info', weight: 0 })
  if (f.seo.canonical_url) checks.push({ id: 'canonical_elsewhere', level: 'info', weight: 0 })
  return checks
}

/** 0-100. Passing checks count fully, warnings half, failures nothing. */
export function seoScore(checks: SeoCheck[]): number {
  const total = checks.reduce((s, c) => s + c.weight, 0)
  if (!total) return 100
  const got = checks.reduce((s, c) => s + (c.level === 'pass' ? c.weight : c.level === 'warn' ? c.weight / 2 : 0), 0)
  return Math.round((got / total) * 100)
}

export function scoreGrade(score: number): 'good' | 'ok' | 'poor' {
  return score >= 80 ? 'good' : score >= 50 ? 'ok' : 'poor'
}

/** Resources sharing the same effective title (case-insensitive), keyed by uuid. */
export function duplicateTitles(items: { uuid: string; title: string }[]): Set<string> {
  const byTitle = new Map<string, string[]>()
  for (const item of items) {
    const key = item.title.trim().toLowerCase()
    if (!key) continue
    byTitle.set(key, [...(byTitle.get(key) || []), item.uuid])
  }
  const dupes = new Set<string>()
  for (const uuids of byTitle.values()) if (uuids.length > 1) uuids.forEach((u) => dupes.add(u))
  return dupes
}
