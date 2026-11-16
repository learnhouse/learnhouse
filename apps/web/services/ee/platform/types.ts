// Shapes of the platform console API (`/api/v1/ee/superadmin/*`). They follow
// the superadmin v2 contract; every field the backend may still be adding is
// optional so the console renders against an older API without crashing.

export type PlatformRole = 'owner' | 'admin' | 'support' | 'sales' | 'viewer'

export const PLATFORM_ROLES: PlatformRole[] = ['owner', 'admin', 'support', 'sales', 'viewer']

export type PlatformPermission =
  | 'platform.read'
  | 'audit.read'
  | 'notes.write'
  | 'pocs.manage'
  | 'orgs.create'
  | 'orgs.update'
  | 'orgs.config'
  | 'orgs.plan'
  | 'orgs.lifecycle'
  | 'users.manage'
  | 'automations.manage'
  | 'automations.run'
  | 'tokens.manage'
  | 'team.manage'
  | 'export.data'
  | 'notifications.manage'
  | 'emails.send'
  | 'impersonation.readonly'
  | 'impersonation.full'

export const ALL_PERMISSIONS: PlatformPermission[] = [
  'platform.read',
  'audit.read',
  'notes.write',
  'pocs.manage',
  'orgs.create',
  'orgs.update',
  'orgs.config',
  'orgs.plan',
  'orgs.lifecycle',
  'users.manage',
  'automations.manage',
  'automations.run',
  'tokens.manage',
  'team.manage',
  'export.data',
  'notifications.manage',
  'emails.send',
  'impersonation.readonly',
  'impersonation.full',
]

// The role matrix from the spec, used when the API's GET /team does not send
// `roles` (older backend) so the Team page can still draw it.
export const DEFAULT_ROLE_PERMISSIONS: Record<PlatformRole, PlatformPermission[]> = {
  owner: ALL_PERMISSIONS,
  admin: ALL_PERMISSIONS.filter((p) => p !== 'team.manage' && p !== 'impersonation.full'),
  support: ['platform.read', 'audit.read', 'notes.write', 'orgs.update', 'users.manage', 'automations.run', 'tokens.manage', 'impersonation.readonly'],
  // Fallback only: the Team page matrix and /me come from the API.
  sales: ['platform.read', 'audit.read', 'notes.write', 'pocs.manage', 'orgs.create', 'orgs.update', 'orgs.plan', 'orgs.lifecycle', 'automations.run', 'tokens.manage', 'export.data', 'emails.send', 'impersonation.readonly'],
  viewer: ['platform.read', 'tokens.manage'],
}

export type Lifecycle = 'active' | 'trial' | 'poc' | 'suspended' | 'closed' | 'pending_deletion'
export const LIFECYCLES: Lifecycle[] = ['active', 'trial', 'poc', 'suspended', 'closed', 'pending_deletion']

export type PlanKey = 'free' | 'standard' | 'pro' | 'enterprise'
export const PLANS: PlanKey[] = ['free', 'standard', 'pro', 'enterprise']

export type PocOutcome = 'won' | 'lost' | 'expired' | null

export interface PlatformMe {
  user_id: number
  username: string
  email: string
  avatar_image?: string | null
  user_uuid: string
  role: PlatformRole | string
  permissions: PlatformPermission[]
}

export interface UserMini {
  id: number
  username: string
  email: string
  avatar_image?: string | null
  user_uuid: string
  is_superadmin?: boolean
}

export interface AccountOwner {
  user_id?: number
  id?: number
  username: string
  email?: string
  avatar_image?: string | null
  user_uuid?: string
}

export interface OrgMini {
  id: number
  name: string
  slug: string
  org_uuid: string
  logo_image?: string | null
  plan?: string
  lifecycle?: Lifecycle | string
  tags?: string[]
  health_score?: number | null
}

export interface PocFields {
  poc_started_at?: string | null
  poc_ends_at?: string | null
  poc_plan?: string | null
  poc_previous_plan?: string | null
  poc_goal?: string | null
  poc_contact_name?: string | null
  poc_contact_email?: string | null
  poc_outcome?: PocOutcome | string
  poc_extensions?: number
  /** When the POC ended or converted (newer APIs). */
  // When the POC was converted or ended (API: from the audit trail, closed_at for older rows).
  poc_ended_at?: string | null
  account_owner?: AccountOwner | null
}

export type PocOrg = OrgMini & PocFields & { closed_at?: string | null; closed_reason?: string | null }

