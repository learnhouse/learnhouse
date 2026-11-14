/**
 * schema.org JSON-LD builders. Pure functions over plain inputs so they can be
 * unit tested and used from the `@seo` metadata slot (server only).
 *
 * Shapes follow Google's structured data docs for the rich results that apply:
 * Course info (Course + hasCourseInstance + offers), Breadcrumb, Organization,
 * Carousel (ItemList), Discussion forum, FAQ, Event. Empty values are dropped
 * so the output never carries `""` or `[]` properties.
 */

export type JsonLdObject = Record<string, any>

const CONTEXT = 'https://schema.org'

/** `@id` of an entity on the site root (`https://x.com/#organization`). */
export function rootId(url: string, fragment: string): string {
  return `${url.replace(/\/+$/, '')}/#${fragment}`
}

/** Drop undefined/null/''/[] values (one level deep, recursing into objects/arrays). */
export function compact<T extends JsonLdObject>(obj: T): T {
  const out: JsonLdObject = {}
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === '') continue
    if (Array.isArray(v)) {
      const arr = v
        .map((item) => (item && typeof item === 'object' && !Array.isArray(item) ? compact(item) : item))
        .filter((item) => item !== undefined && item !== null && item !== '' && !(typeof item === 'object' && Object.keys(item).length === 0))
      if (arr.length) out[k] = arr
      continue
    }
    if (typeof v === 'object') {
      const inner = compact(v)
      if (Object.keys(inner).length) out[k] = inner
      continue
    }
    out[k] = v
  }
  return out as T
}

/** API dates look like `2026-11-05 01:33:02.174979`; schema.org wants ISO 8601. */
export function toIsoDate(value?: string | null): string | undefined {
  if (!value) return undefined
  const normalized = String(value).trim().replace(' ', 'T')
  const date = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(normalized) ? normalized : `${normalized}Z`)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

/** Minutes to an ISO 8601 duration (`PT1H30M`). */
export function isoDuration(minutes?: number | null): string | undefined {
  if (!minutes || minutes <= 0) return undefined
  const total = Math.max(1, Math.round(minutes))
  const h = Math.floor(total / 60)
  const m = total % 60
  return `PT${h ? `${h}H` : ''}${m ? `${m}M` : ''}`
}

export function plainText(value?: string | null, max = 5000): string | undefined {
  if (!value) return undefined
  const text = String(value).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  return text ? text.slice(0, max) : undefined
}

export type OrgInput = {
  name: string
  url: string
  description?: string | null
  logo?: string | null
  image?: string | null
  sameAs?: string[]
  email?: string | null
  /** EducationalOrganization by default; admins can pick another type. */
  type?: string
}

