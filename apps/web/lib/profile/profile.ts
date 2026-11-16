/**
 * The public profile document: what the profile builder edits and what the
 * public profile page, the profile popup and the builder preview render.
 *
 * Storage (no migration): the user's `profile` JSON column holds the header
 * fields and the ordered sections; the user's `details` JSON column keeps the
 * label / icon / text rows ("Additional details" before they moved into the
 * builder). A `details` section in `profile.sections` only marks where those
 * rows sit and whether they are shown; profiles saved before the merge have
 * no marker, so `normalizeProfile` adds one in front when rows exist.
 *
 * Everything shown publicly goes through the helpers here: links keep only
 * http(s) and mailto targets, images only http(s), and rich text is parsed
 * into a small tree (never HTML), so stored data cannot inject markup or a
 * `javascript:` link whatever it contains. Pure module, safe on the server.
 */
import { splitLinks } from '../text/linkify'

export const SECTION_TYPES = [
  'details',
  'text',
  'links',
  'skills',
  'experience',
  'education',
  'affiliation',
  'image-gallery',
  'featured',
  'courses',
] as const
export type SectionType = (typeof SECTION_TYPES)[number]

/** Sections a profile holds at most once. */
export const SINGLE_SECTIONS: ReadonlySet<SectionType> = new Set(['details', 'courses'])
/** Sections rendered in the slim side column on desktop. */
export const SIDE_SECTIONS: ReadonlySet<SectionType> = new Set(['details', 'links', 'skills', 'affiliation'])

export const LIMITS = {
  headline: 120,
  pronouns: 40,
  location: 80,
  about: 2000,
  text: 4000,
  title: 80,
  featured: 6,
  sections: 30,
  items: 50,
} as const

export type DetailItem = { id: string; label: string; icon: string; text: string }
export type ProfileLink = { title: string; url: string }
export type SkillLevel = 'beginner' | 'intermediate' | 'advanced' | 'expert'
export type ProfileSkill = { name: string; level?: SkillLevel | ''; category?: string }
export type ProfileExperience = {
  title: string
  organization: string
  startDate: string
  endDate?: string
  current: boolean
  description: string
}
export type ProfileEducation = {
  institution: string
  degree: string
  field: string
  startDate: string
  endDate?: string
  current: boolean
  description?: string
}
export type ProfileAffiliation = { name: string; description: string; logoUrl: string }
export type ProfileImage = { url: string; caption?: string }
export type FeaturedKind = 'course' | 'certificate' | 'badge'
export type FeaturedItem = { kind: FeaturedKind; id: string }

export type ProfileSection = {
  id: string
  type: SectionType
  title: string
  hidden?: boolean
  content?: string
  links?: ProfileLink[]
  skills?: ProfileSkill[]
  experiences?: ProfileExperience[]
  education?: ProfileEducation[]
  affiliations?: ProfileAffiliation[]
  images?: ProfileImage[]
  items?: FeaturedItem[]
}

export type ProfileDoc = {
  version: 2
  headline: string
  pronouns: string
  location: string
  about: string
  sections: ProfileSection[]
}

const SKILL_LEVELS: ReadonlySet<string> = new Set(['beginner', 'intermediate', 'advanced', 'expert'])
const FEATURED_KINDS: ReadonlySet<string> = new Set(['course', 'certificate', 'badge'])

const str = (v: unknown, max = 10_000): string => (typeof v === 'string' ? v.slice(0, max) : typeof v === 'number' ? String(v) : '')
const obj = (v: unknown): Record<string, any> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : {})
const arr = (v: unknown): any[] => (Array.isArray(v) ? v.slice(0, LIMITS.items) : [])

