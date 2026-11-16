/**
 * A small schema.org validator for our JSON-LD: every typed node must be a
 * known schema.org type and use only properties schema.org defines for that
 * type (or its ancestors), plus the fields Google requires for the rich
 * results we target. Property lists follow schema.org's type hierarchy
 * (Thing → CreativeWork → ...); only the types our builders emit are listed.
 */

const THING = ['@id', '@type', '@context', 'name', 'url', 'description', 'image', 'sameAs', 'identifier', 'alternateName', 'mainEntityOfPage', 'potentialAction', 'subjectOf']
const CREATIVE_WORK = [
  ...THING, 'about', 'abstract', 'aggregateRating', 'associatedMedia', 'audience', 'author', 'comment', 'commentCount', 'creator',
  'dateCreated', 'dateModified', 'datePublished', 'educationalLevel', 'hasPart', 'headline', 'inLanguage', 'interactionStatistic',
  'isAccessibleForFree', 'isPartOf', 'keywords', 'learningResourceType', 'license', 'mainEntity', 'offers', 'position', 'provider',
  'publisher', 'teaches', 'text', 'thumbnailUrl', 'timeRequired', 'educationalAlignment', 'educationalUse',
]
const ARTICLE = [...CREATIVE_WORK, 'articleBody', 'articleSection', 'wordCount']
const COMMENT = [...CREATIVE_WORK, 'upvoteCount', 'downvoteCount', 'parentItem', 'sharedContent']
const WEB_PAGE = [...CREATIVE_WORK, 'breadcrumb', 'primaryImageOfPage', 'lastReviewed', 'speakable', 'significantLink']
const ORGANIZATION = [...THING, 'logo', 'email', 'address', 'telephone', 'founder', 'foundingDate', 'contactPoint', 'parentOrganization', 'department', 'areaServed', 'hasCredential', 'knowsAbout']
const EVENT = [...THING, 'startDate', 'endDate', 'eventAttendanceMode', 'eventStatus', 'location', 'organizer', 'performer', 'offers', 'isAccessibleForFree', 'inLanguage', 'duration', 'attendee', 'audience', 'maximumAttendeeCapacity', 'eventSchedule']

export const TYPES = {
  Thing: THING,
  Organization: ORGANIZATION,
  EducationalOrganization: [...ORGANIZATION, 'alumni'],
  CollegeOrUniversity: [...ORGANIZATION, 'alumni'],
  School: [...ORGANIZATION, 'alumni'],
  OnlineBusiness: ORGANIZATION,
  Corporation: [...ORGANIZATION, 'tickerSymbol'],
  WebSite: [...CREATIVE_WORK, 'issn'],
  SearchAction: [...THING, 'target', 'query-input', 'query'],
  EntryPoint: [...THING, 'urlTemplate', 'actionPlatform', 'contentType'],
  WebPage: WEB_PAGE,
  CollectionPage: WEB_PAGE,
  QAPage: WEB_PAGE,
  FAQPage: WEB_PAGE,
  ProfilePage: WEB_PAGE,
  BreadcrumbList: [...THING, 'itemListElement', 'numberOfItems', 'itemListOrder'],
  ItemList: [...THING, 'itemListElement', 'numberOfItems', 'itemListOrder'],
  ListItem: [...THING, 'position', 'item', 'nextItem', 'previousItem'],
  Person: [...THING, 'jobTitle', 'affiliation', 'worksFor', 'givenName', 'familyName', 'email', 'knowsAbout'],
  Course: [...CREATIVE_WORK, 'courseCode', 'coursePrerequisites', 'hasCourseInstance', 'numberOfCredits', 'educationalCredentialAwarded', 'occupationalCredentialAwarded', 'syllabusSections', 'totalHistoricalEnrollment', 'availableLanguage', 'financialAidEligible'],
  CourseInstance: [...EVENT, 'courseMode', 'courseWorkload', 'courseSchedule', 'instructor'],
  Syllabus: [...CREATIVE_WORK],
  LearningResource: [...CREATIVE_WORK, 'assesses', 'competencyRequired', 'educationalFramework'],
  EducationalAudience: [...THING, 'educationalRole', 'audienceType'],
  EducationalOccupationalProgram: [...THING, 'provider', 'hasCourse', 'educationalCredentialAwarded', 'timeToComplete', 'programPrerequisites', 'occupationalCategory', 'educationalProgramMode', 'numberOfCredits', 'offers', 'programType'],
  EducationalOccupationalCredential: [...CREATIVE_WORK, 'credentialCategory', 'recognizedBy', 'validFor', 'validIn', 'competencyRequired'],
  Offer: [...THING, 'price', 'priceCurrency', 'availability', 'seller', 'category', 'validFrom', 'priceValidUntil', 'eligibleRegion', 'itemOffered', 'priceSpecification'],
  AggregateRating: [...THING, 'ratingValue', 'ratingCount', 'reviewCount', 'bestRating', 'worstRating', 'itemReviewed'],
  InteractionCounter: [...THING, 'interactionType', 'userInteractionCount', 'interactionService'],
  DiscussionForumPosting: [...ARTICLE, 'sharedContent'],
  Comment: COMMENT,
  Question: [...COMMENT, 'answerCount', 'acceptedAnswer', 'suggestedAnswer', 'eduQuestionType'],
  Answer: [...COMMENT, 'answerExplanation'],
  Event: EVENT,
  VirtualLocation: THING,
  Product: [...THING, 'brand', 'offers', 'sku', 'gtin', 'aggregateRating', 'review', 'category', 'logo'],
  Brand: [...THING, 'logo', 'slogan'],
  PodcastSeries: [...CREATIVE_WORK, 'webFeed', 'actor', 'startDate', 'endDate', 'issn'],
  PodcastEpisode: [...CREATIVE_WORK, 'episodeNumber', 'partOfSeries', 'partOfSeason', 'duration', 'actor'],
  MediaObject: [...CREATIVE_WORK, 'contentUrl', 'encodingFormat', 'duration', 'uploadDate', 'embedUrl', 'contentSize'],
}