export interface OrgProfile extends PocFields {
  org_id: number
  lifecycle: Lifecycle | string
  tags: string[]
  account_owner_user_id?: number | null
  closed_at?: string | null
  closed_reason?: string | null
  /** Set while lifecycle is pending_deletion (§11). */
  deletion_scheduled_at?: string | null
  deletion_reason?: string | null
  deletion_requested_by?: string | null
  health_score?: number | null
  health_computed_at?: string | null
  last_activity_at?: string | null
  updated_at?: string | null
}

export interface AdminUserInfo {
  username: string
  email: string
  avatar_image: string | null
  user_uuid: string
}

export interface OrgListItem {
  id: number
  org_uuid: string
  name: string
  slug: string
  description: string | null
  email: string
  logo_image: string | null
  thumbnail_image?: string | null
  creation_date: string
  update_date: string
  user_count: number
  course_count: number
  plan: string
  custom_domains: string[]
  admin_users: AdminUserInfo[]
  lifecycle?: Lifecycle | string
  tags?: string[]
  health_score?: number | null
  poc_ends_at?: string | null
  account_owner?: AccountOwner | null
}

export interface Paginated<T> {
  items: T[]
  total: number
  page?: number
  limit?: number
}

export interface AuditEvent {
  id: number
  created_at: string
  actor_kind: 'session' | 'token' | 'mcp' | 'automation' | 'system' | string
  actor_user_id?: number | null
  actor_label?: string | null
  action: string
  target_type?: string | null
  target_id?: string | null
  org_id?: number | null
  org_name?: string | null
  summary: string
  details?: Record<string, unknown> | null
  ip?: string | null
}

export interface RunMini {
  id: number
  automation_id?: number
  automation_uuid?: string
  automation_name?: string
  started_at: string
  finished_at?: string | null
  trigger: 'schedule' | 'manual' | 'preview' | string
  status: 'ok' | 'partial' | 'failed' | 'skipped' | string
  matched?: number
  acted?: number
  dry_run?: boolean
  error?: string | null
}

export interface AutomationRunResult {
  org_id: number
  org_name: string
  plan?: string
  actions: { type: string; ok: boolean; message?: string }[]
}

export interface AutomationRun extends RunMini {
  actor_user_id?: number | null
  actor_label?: string | null
  results?: AutomationRunResult[]
}

export interface Overview {
  kpis: {
    orgs_total: number
    orgs_new: number
    users_total: number
    users_new: number
    active_orgs_7d: number
    paid_orgs: number
    pocs_active: number
    pocs_ending_7d: number
  }
  plan_distribution: { plan: string; count: number }[]
  signups_series: { date: string; orgs: number; users: number }[]
  pocs_ending: PocOrg[]
  at_risk: (OrgMini & { health_score?: number | null })[]
  recent_activity: AuditEvent[]
  automation_failures: RunMini[]
}

export interface SearchResults {
  orgs: OrgMini[]
  users: UserMini[]
}

export interface SystemStatus {
  version?: string
  deployment_mode?: string
  license?: Record<string, unknown>
  db_ok?: boolean
  redis_ok?: boolean
  migrations_head?: string | null
  scheduler?: { enabled?: boolean; running?: boolean; last_tick_at?: string | null; last_ran?: number | null; interval_seconds?: number | null }
  /** The notifications/deletions/campaigns worker (every minute). */
  worker?: { enabled?: boolean; running?: boolean; last_tick_at?: string | null; failed_steps?: string[] | number | null; interval_seconds?: number | null }
  mcp?: { enabled?: boolean; url?: string | null; path?: string | null }
}

export interface TeamMember {
  user_id: number
  username: string
  email: string
  avatar_image?: string | null
  user_uuid: string
  role: PlatformRole | string
  granted_by?: string | number | { username?: string } | null
  created_at?: string | null
  note?: string | null
  is_you?: boolean
  /** Support-session (impersonation) access: the effective level, the role's default, and the per-member override. */
  impersonation?: { level: ImpersonationLevel; default: ImpersonationLevel; override: ImpersonationLevel | null }
}

export type ImpersonationLevel = 'none' | 'readonly' | 'full'

export interface TeamResponse {
  members: TeamMember[]
  roles?: { key: PlatformRole | string; permissions: PlatformPermission[] }[]
}

export interface OrgNote {
  id: number
  org_id: number
  author_user_id?: number | null
  author_label?: string | null
  body: string
  pinned: boolean
  kind: 'note' | 'call' | 'email' | 'system' | string
  created_at: string
  updated_at?: string | null
}