/** A JSON column may arrive as a string (older rows) or an object. */
export function parseJsonColumn(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

// ─── URLs ────────────────────────────────────────────────────────────────────

const SCHEME = /^([a-z][a-z0-9+.-]*):/i
// A bare host ("example.com/path"): letters, digits, dots and dashes, a dot, a TLD.
const BARE_HOST = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}(?::\d{1,5})?(?:[/?#]\S*)?$/i
const EMAIL = /^[^\s@/:]+@[^\s@/:]+\.[a-z]{2,}$/i

/**
 * The href to use for a user-provided link, or null when it is not a safe
 * web or mail address. "example.com" becomes https://example.com and a plain
 * email address becomes mailto:. Control characters and whitespace inside the
 * value (used to smuggle "java\tscript:") reject it outright.
 */
export function safeUrl(raw: unknown, { mailto = true }: { mailto?: boolean } = {}): string | null {
  if (typeof raw !== 'string') return null
  const value = raw.trim()
  if (!value || value.length > 2048) return null
  // eslint-disable-next-line no-control-regex
  if (/[\s\u0000-\u001f\u007f]/.test(value)) return null
  const scheme = SCHEME.exec(value)?.[1]?.toLowerCase()
  if (scheme === 'http' || scheme === 'https') {
    try {
      const url = new URL(value)
      return url.hostname ? url.href : null
    } catch {
      return null
    }
  }
  if (scheme === 'mailto') return mailto && EMAIL.test(value.slice(7).split('?')[0]) ? value : null
  if (scheme) return null
  if (value.startsWith('//')) return null
  if (mailto && EMAIL.test(value)) return `mailto:${value}`
  if (BARE_HOST.test(value)) return safeUrl(`https://${value}`, { mailto })
  return null
}

/** Image sources: absolute http(s) only. */
export function safeImageUrl(raw: unknown): string | null {
  const href = safeUrl(raw, { mailto: false })
  return href && /^https?:/i.test(href) ? href : null
}

export type LinkKind = 'github' | 'linkedin' | 'x' | 'youtube' | 'instagram' | 'facebook' | 'mastodon' | 'mail' | 'website'

/** Which icon a link gets, from its address. */
export function linkKind(href: string | null | undefined): LinkKind {
  if (!href) return 'website'
  if (href.startsWith('mailto:')) return 'mail'
  let host = ''
  try {
    host = new URL(href).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return 'website'
  }
  const is = (domain: string) => host === domain || host.endsWith(`.${domain}`)
  if (is('github.com')) return 'github'
  if (is('linkedin.com')) return 'linkedin'
  if (is('x.com') || is('twitter.com')) return 'x'
  if (is('youtube.com') || is('youtu.be')) return 'youtube'
  if (is('instagram.com')) return 'instagram'
  if (is('facebook.com') || is('fb.com')) return 'facebook'
  if (is('mastodon.social') || host.startsWith('mastodon.')) return 'mastodon'
  return 'website'
}

/** "github.com/maya" for display: no scheme, no trailing slash. */
export function displayUrl(href: string): string {
  if (href.startsWith('mailto:')) return href.slice(7)
  return href.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '')
}

// ─── Rich text ───────────────────────────────────────────────────────────────

export type RichInline =
  | { type: 'text'; value: string }
  | { type: 'link'; href: string; text: string }
  | { type: 'strong'; children: RichInline[] }
  | { type: 'em'; children: RichInline[] }
  | { type: 'br' }
export type RichBlock = { type: 'p'; children: RichInline[] } | { type: 'ul'; items: RichInline[][] }

const LIST_ITEM = /^\s*[-*•]\s+/

/** Plain text with bare web links turned into link nodes (https/www only). */
function autolink(text: string): RichInline[] {
  return splitLinks(text).flatMap<RichInline>((seg) => {
    if (seg.type === 'text') return seg.value ? [{ type: 'text', value: seg.value }] : []
    const href = safeUrl(seg.href, { mailto: false })
    return href ? [{ type: 'link', href, text: seg.value }] : [{ type: 'text', value: seg.value }]
  })
}

/**
 * Inline markup: **bold**, *italic* / _italic_ and [label](url). Single
 * linear pass, no nesting beyond one emphasis level, no regex backtracking on
 * user text. An unsafe link target leaves its label as plain text.
 */
export function parseInline(src: string, depth = 0): RichInline[] {
  const out: RichInline[] = []
  let buf = ''
  const flush = () => {
    if (buf) out.push(...autolink(buf))
    buf = ''
  }
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (c === '\n') {
      flush()
      out.push({ type: 'br' })
      i++
      continue
    }
    if (c === '[') {
      const close = src.indexOf(']', i + 1)
      if (close > i && src[close + 1] === '(') {
        // The target ends at the matching ")" (URLs may hold parentheses).
        let end = -1
        for (let j = close + 2, depth = 1; j < src.length && src[j] !== '\n'; j++) {
          if (src[j] === '(') depth++
          else if (src[j] === ')' && --depth === 0) {
            end = j
            break
          }
        }
        const label = src.slice(i + 1, close)
        if (end > close && !label.includes('\n')) {
          const href = safeUrl(src.slice(close + 2, end))
          flush()
          out.push(href ? { type: 'link', href, text: label || displayUrl(href) } : { type: 'text', value: label })
          i = end + 1
          continue
        }
      }
    }
    if (depth === 0 && c === '*' && src[i + 1] === '*') {
      const end = src.indexOf('**', i + 2)
      if (end > i + 2) {
        flush()
        out.push({ type: 'strong', children: parseInline(src.slice(i + 2, end), depth + 1) })
        i = end + 2
        continue
      }
    }
    if (depth === 0 && (c === '*' || c === '_') && src[i + 1] !== c && src[i + 1] !== ' ') {
      const end = src.indexOf(c, i + 1)
      if (end > i + 1 && src[end - 1] !== ' ') {
        flush()
        out.push({ type: 'em', children: parseInline(src.slice(i + 1, end), depth + 1) })
        i = end + 1
        continue
      }
    }
    buf += c
    i++
  }
  flush()
  return out
}

