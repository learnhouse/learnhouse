// Curated catalog of superadmin endpoints used by the Documentation & Playground tab.
// Each entry feeds both the left-rail list and the right-pane detail/try-it view.

import type { HttpMethod } from '@components/Admin/Developers/snippets'

export type { HttpMethod }

export interface PathParam {
  name: string                       // matches a {placeholder} in pathTemplate
  type: 'string' | 'integer'
  required: boolean
  description?: string
  /** Render hint for the input field. `org_id` swaps the text input for an org picker. */
  picker?: 'org_id'
}

export interface BodyField {
  name: string
  type: string
  required?: boolean
  description?: string
}

export interface EndpointDoc {
  id: string                         // stable id used as React key and in URL hash
  category: string                   // grouping label
  method: HttpMethod
  pathTemplate: string               // path relative to /api/v1, no leading slash; e.g. "ee/superadmin/organizations/{org_id}/plan"
  title: string
  description: string
  pathParams?: PathParam[]
  bodyFields?: BodyField[]
  sampleBody?: unknown
  /** If true the request cannot be made with an API token — only a session-authed superadmin can call it. */
  sessionOnly?: boolean
}

const FULL_TOGGLES_SAMPLE = {
  toggles: {
    ai: { disabled: false, copilot_enabled: true },
    members: { disabled: false, signup_mode: 'open' },
    analytics: { disabled: false },
    api: { disabled: false },
    boards: { disabled: false },
    collaboration: { disabled: false },
    collections: { disabled: false },
    communities: { disabled: false },
    payments: { disabled: false },
    playgrounds: { disabled: false },
    podcasts: { disabled: false },
  },
}