export interface AutomationCondition {
  field: string
  op: string
  value?: unknown
}

export interface AutomationAction {
  type: string
  params?: Record<string, unknown>
}

export type Schedule = 'hourly' | 'daily' | 'weekly'

export interface Automation {
  id?: number
  automation_uuid: string
  name: string
  description?: string | null
  enabled: boolean
  template?: string | null
  trigger?: 'schedule' | 'event' | string
  event_types?: string[]
  /** Event rules: run again when the same event repeats for an org. */
  allow_repeats?: boolean
  schedule: Schedule | string
  conditions: AutomationCondition[]
  actions: AutomationAction[]
  dry_run: boolean
  max_actions_per_run?: number
  created_by_user_id?: number | null
  created_at?: string
  updated_at?: string
  last_run_at?: string | null
  last_run_status?: string | null
  last_run?: RunMini | null
}

export interface AutomationTemplate {
  key: string
  name: string
  description: string
  schedule: Schedule | string
  conditions: AutomationCondition[]
  actions: AutomationAction[]
  /** `schedule` (default) or `event` (runs when one of `event_types` happens). */
  trigger?: 'schedule' | 'event' | string
  event_types?: string[]
}

export interface SchemaField {
  key: string
  type: 'string' | 'number' | 'integer' | 'boolean' | 'list' | 'enum' | string
  label?: string
  ops: string[]
  options?: string[]
  /** Enum choices as the live API sends them (older drafts used `options`). */
  values?: string[]
}

export interface SchemaActionParam {
  type?: string
  enum?: string[]
  items?: { type?: string; enum?: string[] }
  default?: unknown
  description?: string
  maxLength?: number
  min?: number
  max?: number
  // Array-shaped params (live API): [{key, type, label, required, max_length?, values?}]
  key?: string
  label?: string
  required?: boolean
  max_length?: number
  values?: string[]
}

export interface SchemaAction {
  type: string
  label?: string
  /** Only owners may add it (schedule_org_deletion). */
  owner_only?: boolean
  description?: string | null
  params?:
    | SchemaActionParam[]
    | Record<string, SchemaActionParam>
    | { properties?: Record<string, SchemaActionParam>; required?: string[] }
}

export interface AutomationSchema {
  fields: SchemaField[]
  actions: SchemaAction[]
  schedules: (Schedule | string)[]
  max_actions_per_run_cap?: number
  /** Rule size caps (API defaults: 20 conditions, 10 actions). */
  max_conditions?: number
  max_actions?: number
  triggers?: string[]
  /** Event keys an event-triggered rule can listen to. */
  events?: string[]
}

export interface PreviewResult {
  matched: { org_id: number; org_name: string; plan?: string; would: string[] }[]
  total: number
  acted?: number
  notified?: number
  /** Set for event rules previewed without an org: explains the real scope. */
  note?: string | null
}

export type TokenScope = 'api' | 'mcp' | 'mcp:write'
export const TOKEN_SCOPES: TokenScope[] = ['api', 'mcp', 'mcp:write']

export interface SuperadminToken {
  id: number
  token_uuid: string
  name: string
  description: string | null
  token_prefix: string
  created_by_user_id: number
  creation_date: string
  update_date: string
  last_used_at: string | null
  expires_at: string | null
  is_active: boolean
  role?: PlatformRole | string
  scopes?: TokenScope[] | string[]
}

export interface CreatedToken {
  token: string
  token_uuid: string
  name: string
  description: string | null
  token_prefix: string
  created_by_user_id: number
  creation_date: string
  expires_at: string | null
  role?: string
  scopes?: string[]
}

// ── unified audit log (§8) ──────────────────────────────────────────────────

export type AuditSource = 'org' | 'platform'

export interface UnifiedEvent {
  id: string
  source: AuditSource | string
  created_at: string
  org_id?: number | null
  org_name?: string | null
  actor_user_id?: number | null
  actor_label?: string | null
  actor_email?: string | null
  actor_role?: string | null
  actor_kind?: string | null
  via?: string | null
  action: string
  category?: string | null
  outcome?: string | null
  target_type?: string | null
  target_id?: string | null
  target_name?: string | null
  summary?: string | null
  /** Human title from the API ("Signed in", "Course updated"). */
  title?: string | null
  ip?: string | null
  user_agent?: string | null
  method?: string | null
  path?: string | null
  status_code?: number | null
  request_id?: string | null
  details?: Record<string, unknown> | null
  changes?: Record<string, unknown> | unknown[] | null
}