/** Paragraphs (blank-line separated) and "- " bullet lists. */
export function parseRichText(src: unknown, max: number = LIMITS.text): RichBlock[] {
  const text = str(src, max).replace(/\r\n?/g, '\n').trim()
  if (!text) return []
  const blocks: RichBlock[] = []
  for (const chunk of text.split(/\n{2,}/)) {
    const lines = chunk.split('\n')
    let para: string[] = []
    let list: string[] = []
    const flushPara = () => {
      if (para.length) blocks.push({ type: 'p', children: parseInline(para.join('\n')) })
      para = []
    }
    const flushList = () => {
      if (list.length) blocks.push({ type: 'ul', items: list.map((l) => parseInline(l)) })
      list = []
    }
    for (const line of lines) {
      if (LIST_ITEM.test(line)) {
        flushPara()
        list.push(line.replace(LIST_ITEM, ''))
      } else {
        flushList()
        para.push(line)
      }
    }
    flushPara()
    flushList()
  }
  return blocks
}

/** Rich text without its markup, for descriptions and previews. */
export function richTextToPlain(src: unknown, max = 300): string {
  const walk = (nodes: RichInline[]): string =>
    nodes
      .map((n) => (n.type === 'text' ? n.value : n.type === 'link' ? n.text : n.type === 'br' ? ' ' : walk(n.children)))
      .join('')
  return parseRichText(src)
    .map((b) => (b.type === 'p' ? walk(b.children) : b.items.map(walk).join(', ')))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

// ─── Details (the former "Additional details") ───────────────────────────────

/** The stored details object (or an array) as an ordered list. */
export function normalizeDetails(raw: unknown): DetailItem[] {
  const parsed = parseJsonColumn(raw)
  const entries: [string, any][] = Array.isArray(parsed)
    ? parsed.map((d, i) => [str(obj(d).id) || `detail-${i}`, d])
    : Object.entries(obj(parsed))
  const seen = new Set<string>()
  const out: DetailItem[] = []
  for (const [key, value] of entries.slice(0, LIMITS.items)) {
    const d = obj(value)
    let id = str(d.id, 80) || key
    while (seen.has(id)) id = `${id}-1`
    seen.add(id)
    out.push({ id, label: str(d.label, 80), icon: str(d.icon, 40), text: str(d.text, 300) })
  }
  return out
}

/** Back to the stored shape, keyed by id in display order. */
export function detailsToRecord(list: DetailItem[]): Record<string, DetailItem> {
  const out: Record<string, DetailItem> = {}
  for (const d of list) {
    const text = d.text.trim()
    const label = d.label.trim()
    if (!text && !label) continue
    out[d.id] = { id: d.id, label, icon: d.icon, text }
  }
  return out
}

/** Rows worth showing publicly (a value is set). */
export function visibleDetails(list: DetailItem[]): DetailItem[] {
  return list.filter((d) => d.text.trim())
}

// ─── Document ────────────────────────────────────────────────────────────────

function normalizeSection(raw: any, index: number): ProfileSection | null {
  const s = obj(raw)
  const type = s.type as SectionType
  if (!SECTION_TYPES.includes(type)) return null
  const section: ProfileSection = {
    id: str(s.id, 80) || `section-${index}`,
    type,
    title: str(s.title, LIMITS.title),
    ...(s.hidden === true ? { hidden: true } : {}),
  }
  switch (type) {
    case 'text':
      section.content = str(s.content, LIMITS.text)
      break
    case 'links':
      section.links = arr(s.links).map((l) => ({ title: str(obj(l).title, 120), url: str(obj(l).url, 2048) }))
      break
    case 'skills':
      section.skills = arr(s.skills).map((k) => {
        const level = str(obj(k).level)
        return { name: str(obj(k).name, 80), level: SKILL_LEVELS.has(level) ? (level as SkillLevel) : '', category: str(obj(k).category, 80) }
      })
      break
    case 'experience':
      section.experiences = arr(s.experiences).map((e) => {
        const x = obj(e)
        return {
          title: str(x.title, 120),
          organization: str(x.organization, 120),
          startDate: str(x.startDate, 40),
          endDate: str(x.endDate, 40),
          current: x.current === true,
          description: str(x.description, 2000),
        }
      })
      break
    case 'education':
      section.education = arr(s.education).map((e) => {
        const x = obj(e)
        return {
          institution: str(x.institution, 120),
          degree: str(x.degree, 120),
          field: str(x.field, 120),
          startDate: str(x.startDate, 40),
          endDate: str(x.endDate, 40),
          current: x.current === true,
          description: str(x.description, 2000),
        }
      })
      break
    case 'affiliation':
      section.affiliations = arr(s.affiliations).map((a) => ({
        name: str(obj(a).name, 120),
        description: str(obj(a).description, 1000),
        logoUrl: str(obj(a).logoUrl, 2048),
      }))
      break
    case 'image-gallery':
      section.images = arr(s.images).map((m) => ({ url: str(obj(m).url, 2048), caption: str(obj(m).caption, 200) }))
      break
    case 'featured':
      section.items = arr(s.items)
        .map((it) => ({ kind: str(obj(it).kind) as FeaturedKind, id: str(obj(it).id, 120) }))
        .filter((it) => FEATURED_KINDS.has(it.kind) && it.id)
        .slice(0, LIMITS.featured)
      break
  }
  return section
}

/**
 * The profile as the builder and the renderers use it, from the stored
 * `profile` and `details` columns. Tolerates old and malformed data: unknown
 * section types are dropped, missing ids filled, and a profile saved before
 * the details merge gets a details section in front when rows exist.
 */
export function normalizeProfile(rawProfile: unknown, rawDetails?: unknown): ProfileDoc {
  const p = obj(parseJsonColumn(rawProfile))
  const seen = new Set<string>()
  const sections: ProfileSection[] = []
  const singles = new Set<SectionType>()
  arr(p.sections).forEach((raw, index) => {
    const section = normalizeSection(raw, index)
    if (!section) return
    if (SINGLE_SECTIONS.has(section.type)) {
      if (singles.has(section.type)) return
      singles.add(section.type)
    }
    while (seen.has(section.id)) section.id = `${section.id}-${index}`
    seen.add(section.id)
    sections.push(section)
  })
  if (!singles.has('details') && normalizeDetails(rawDetails).some((d) => d.text.trim())) {
    sections.unshift({ id: 'details', type: 'details', title: '' })
  }
  return {
    version: 2,
    headline: str(p.headline, LIMITS.headline),
    pronouns: str(p.pronouns, LIMITS.pronouns),
    location: str(p.location, LIMITS.location),
    about: str(p.about, LIMITS.about),
    sections,
  }
}

/** Trimmed copy for saving: empty rows dropped, links normalised. */
export function serializeProfile(doc: ProfileDoc): ProfileDoc {
  const t = (v: string | undefined, max: number) => (v ?? '').trim().slice(0, max)
  const sections = doc.sections.slice(0, LIMITS.sections).map<ProfileSection>((s) => {
    const base: ProfileSection = { id: s.id, type: s.type, title: t(s.title, LIMITS.title), ...(s.hidden ? { hidden: true } : {}) }
    switch (s.type) {
      case 'text':
        return { ...base, content: t(s.content, LIMITS.text) }
      case 'links':
        return {
          ...base,
          links: (s.links ?? [])
            .map((l) => ({ title: t(l.title, 120), url: safeUrl(l.url) ?? '' }))
            .filter((l) => l.url),
        }
      case 'skills':
        return {
          ...base,
          skills: (s.skills ?? [])
            .map<ProfileSkill>((k) => ({ name: t(k.name, 80), level: k.level || '', category: t(k.category, 80) }))
            .filter((k) => k.name),
        }
      case 'experience':
        return {
          ...base,
          experiences: (s.experiences ?? [])
            .map((e) => ({ ...e, title: t(e.title, 120), organization: t(e.organization, 120), description: t(e.description, 2000), endDate: e.current ? '' : e.endDate ?? '' }))
            .filter((e) => e.title || e.organization),
        }
      case 'education':
        return {
          ...base,
          education: (s.education ?? [])
            .map((e) => ({ ...e, institution: t(e.institution, 120), degree: t(e.degree, 120), field: t(e.field, 120), description: t(e.description, 2000), endDate: e.current ? '' : e.endDate ?? '' }))
            .filter((e) => e.institution || e.degree),
        }
      case 'affiliation':
        return {
          ...base,
          affiliations: (s.affiliations ?? [])
            .map((a) => ({ name: t(a.name, 120), description: t(a.description, 1000), logoUrl: safeImageUrl(a.logoUrl) ?? '' }))
            .filter((a) => a.name),
        }
      case 'image-gallery':
        return {
          ...base,
          images: (s.images ?? [])
            .map((m) => ({ url: safeImageUrl(m.url) ?? '', caption: t(m.caption, 200) }))
            .filter((m) => m.url),
        }
      case 'featured':
        return { ...base, items: (s.items ?? []).slice(0, LIMITS.featured) }
      default:
        return base
    }
  })
  return {
    version: 2,
    headline: t(doc.headline, LIMITS.headline),
    pronouns: t(doc.pronouns, LIMITS.pronouns),
    location: t(doc.location, LIMITS.location),
    about: t(doc.about, LIMITS.about),
    sections,
  }
}

export type ProfileError = { sectionId: string; index: number; field: 'url' | 'logoUrl' }

/** Addresses the builder must flag before saving (they would be dropped). */
export function profileErrors(doc: ProfileDoc): ProfileError[] {
  const errors: ProfileError[] = []
  for (const s of doc.sections) {
    s.links?.forEach((l, index) => {
      if ((l.url.trim() || l.title.trim()) && !safeUrl(l.url)) errors.push({ sectionId: s.id, index, field: 'url' })
    })
    s.images?.forEach((m, index) => {
      if (m.url.trim() && !safeImageUrl(m.url)) errors.push({ sectionId: s.id, index, field: 'url' })
    })
    s.affiliations?.forEach((a, index) => {
      if (a.logoUrl.trim() && !safeImageUrl(a.logoUrl)) errors.push({ sectionId: s.id, index, field: 'logoUrl' })
    })
  }
  return errors
}

/** Whether a section has anything to show (data-backed sections decide at render). */
export function sectionHasContent(s: ProfileSection, details: DetailItem[] = []): boolean {
  switch (s.type) {
    case 'details':
      return visibleDetails(details).length > 0
    case 'text':
      return !!s.content?.trim()
    case 'links':
      return (s.links ?? []).some((l) => safeUrl(l.url))
    case 'skills':
      return (s.skills ?? []).some((k) => k.name.trim())
    case 'experience':
      return (s.experiences ?? []).some((e) => e.title.trim() || e.organization.trim())
    case 'education':
      return (s.education ?? []).some((e) => e.institution.trim() || e.degree.trim())
    case 'affiliation':
      return (s.affiliations ?? []).some((a) => a.name.trim())
    case 'image-gallery':
      return (s.images ?? []).some((m) => safeImageUrl(m.url))
    case 'featured':
      return (s.items ?? []).length > 0
    case 'courses':
      return true
  }
}

/** Shown sections with content, split into the main and side columns. */
export function layoutSections(doc: ProfileDoc, details: DetailItem[] = []) {
  const shown = doc.sections.filter((s) => !s.hidden && sectionHasContent(s, details))
  return {
    main: shown.filter((s) => !SIDE_SECTIONS.has(s.type)),
    side: shown.filter((s) => SIDE_SECTIONS.has(s.type)),
  }
}

/** "2024-03" → "Mar 2024" in the reader's language; free text passes through. */
export function formatProfileDate(value: string | undefined, locale?: string): string {
  const v = (value ?? '').trim()
  const m = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(v)
  if (!m) return v
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1))
  if (isNaN(d.getTime())) return v
  try {
    return new Intl.DateTimeFormat(locale || 'en', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(d)
  } catch {
    return v
  }
}