export function organizationJsonLd(org: OrgInput): JsonLdObject {
  return compact({
    '@context': CONTEXT,
    '@type': org.type || 'EducationalOrganization',
    '@id': rootId(org.url, 'organization'),
    name: org.name,
    url: org.url,
    description: plainText(org.description, 500),
    logo: org.logo || undefined,
    image: org.image || undefined,
    email: org.email || undefined,
    sameAs: (org.sameAs || []).filter((u) => /^https?:\/\//.test(u)),
  })
}

/** Org reference used inside other entities (links to the home page entity). */
export function orgRef(org: Pick<OrgInput, 'name' | 'url' | 'logo'> & { type?: string }): JsonLdObject {
  return compact({ '@type': org.type || 'EducationalOrganization', '@id': rootId(org.url, 'organization'), name: org.name, url: org.url, logo: org.logo || undefined })
}

export function websiteJsonLd(input: { name: string; url: string; inLanguage?: string; searchUrlTemplate?: string }): JsonLdObject {
  return compact({
    '@context': CONTEXT,
    '@type': 'WebSite',
    '@id': rootId(input.url, 'website'),
    name: input.name,
    url: input.url,
    inLanguage: input.inLanguage,
    publisher: { '@id': rootId(input.url, 'organization') },
    potentialAction: input.searchUrlTemplate
      ? { '@type': 'SearchAction', target: { '@type': 'EntryPoint', urlTemplate: input.searchUrlTemplate }, 'query-input': 'required name=search_term_string' }
      : undefined,
  })
}

export function breadcrumbJsonLd(items: { name: string; url: string }[]): JsonLdObject {
  return {
    '@context': CONTEXT,
    '@type': 'BreadcrumbList',
    itemListElement: items
      .filter((i) => i.name && i.url)
      .map((item, index) => ({ '@type': 'ListItem', position: index + 1, name: item.name, item: item.url })),
  }
}

/** A summary-page carousel: an ordered list of URLs (Google "Carousel" format). */
export function itemListJsonLd(name: string, urls: { url: string; name?: string }[]): JsonLdObject {
  return compact({
    '@context': CONTEXT,
    '@type': 'ItemList',
    name,
    numberOfItems: urls.length,
    itemListElement: urls.map((u, i) => compact({ '@type': 'ListItem', position: i + 1, url: u.url, name: u.name })),
  })
}

export type PersonInput = { name: string; url?: string; image?: string; jobTitle?: string; description?: string }

export function personJsonLd(person: PersonInput, withContext = false): JsonLdObject {
  return compact({
    ...(withContext ? { '@context': CONTEXT } : {}),
    '@type': 'Person',
    name: person.name,
    url: person.url,
    image: person.image,
    jobTitle: person.jobTitle,
    description: plainText(person.description, 300),
  })
}

export type OfferInput = { price: number; currency: string; name?: string; url?: string; recurring?: boolean }

export type CourseInput = {
  name: string
  description?: string | null
  url: string
  image?: string | null
  org: Pick<OrgInput, 'name' | 'url' | 'logo'>
  authors?: PersonInput[]
  datePublished?: string | null
  dateModified?: string | null
  inLanguage?: string
  /** Every language the course is published in (multilingual courses), default first. */
  availableLanguage?: string[]
  educationalLevel?: string | null
  teaches?: string[]
  keywords?: string | null
  about?: string | null
  syllabus?: { name: string; description?: string | null }[]
  workloadMinutes?: number | null
  prerequisites?: string | null
  audience?: string | null
  /** Paid offers; empty/undefined with `isFree` = free course. */
  offers?: OfferInput[]
  isFree?: boolean
  aggregateRating?: { ratingValue: number; ratingCount: number } | null
  enrollmentCount?: number | null
}

export function courseJsonLd(c: CourseInput): JsonLdObject {
  const paid = (c.offers || []).filter((o) => o.price > 0)
  const offers =
    paid.length > 0
      ? paid.map((o) => compact({ '@type': 'Offer', category: o.recurring ? 'Subscription' : 'Paid', price: o.price, priceCurrency: o.currency, name: o.name, url: o.url || c.url, availability: 'https://schema.org/InStock' }))
      : c.isFree !== false
        ? [{ '@type': 'Offer', category: 'Free', price: 0, priceCurrency: (c.offers?.[0]?.currency || 'USD'), url: c.url, availability: 'https://schema.org/InStock' }]
        : undefined
  return compact({
    '@context': CONTEXT,
    '@type': 'Course',
    '@id': `${c.url}#course`,
    name: c.name,
    description: plainText(c.description, 1000) || c.name,
    url: c.url,
    image: c.image || undefined,
    provider: orgRef(c.org),
    publisher: orgRef(c.org),
    author: (c.authors || []).map((a) => personJsonLd(a)),
    datePublished: toIsoDate(c.datePublished),
    dateModified: toIsoDate(c.dateModified),
    inLanguage: c.inLanguage,
    availableLanguage: c.availableLanguage && c.availableLanguage.length > 1 ? c.availableLanguage : undefined,
    educationalLevel: c.educationalLevel || undefined,
    teaches: (c.teaches || []).filter(Boolean),
    keywords: c.keywords || undefined,
    abstract: plainText(c.about, 1000),
    coursePrerequisites: c.prerequisites || undefined,
    audience: c.audience ? { '@type': 'EducationalAudience', audienceType: c.audience } : undefined,
    isAccessibleForFree: paid.length === 0 && c.isFree !== false,
    syllabusSections: (c.syllabus || []).map((s) => compact({ '@type': 'Syllabus', name: s.name, description: plainText(s.description, 300) })),
    totalHistoricalEnrollment: c.enrollmentCount || undefined,
    hasCourseInstance: [
      compact({
        '@type': 'CourseInstance',
        courseMode: 'Online',
        courseWorkload: isoDuration(c.workloadMinutes),
        inLanguage: c.inLanguage,
      }),
    ],
    offers,
    aggregateRating:
      c.aggregateRating && c.aggregateRating.ratingCount > 0
        ? { '@type': 'AggregateRating', ratingValue: c.aggregateRating.ratingValue, ratingCount: c.aggregateRating.ratingCount, bestRating: 5, worstRating: 1 }
        : undefined,
  })
}

export function learningResourceJsonLd(input: {
  name: string
  url: string
  description?: string | null
  courseName: string
  courseUrl: string
  type?: string
  dateModified?: string | null
  inLanguage?: string
  isFree?: boolean
}): JsonLdObject {
  return compact({
    '@context': CONTEXT,
    '@type': 'LearningResource',
    name: input.name,
    url: input.url,
    description: plainText(input.description, 500),
    learningResourceType: input.type,
    inLanguage: input.inLanguage,
    dateModified: toIsoDate(input.dateModified),
    isAccessibleForFree: input.isFree,
    isPartOf: { '@type': 'Course', '@id': `${input.courseUrl}#course`, name: input.courseName, url: input.courseUrl },
  })
}

export function pathJsonLd(input: {
  name: string
  url: string
  description?: string | null
  image?: string | null
  org: Pick<OrgInput, 'name' | 'url' | 'logo'>
  courses: { name: string; url: string }[]
  educationalLevel?: string | null
  inLanguage?: string
}): JsonLdObject {
  return compact({
    '@context': CONTEXT,
    '@type': 'EducationalOccupationalProgram',
    name: input.name,
    url: input.url,
    description: plainText(input.description, 1000),
    image: input.image || undefined,
    provider: orgRef(input.org),
    educationalLevel: input.educationalLevel || undefined,
    inLanguage: input.inLanguage,
    hasCourse: input.courses.map((c) => ({ '@type': 'Course', name: c.name, url: c.url })),
  })
}

export function podcastSeriesJsonLd(input: {
  name: string
  url: string
  description?: string | null
  image?: string | null
  org: Pick<OrgInput, 'name' | 'url' | 'logo'>
  authors?: PersonInput[]
  inLanguage?: string
  feedUrl?: string
  episodes: { name: string; description?: string | null; datePublished?: string | null; durationSeconds?: number | null; audioUrl?: string | null; episodeNumber?: number | null }[]
}): JsonLdObject {
  return compact({
    '@context': CONTEXT,
    '@type': 'PodcastSeries',
    name: input.name,
    url: input.url,
    description: plainText(input.description, 1000),
    image: input.image || undefined,
    webFeed: input.feedUrl,
    inLanguage: input.inLanguage,
    publisher: orgRef(input.org),
    author: (input.authors || []).map((a) => personJsonLd(a)),
    episode: input.episodes.map((ep) =>
      compact({
        '@type': 'PodcastEpisode',
        name: ep.name,
        description: plainText(ep.description, 500),
        episodeNumber: ep.episodeNumber || undefined,
        datePublished: toIsoDate(ep.datePublished),
        timeRequired: ep.durationSeconds ? isoDuration(Math.max(1, Math.round(ep.durationSeconds / 60))) : undefined,
        associatedMedia: ep.audioUrl ? { '@type': 'MediaObject', contentUrl: ep.audioUrl } : undefined,
      }),
    ),
  })
}

/** A community home is a forum (collection of threads), not a single post. */
export function communityJsonLd(input: {
  name: string
  url: string
  description?: string | null
  org: Pick<OrgInput, 'name' | 'url' | 'logo'>
  threads: { name: string; url: string }[]
}): JsonLdObject {
  return compact({
    '@context': CONTEXT,
    '@type': 'CollectionPage',
    name: input.name,
    url: input.url,
    description: plainText(input.description, 500),
    publisher: orgRef(input.org),
    mainEntity: input.threads.length
      ? { '@type': 'ItemList', itemListElement: input.threads.map((t, i) => ({ '@type': 'ListItem', position: i + 1, url: t.url, name: t.name })) }
      : undefined,
  })
}

export function discussionJsonLd(input: {
  headline: string
  url: string
  text?: string | null
  author: { name: string; url?: string }
  datePublished?: string | null
  dateModified?: string | null
  upvotes?: number
  commentCount?: number
  comments?: { text: string; author: string; datePublished?: string | null; upvotes?: number }[]
  communityName?: string
  communityUrl?: string
}): JsonLdObject {
  return compact({
    '@context': CONTEXT,
    '@type': 'DiscussionForumPosting',
    headline: input.headline.slice(0, 110),
    url: input.url,
    text: plainText(input.text, 5000) || input.headline,
    author: compact({ '@type': 'Person', name: input.author.name || 'Member', url: input.author.url }),
    datePublished: toIsoDate(input.datePublished),
    dateModified: toIsoDate(input.dateModified),
    isPartOf: input.communityUrl ? { '@type': 'WebPage', name: input.communityName, url: input.communityUrl } : undefined,
    interactionStatistic: [
      input.upvotes != null ? { '@type': 'InteractionCounter', interactionType: 'https://schema.org/LikeAction', userInteractionCount: input.upvotes } : undefined,
      input.commentCount != null ? { '@type': 'InteractionCounter', interactionType: 'https://schema.org/CommentAction', userInteractionCount: input.commentCount } : undefined,
    ],
    comment: (input.comments || []).slice(0, 20).map((c) =>
      compact({
        '@type': 'Comment',
        text: plainText(c.text, 2000),
        author: { '@type': 'Person', name: c.author || 'Member' },
        datePublished: toIsoDate(c.datePublished),
        interactionStatistic: c.upvotes != null ? { '@type': 'InteractionCounter', interactionType: 'https://schema.org/LikeAction', userInteractionCount: c.upvotes } : undefined,
      }),
    ),
  })
}

export function faqJsonLd(items: { question: string; answer: string }[]): JsonLdObject | null {
  const valid = items.filter((i) => i.question?.trim() && i.answer?.trim())
  if (!valid.length) return null
  return {
    '@context': CONTEXT,
    '@type': 'FAQPage',
    mainEntity: valid.map((i) => ({
      '@type': 'Question',
      name: i.question.trim(),
      acceptedAnswer: { '@type': 'Answer', text: i.answer.trim() },
    })),
  }
}

export function eventJsonLd(input: {
  name: string
  url: string
  description?: string | null
  startDate: string
  endDate?: string | null
  image?: string | null
  org: Pick<OrgInput, 'name' | 'url' | 'logo'>
  performers?: PersonInput[]
  cancelled?: boolean
  isFree?: boolean
}): JsonLdObject {
  return compact({
    '@context': CONTEXT,
    '@type': 'Event',
    name: input.name,
    url: input.url,
    description: plainText(input.description, 1000),
    startDate: toIsoDate(input.startDate),
    endDate: toIsoDate(input.endDate),
    image: input.image || undefined,
    eventAttendanceMode: 'https://schema.org/OnlineEventAttendanceMode',
    eventStatus: input.cancelled ? 'https://schema.org/EventCancelled' : 'https://schema.org/EventScheduled',
    location: { '@type': 'VirtualLocation', url: input.url },
    organizer: orgRef(input.org),
    performer: (input.performers || []).map((p) => personJsonLd(p)),
    isAccessibleForFree: input.isFree,
  })
}

export function collectionJsonLd(input: {
  name: string
  url: string
  description?: string | null
  image?: string | null
  org: Pick<OrgInput, 'name' | 'url' | 'logo'>
  items: { name: string; url: string }[]
}): JsonLdObject {
  return compact({
    '@context': CONTEXT,
    '@type': 'CollectionPage',
    name: input.name,
    url: input.url,
    description: plainText(input.description, 500),
    image: input.image || undefined,
    publisher: orgRef(input.org),
    mainEntity: input.items.length
      ? { '@type': 'ItemList', itemListElement: input.items.map((t, i) => ({ '@type': 'ListItem', position: i + 1, url: t.url, name: t.name })) }
      : undefined,
  })
}