export interface FacetCount {
  value: string
  count: number
  label?: string
}

export interface UnifiedFacets {
  sources?: FacetCount[] | Record<string, number>
  categories?: FacetCount[] | Record<string, number>
  outcomes?: FacetCount[] | Record<string, number>
  vias?: FacetCount[] | Record<string, number>
  actions?: FacetCount[] | Record<string, number>
  orgs?: { id: number; name: string; count: number }[]
  actors?: { user_id: number; label: string; count: number }[]
}

/** Facet counts as list endpoints return them: `{plan: {free: 3}}` or `{plan: [{value, count}]}`. */
export type ListFacets = Record<string, FacetCount[] | Record<string, number> | undefined>

// ── in-app inbox (§9.3) ─────────────────────────────────────────────────────

export interface InboxItem {
  id: number
  event_key?: string
  title: string
  body?: string | null
  severity?: 'info' | 'success' | 'warning' | 'critical' | string
  link?: string | null
  org_id?: number | null
  read_at?: string | null
  created_at: string
}

// GET /users/{user_id} (§10.2). Loose on purpose: every block is optional so a
// partial or older response still renders.
export interface UserDetailOrg {
  id: number
  name: string
  slug?: string
  org_uuid?: string
  logo_image?: string | null
  role?: string | null
  role_name?: string | null
  plan?: string | null
  lifecycle?: string | null
  joined_at?: string | null
}

export interface UserDetail {
  id: number
  user_id?: number
  username: string
  email: string
  first_name?: string | null
  last_name?: string | null
  avatar_image?: string | null
  user_uuid?: string
  email_verified?: boolean | null
  signup_method?: string | null
  creation_date?: string | null
  created_at?: string | null
  last_login_at?: string | null
  is_superadmin?: boolean
  platform_role?: string | null
  team?: { role?: string | null } | null
  orgs?: UserDetailOrg[]
  organizations?: UserDetailOrg[]
  activity?: UnifiedEvent[]
  account_owner_of?: (OrgMini & { plan?: string })[]
  recent_events?: UnifiedEvent[]
  recent_activity?: UnifiedEvent[]
  pocs?: (PocOrg & { org_id?: number; org_name?: string })[]
  owned_pocs?: (PocOrg & { org_id?: number; org_name?: string })[]
  tasks?: { task_uuid?: string; uuid?: string; title?: string; status?: string; due_at?: string | null; org_id?: number | null; org_name?: string | null }[]
  follows?: { org_id?: number; org_name?: string; name?: string; level?: string | null }[]
  counts?: Record<string, number>
}

// ── AI costs (provider cost vs credits charged) ─────────────────────────────

export interface AIMargin {
  credits: number
  value_usd: number
  cost_usd: number
  /** Charged value / provider cost (2.0 = cost is half the value). null when free. */
  margin_multiple: number | null
  gross_margin_pct: number | null
  below_floor: boolean
}

export interface AICostFeatureRow extends AIMargin {
  feature: string
  label: string
  requests: number
  published_credits: number | null
  metered: boolean | null
  /** Platform work we don't charge for (no margin to keep). */
  absorbed?: boolean
}

export interface AICostOrgRow extends AIMargin {
  org_id: number
  org_name: string | null
  requests: number
}

export interface AICostDayRow extends AIMargin {
  date: string
  requests: number
}

export interface AIModelPrice {
  model: string
  input_per_m: number
  output_per_m: number
  cached_input_per_m: number | null
  audio_input_per_m: number | null
  image_output_per_m: number | null
  audio_output_per_m: number | null
  planning_input_per_m: number
  planning_output_per_m: number
  source: string
}

export interface AIFeaturePrice {
  key: string
  label: string
  credits: number
  unit: string
  metered: boolean
  group: string
  edition: string
  note?: string
  absorbed?: boolean
  value_usd?: number
  p90_cost_usd?: number
  p90_margin_multiple?: number | null
}

export interface AIPricing {
  credit_value_usd: number
  credit_value_source: string
  margin_floor: number
  prices_as_of: string
  price_source: string
  features: AIFeaturePrice[]
  models: AIModelPrice[]
}

