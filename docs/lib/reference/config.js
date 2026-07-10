/**
 * API Reference configuration — single source of truth for the base URL,
 * caching, token placeholder, and which OpenAPI tags are documented.
 *
 * The FastAPI spec ships without servers/securitySchemes/tag metadata,
 * so everything presentation-related about groups lives here.
 */

export const API_BASE_URL = (
  process.env.LEARNHOUSE_API_URL || 'https://api.learnhouse.io'
).replace(/\/$/, '')

export const SPEC_REVALIDATE_SECONDS = 3600 // 1h ISR window for all reference pages

export const TOKEN_PLACEHOLDER = 'lh_YOUR_API_TOKEN'
export const TOKEN_STORAGE_KEY = 'lh:api-token'
export const LANG_STORAGE_KEY = 'lh:ref-lang'

/**
 * Documented endpoint groups, in display order.
 * `tags` are OpenAPI tags folded into the group (first tag of each operation wins).
 * Any operation whose first tag is not listed here is NOT documented —
 * internal surfaces (superadmin, cloud_internal, ee, dev, …) stay out by default.
 */
export const API_GROUPS = [
  {
    slug: 'auth',
    title: 'Authentication',
    tags: ['auth'],
    description:
      'Login, token refresh, logout, OAuth and email verification. Login is form-encoded and returns a JWT for user-context flows.',
  },
  {
    slug: 'api-tokens',
    title: 'API Tokens',
    tags: ['api-tokens', 'api_tokens'],
    description:
      'Create and manage lh_ organization API tokens with scoped rights. The full token value is only returned once, at creation.',
  },
  {
    slug: 'orgs',
    title: 'Organizations',
    tags: ['orgs'],
    description:
      'Organization CRUD, members, invites, configuration, branding and SEO settings.',
  },
  {
    slug: 'users',
    title: 'Users',
    tags: ['users'],
    description: 'User accounts, profiles, session info and password management.',
  },
  {
    slug: 'usergroups',
    title: 'User Groups',
    tags: ['usergroups'],
    description: 'Group learners together for cohort management and access control.',
  },
  {
    slug: 'courses',
    title: 'Courses',
    tags: ['courses'],
    description:
      'Course CRUD, cloning, export/import and contributor management. Create and update endpoints accept multipart form data.',
  },
  {
    slug: 'chapters',
    title: 'Chapters',
    tags: ['chapters'],
    description: 'Chapter CRUD and ordering within courses.',
  },
  {
    slug: 'activities',
    title: 'Activities',
    tags: ['activities'],
    description:
      'Individual content units within chapters: dynamic pages, videos, documents, assignments and SCORM packages.',
  },
  {
    slug: 'blocks',
    title: 'Blocks',
    tags: ['blocks'],
    description: 'Content blocks within dynamic page activities.',
  },
  {
    slug: 'assignments',
    title: 'Assignments',
    tags: ['assignments'],
    description:
      'Assignment authoring, tasks, submissions and grading — fully drivable headlessly with an API token.',
  },
  {
    slug: 'folders',
    title: 'Folders',
    tags: ['folders'],
    description: 'Content folders used to organize and group courses (collections).',
  },
  {
    slug: 'media',
    title: 'Media',
    tags: ['media'],
    description: 'Upload and manage media assets.',
  },
  {
    slug: 'certifications',
    title: 'Certifications',
    tags: ['certifications'],
    description: 'Certificate generation and management for course completion.',
  },
  {
    slug: 'payments',
    title: 'Payments',
    tags: ['payments'],
    description:
      'Products, prices, checkout and enrollment via the open payments API, including bring-your-own provider.',
  },
  {
    slug: 'search',
    title: 'Search',
    tags: ['search'],
    description: 'Full-text search across courses and content.',
  },
  {
    slug: 'analytics',
    title: 'Analytics',
    tags: ['analytics'],
    description: 'Course analytics and usage metrics.',
  },
  {
    slug: 'webhooks',
    title: 'Webhooks',
    tags: ['webhooks'],
    description: 'Register HTTP endpoints that receive event notifications from LearnHouse.',
  },
  {
    slug: 'headless',
    title: 'Headless',
    tags: ['admin'],
    description:
      'Server-to-server endpoints for headless integrations: provision users, enroll learners and manage content programmatically.',
  },
]

const TAG_TO_GROUP = new Map()
for (const group of API_GROUPS) {
  for (const tag of group.tags) TAG_TO_GROUP.set(tag, group)
}

export function groupForTag(tag) {
  return TAG_TO_GROUP.get(tag) || null
}

export function groupBySlug(slug) {
  return API_GROUPS.find((g) => g.slug === slug) || null
}