/**
 * Required properties for the Google rich results we aim for, checked on the
 * document's top-level entity (a Course nested as a reference elsewhere needs
 * only its name and URL).
 */
export const REQUIRED = {
  Course: ['name', 'description', 'provider'],
  DiscussionForumPosting: ['author', 'datePublished', 'text'],
  QAPage: ['mainEntity'],
  FAQPage: ['mainEntity'],
  Event: ['name', 'startDate', 'location'],
  BreadcrumbList: ['itemListElement'],
  Product: ['name'],
  EducationalOccupationalCredential: ['name', 'credentialCategory'],
}
/** Required wherever the type appears. */
export const REQUIRED_ANYWHERE = {
  Answer: ['text'],
  ListItem: ['position'],
  Offer: ['price', 'priceCurrency'],
  InteractionCounter: ['interactionType', 'userInteractionCount'],
}

/** Errors (empty when valid) for a JSON-LD document. */
export function validateJsonLd(doc, path = '$') {
  const errors = []
  if (Array.isArray(doc)) {
    doc.forEach((d, i) => errors.push(...validateJsonLd(d, `${path}[${i}]`)))
    return errors
  }
  if (!doc || typeof doc !== 'object') return errors
  if (path === '$' && doc['@context'] !== 'https://schema.org') errors.push(`${path}: @context must be https://schema.org`)
  const type = doc['@type']
  if (type !== undefined) {
    const allowed = TYPES[type]
    if (!allowed) errors.push(`${path}: unknown type ${type}`)
    else {
      for (const key of Object.keys(doc)) if (!allowed.includes(key)) errors.push(`${path}: ${type} has no property ${key}`)
      const required = [...(path === '$' ? REQUIRED[type] || [] : []), ...(REQUIRED_ANYWHERE[type] || [])]
      for (const key of required) if (doc[key] === undefined || doc[key] === '') errors.push(`${path}: ${type} is missing ${key}`)
      // Q&A rich results: the question needs its name and answer count.
      if (path === '$' && type === 'QAPage') {
        for (const key of ['name', 'answerCount']) if (doc.mainEntity?.[key] === undefined) errors.push(`$.mainEntity: Question is missing ${key}`)
      }
    }
  }
  for (const [key, value] of Object.entries(doc)) {
    if (value === '' || (Array.isArray(value) && value.length === 0)) errors.push(`${path}.${key}: empty value`)
    if (value && typeof value === 'object') errors.push(...validateJsonLd(value, `${path}.${key}`))
  }
  return errors
}