export function newSectionId(type: SectionType): string {
  return `${type}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/** Details rows added by the General / Academic / Professional starters. */
export const DETAIL_TEMPLATES = {
  general: [
    { id: 'title', label: 'Title', icon: 'briefcase' },
    { id: 'affiliation', label: 'Affiliation', icon: 'building-2' },
    { id: 'location', label: 'Location', icon: 'map-pin' },
    { id: 'website', label: 'Website', icon: 'globe' },
    { id: 'linkedin', label: 'LinkedIn', icon: 'link' },
  ],
  academic: [
    { id: 'institution', label: 'Institution', icon: 'building-2' },
    { id: 'department', label: 'Department', icon: 'graduation-cap' },
    { id: 'research', label: 'Research Area', icon: 'book-open' },
    { id: 'academic-title', label: 'Academic Title', icon: 'award' },
  ],
  professional: [
    { id: 'company', label: 'Company', icon: 'building-2' },
    { id: 'industry', label: 'Industry', icon: 'briefcase' },
    { id: 'expertise', label: 'Expertise', icon: 'laptop-2' },
    { id: 'community', label: 'Community', icon: 'users' },
  ],
} as const
export type DetailTemplate = keyof typeof DETAIL_TEMPLATES

/** Template rows missing from `list`, appended (existing rows are kept). */
export function applyDetailTemplate(list: DetailItem[], template: DetailTemplate, label: (_id: string, _fallback: string) => string = (_id, f) => f): DetailItem[] {
  const ids = new Set(list.map((d) => d.id))
  return [
    ...list,
    ...DETAIL_TEMPLATES[template]
      .filter((d) => !ids.has(d.id))
      .map((d) => ({ id: d.id, label: label(d.id, d.label), icon: d.icon, text: '' })),
  ]
}

/** Detail rows whose value is a link get rendered as one (safely). */
export function detailHref(detail: DetailItem): string | null {
  const text = detail.text.trim()
  if (!text) return null
  if (['globe', 'link'].includes(detail.icon) || /^https?:\/\//i.test(text) || /^www\./i.test(text)) {
    return safeUrl(text, { mailto: false })
  }
  return null
}