export const ENDPOINTS: EndpointDoc[] = [
  // ─── Organizations ─────────────────────────────────────────────────────────
  {
    id: 'orgs.list',
    category: 'Organizations',
    method: 'GET',
    pathTemplate: 'ee/superadmin/organizations',
    title: 'List organizations',
    description:
      'Paginated list of every organization on the platform, with user/course counts, plan, custom domains, and admin members.',
  },
  {
    id: 'orgs.create',
    category: 'Organizations',
    method: 'POST',
    pathTemplate: 'ee/superadmin/organizations',
    title: 'Create organization',
    description:
      'Provision a brand-new organization. The minting superadmin is auto-linked as admin. In SaaS the plan field is honored; in EE the org is seeded as enterprise.',
    bodyFields: [
      { name: 'name', type: 'string', required: true, description: 'Display name' },
      { name: 'slug', type: 'string', required: true, description: 'URL slug (lowercase, hyphens)' },
      { name: 'email', type: 'string', required: true, description: 'Org contact email' },
      { name: 'description', type: 'string', description: 'Optional description' },
      { name: 'plan', type: 'string', description: 'SaaS only: free | standard | pro | enterprise' },
    ],
    sampleBody: {
      name: 'Acme Learning',
      slug: 'acme-learning',
      email: 'admin@acme.com',
    },
  },
  {
    id: 'orgs.detail',
    category: 'Organizations',
    method: 'GET',
    pathTemplate: 'ee/superadmin/organizations/{org_id}',
    title: 'Get organization detail',
    description:
      "Single organization's full detail: config, plan, custom domains, admin users, user/course counts.",
    pathParams: [{ name: 'org_id', type: 'integer', required: true, picker: 'org_id' }],
  },
  {
    id: 'orgs.courses',
    category: 'Organizations',
    method: 'GET',
    pathTemplate: 'ee/superadmin/organizations/{org_id}/courses',
    title: 'List org courses',
    description: 'Paginated list of courses for a specific organization.',
    pathParams: [{ name: 'org_id', type: 'integer', required: true, picker: 'org_id' }],
  },
  {
    id: 'orgs.users',
    category: 'Organizations',
    method: 'GET',
    pathTemplate: 'ee/superadmin/organizations/{org_id}/users',
    title: 'List org users',
    description: 'Paginated list of users in an organization, with optional search.',
    pathParams: [{ name: 'org_id', type: 'integer', required: true, picker: 'org_id' }],
  },
  {
    id: 'orgs.usage',
    category: 'Organizations',
    method: 'GET',
    pathTemplate: 'ee/superadmin/organizations/{org_id}/usage',
    title: 'Get org usage',
    description: 'Usage and plan limits for an organization (courses, members, admin seats).',
    pathParams: [{ name: 'org_id', type: 'integer', required: true, picker: 'org_id' }],
  },
  {
    id: 'orgs.analytics',
    category: 'Organizations',
    method: 'GET',
    pathTemplate: 'ee/superadmin/organizations/{org_id}/analytics',
    title: 'Get org analytics',
    description: 'Core Tinybird analytics for a single organization over the last N days.',
    pathParams: [{ name: 'org_id', type: 'integer', required: true, picker: 'org_id' }],
  },

  // ─── Features ──────────────────────────────────────────────────────────────
  // No dedicated GET — feature toggles are read via `GET .../config` (config.admin_toggles).
  {
    id: 'features.update',
    category: 'Features',
    method: 'PUT',
    pathTemplate: 'ee/superadmin/organizations/{org_id}/admin_toggles',
    title: 'Update feature toggles',
    description:
      'Replace the full toggles slice — enable or disable features across the org. Send the entire object; partial updates are not supported.',
    pathParams: [{ name: 'org_id', type: 'integer', required: true, picker: 'org_id' }],
    bodyFields: [
      {
        name: 'toggles',
        type: 'object',
        required: true,
        description:
          'Full slice: ai, members, analytics, api, boards, collaboration, collections, communities, payments, playgrounds, podcasts',
      },
    ],
    sampleBody: FULL_TOGGLES_SAMPLE,
  },

  // ─── Plan ──────────────────────────────────────────────────────────────────
  {
    id: 'plan.update',
    category: 'Plan',
    method: 'PUT',
    pathTemplate: 'ee/superadmin/organizations/{org_id}/plan',
    title: 'Update plan',
    description:
      "Move an organization between plan tiers. SaaS-only — returns 400 in EE/OSS mode since plan tiers don't apply (every EE org runs as enterprise).",
    pathParams: [{ name: 'org_id', type: 'integer', required: true, picker: 'org_id' }],
    bodyFields: [
      { name: 'plan', type: 'string', required: true, description: 'free | standard | pro | enterprise' },
    ],
    sampleBody: { plan: 'pro' },
  },

  // ─── Settings ──────────────────────────────────────────────────────────────
  // No dedicated GET — settings (name, slug, email, description) are read via `GET /organizations/{org_id}` (orgs.detail).
  {
    id: 'settings.update',
    category: 'Settings',
    method: 'PUT',
    pathTemplate: 'ee/superadmin/organizations/{org_id}/settings',
    title: 'Update org settings',
    description: "Update name, slug, email, description. Slug uniqueness is enforced.",
    pathParams: [{ name: 'org_id', type: 'integer', required: true, picker: 'org_id' }],
    bodyFields: [
      { name: 'name', type: 'string' },
      { name: 'slug', type: 'string', description: 'Must be unique platform-wide' },
      { name: 'email', type: 'string' },
      { name: 'description', type: 'string' },
    ],
    sampleBody: { name: 'Acme Learning (Renamed)', email: 'newadmin@acme.com' },
  },

  // ─── Config ────────────────────────────────────────────────────────────────
  // No dedicated GET — the full config is included in the `GET /organizations/{org_id}` response (orgs.detail).
  {
    id: 'config.update',
    category: 'Config',
    method: 'PUT',
    pathTemplate: 'ee/superadmin/organizations/{org_id}/config',
    title: 'Replace full config',
    description:
      "Replace an organization's entire config blob. Destructive — overwrites every field. Prefer the targeted endpoints (Features, Plan, Settings) for everyday operations.",
    pathParams: [{ name: 'org_id', type: 'integer', required: true, picker: 'org_id' }],
    bodyFields: [
      { name: 'config', type: 'object', required: true, description: 'Full v2 config object — must include config_version' },
    ],
    sampleBody: {
      config: {
        config_version: '2.0',
        active: true,
        plan: 'enterprise',
        admin_toggles: {
          ai: { disabled: false, copilot_enabled: true },
          members: { disabled: false, signup_mode: 'open' },
          analytics: { disabled: false },
          api: { disabled: false },
          boards: { disabled: false },
          collaboration: { disabled: false },
          collections: { disabled: false },
          communities: { disabled: false },
          payments: { disabled: false },
          playgrounds: { disabled: false },
          podcasts: { disabled: false },
        },
      },
    },
  },

  // ─── Users ─────────────────────────────────────────────────────────────────
  {
    id: 'users.list',
    category: 'Users',
    method: 'GET',
    pathTemplate: 'ee/superadmin/users',
    title: 'List platform users',
    description:
      'Every user across every organization, with paging, sort, search, and is_superadmin / min-orgs / max-orgs filters.',
  },

  // ─── Status ────────────────────────────────────────────────────────────────
  {
    id: 'status.get',
    category: 'Status',
    method: 'GET',
    pathTemplate: 'ee/superadmin/status',
    title: 'Check superadmin status',
    description: 'Returns whether the current credential is a superadmin. Useful as a token-validity probe.',
  },

  // ─── Tokens ────────────────────────────────────────────────────────────────
  {
    id: 'tokens.list',
    category: 'Tokens',
    method: 'GET',
    pathTemplate: 'ee/superadmin/tokens/',
    title: 'List API tokens',
    description: 'Every superadmin API token on the platform — metadata only (the plaintext secret is never returned here).',
  },
  {
    id: 'tokens.mint',
    category: 'Tokens',
    method: 'POST',
    pathTemplate: 'ee/superadmin/tokens/',
    title: 'Mint API token',
    description:
      'Create a new superadmin API token. Session auth only — API tokens cannot mint other tokens (privilege-escalation block).',
    bodyFields: [
      { name: 'name', type: 'string', required: true, description: 'Display name (unique per minting user)' },
      { name: 'description', type: 'string' },
      { name: 'expires_at', type: 'string', description: 'ISO 8601 datetime; omit for "never expires"' },
    ],
    sampleBody: { name: 'my-automation-token' },
    sessionOnly: true,
  },
  {
    id: 'tokens.get',
    category: 'Tokens',
    method: 'GET',
    pathTemplate: 'ee/superadmin/tokens/{token_uuid}',
    title: 'Get API token',
    description: 'Fetch metadata for a single token by uuid.',
    pathParams: [{ name: 'token_uuid', type: 'string', required: true, description: 'e.g. satoken_…' }],
  },
  {
    id: 'tokens.update',
    category: 'Tokens',
    method: 'PATCH',
    pathTemplate: 'ee/superadmin/tokens/{token_uuid}',
    title: 'Update API token',
    description: 'Update name, description, or expires_at. Session auth only.',
    pathParams: [{ name: 'token_uuid', type: 'string', required: true }],
    bodyFields: [
      { name: 'name', type: 'string' },
      { name: 'description', type: 'string' },
      { name: 'expires_at', type: 'string' },
    ],
    sampleBody: { description: 'Updated description' },
    sessionOnly: true,
  },
  {
    id: 'tokens.revoke',
    category: 'Tokens',
    method: 'DELETE',
    pathTemplate: 'ee/superadmin/tokens/{token_uuid}',
    title: 'Revoke API token',
    description: 'Soft-revoke a token (is_active=false). Session auth only.',
    pathParams: [{ name: 'token_uuid', type: 'string', required: true }],
    sessionOnly: true,
  },
]

export const CATEGORIES: string[] = (() => {
  const seen: string[] = []
  for (const e of ENDPOINTS) if (!seen.includes(e.category)) seen.push(e.category)
  return seen
})()
