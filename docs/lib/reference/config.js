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
 *
 * `access` mirrors the router-level auth wiring in apps/api/src/router.py:
 *   'token'          — accepts lh_ API tokens or a user session
 *   'token-required' — API token only (the headless /admin surface)
 *   'session'        — user session only, API tokens are rejected
 *   'public'         — credential/public endpoints (login, refresh, …)
 * `rightsBucket` is the API-token rights bucket enforced by the RBAC layer
 * (apps/api/src/security/rbac/rbac.py) — the docs derive the required action
 * from the HTTP method (GET → read, POST → create, PUT/PATCH → update,
 * DELETE → delete).
 */
export const API_GROUPS = [
  {
    slug: 'auth',
    title: 'Authentication',
    tags: ['auth'],
    access: 'public',
    rightsBucket: null,
    description:
      'Login, token refresh, logout, OAuth and email verification. Login is form-encoded and returns a JWT for user-context flows.',
  },
  {
    slug: 'api-tokens',
    title: 'API Tokens',
    tags: ['api-tokens', 'api_tokens'],
    access: 'session',
    rightsBucket: null,
    description:
      'Create and manage lh_ organization API tokens with scoped rights. The full token value is only returned once, at creation. Session-only: a token cannot mint other tokens.',
  },
  {
    slug: 'orgs',
    title: 'Organizations',
    tags: ['orgs'],
    access: 'session',
    rightsBucket: null,
    description:
      'Organization CRUD, members, invites, configuration, branding and SEO settings.',
  },
  {
    slug: 'users',
    title: 'Users',
    tags: ['users'],
    access: 'session',
    rightsBucket: null,
    description: 'User accounts, profiles, session info and password management.',
  },
  {
    slug: 'usergroups',
    title: 'User Groups',
    tags: ['usergroups'],
    access: 'token',
    rightsBucket: 'usergroups',
    description: 'Group learners together for cohort management and access control.',
  },
  {
    slug: 'courses',
    title: 'Courses',
    tags: ['courses'],
    access: 'token',
    rightsBucket: 'courses',
    description:
      'Course CRUD, cloning, export/import and contributor management. Create and update endpoints accept multipart form data.',
  },
  {
    slug: 'chapters',
    title: 'Chapters',
    tags: ['chapters'],
    access: 'token',
    rightsBucket: 'coursechapters',
    description: 'Chapter CRUD and ordering within courses.',
  },
  {
    slug: 'activities',
    title: 'Activities',
    tags: ['activities'],
    access: 'token',
    rightsBucket: 'activities',
    description:
      'Individual content units within chapters: dynamic pages, videos, documents, assignments and SCORM packages.',
  },
  {
    slug: 'blocks',
    title: 'Blocks',
    tags: ['blocks'],
    access: 'session',
    rightsBucket: null,
    description: 'Content blocks within dynamic page activities.',
  },
  {
    slug: 'assignments',
    title: 'Assignments',
    tags: ['assignments'],
    access: 'token',
    rightsBucket: 'assignments',
    description:
      'Assignment authoring, tasks, submissions and grading — fully drivable headlessly with an API token. Learner-side "/me" and submission endpoints remain session-only.',
  },
  {
    slug: 'folders',
    title: 'Folders',
    tags: ['folders'],
    access: 'token',
    rightsBucket: 'folders',
    description: 'Content folders used to organize and group courses (collections).',
  },
  {
    slug: 'media',
    title: 'Media',
    tags: ['media'],
    access: 'token',
    rightsBucket: 'media',
    description: 'Upload and manage media assets.',
  },
  {
    slug: 'certifications',
    title: 'Certifications',
    tags: ['certifications'],
    access: 'token',
    rightsBucket: 'certifications',
    description: 'Certificate generation and management for course completion.',
  },
  {
    slug: 'payments',
    title: 'Payments',
    tags: ['payments'],
    access: 'token',
    rightsBucket: 'payments',
    description:
      'Products, prices, checkout and enrollment via the open payments API, including bring-your-own provider.',
  },
  {
    slug: 'search',
    title: 'Search',
    tags: ['search'],
    access: 'token',
    rightsBucket: 'search',
    description: 'Full-text search across courses and content. Tokens need the search read right.',
  },
  {
    slug: 'analytics',
    title: 'Analytics',
    tags: ['analytics'],
    access: 'session',
    rightsBucket: null,
    description: 'Course analytics and usage metrics.',
  },
  {
    slug: 'webhooks',
    title: 'Webhooks',
    tags: ['webhooks'],
    access: 'session',
    rightsBucket: null,
    description: 'Register HTTP endpoints that receive event notifications from LearnHouse.',
  },
  {
    slug: 'headless',
    title: 'Headless',
    tags: ['admin'],
    access: 'token-required',
    rightsBucket: null,
    description:
      'Server-to-server endpoints for headless integrations: provision users, enroll learners and manage content programmatically. These endpoints require an lh_ API token.',
  },
]

/** Required token action per HTTP method (mirrors the RBAC action names). */
export const METHOD_TO_ACTION = {
  GET: 'read',
  POST: 'create',
  PUT: 'update',
  PATCH: 'update',
  DELETE: 'delete',
}

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