export interface AICostsOverview {
  from: string
  to: string
  days: number
  totals: AIMargin & { requests: number }
  by_feature: AICostFeatureRow[]
  by_org: AICostOrgRow[]
  by_day: AICostDayRow[]
  pricing: AIPricing
  unmetered: { model: string; calls: number; cost_usd: number }[]
  alert?: { window_days: number; min_requests: number }
}

export interface OrgAICosts {
  org_id: number
  days: number
  margin_floor: number
  from: string
  to: string
  totals: AIMargin & { requests: number }
  by_feature: AICostFeatureRow[]
  by_day: AICostDayRow[]
  by_member: {
    user_id: number | null
    username: string | null
    first_name: string | null
    last_name: string | null
    avatar_image: string | null
    user_uuid: string | null
    credits: number
    requests: number
  }[]
}

// ── org branding + configuration (GET /organizations/{id}/configuration) ────

export type OrgImageSlot = 'logo' | 'square_logo' | 'favicon' | 'thumbnail' | 'og_image' | 'auth_background' | 'preview'

export interface OrgConfigTheme {
  preset: string
  accent_mode: 'neutral' | 'brand' | 'custom'
  accent_color: string
  header_style: 'brand' | 'white' | 'dark' | 'glass'
  radius: 'none' | 'soft' | 'sharp' | 'round'
  heading_font: string
  button_style: 'solid' | 'soft' | 'outline'
  card_style: 'shadow' | 'border' | 'flat'
  density: 'comfortable' | 'compact'
  background: 'tint' | 'plain' | 'pattern' | 'grid' | 'gradient'
  // Theme studio options (optional: older API responses lack them).
  secondary_color?: string
  neutral?: 'neutral' | 'warm' | 'cool'
  type_scale?: 'compact' | 'default' | 'large'
  heading_weight?: '' | '500' | '600' | '700' | '800'
  button_shape?: 'auto' | 'square' | 'rounded' | 'pill'
  elevation?: 'flat' | 'default' | 'lifted'
  link_style?: 'accent' | 'underline' | 'subtle'
  header_layout?: 'standard' | 'centered' | 'minimal'
  footer_style?: 'simple' | 'centered' | 'bar'
  image_style?: 'default' | 'rounded' | 'framed' | 'muted'
  public_scheme?: 'visitor' | 'light'
  dark_accent?: string
}

export interface OrgMenuItem {
  type: string
  enabled: boolean
  order: number
  label: string
  url: string
  icon: string
}

export interface OrgConfiguration {
  org: {
    id: number
    org_uuid: string
    is_demo: boolean
    name: string
    slug: string
    email: string
    description: string | null
    about: string | null
    label: string | null
    explore: boolean | null
    socials: Record<string, string> | null
    links: Record<string, string> | null
    logo_image: string | null
    thumbnail_image: string | null
    previews: { images?: { filename: string; order?: number }[]; videos?: unknown[] } | null
  }
  config_version: string
  is_v2: boolean
  plan: string
  images: Record<Exclude<OrgImageSlot, 'preview'>, string> & { preview: string[] }
  general: {
    color: string
    footer_text: string
    favicon_image: string
    square_logo_image: string
    watermark: boolean
    font: string
    default_language: string
    email_sender_name: string
  }
  theme: OrgConfigTheme
  auth_branding: { welcome_message: string; background_type: 'gradient' | 'custom' | 'unsplash'; background_image: string; text_color: 'light' | 'dark' }
  seo: Record<string, string | boolean>
  menu: { items: OrgMenuItem[] }
  course_end: { message: string; button_text: string; button_link: string }
  signup_fields: { key: string; label: string; type: string; required: boolean; enabled: boolean }[]
  landing_pages: { slug: string; title: string; published: boolean; published_at: string | null }[]
  signup_mode: 'open' | 'inviteOnly' | null
  admin_toggles: Record<string, Record<string, unknown>>
  security: {
    require_2fa?: boolean
    require_2fa_grace_days?: number
    exempt_external_auth?: boolean
    allowed_auth_methods?: string[]
    allow_central_session_sharing?: boolean
  }
  org_features: string[]
  resolved_features: Record<string, { enabled?: boolean; available?: boolean; disabled_by?: string | null; limit?: number }>
  sso: { provider: string; enabled: boolean; domains: string[]; auto_provision_users: boolean }[]
  custom_domains: { domain: string; status: string; primary: boolean; verified_at: string | null }[]
  languages: string[]
  config: Record<string, unknown>
}

export interface OrgConfigWriteResult {
  status: string
  changes: Record<string, { from: unknown; to: unknown }>
  configuration: OrgConfiguration
}
