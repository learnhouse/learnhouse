import { saRequest } from './api'
import type { OrgMini, Paginated, UnifiedEvent, FacetCount } from './types'

// Client for the §9 / §11 console APIs: notifications (channels, rules,
// deliveries, inbox, preferences), follows, tasks, org timeline, deletions,
// signals, platform settings, email templates and campaigns. Shapes follow
// superadmin/API_NOTES.md; fields a server may still be adding are optional.

type Query = Record<string, string | number | boolean | null | undefined | string[]>

// ── notifications ───────────────────────────────────────────────────────────

export type ChannelKind = 'discord' | 'notion' | 'slack' | 'webhook' | 'email'
export const CHANNEL_KINDS: ChannelKind[] = ['discord', 'slack', 'notion', 'webhook', 'email']

export interface NotificationEvent {
  key: string
  label: string
  severity?: 'info' | 'success' | 'warning' | 'critical' | string
  group?: string
  sample?: Record<string, unknown>
}

export interface Channel {
  channel_uuid: string
  name: string
  kind: ChannelKind | string
  enabled: boolean
  config: Record<string, unknown>
  created_by_user_id?: number | null
  created_at?: string
  updated_at?: string
  last_delivery_at?: string | null
  last_error?: string | null
  failure_count?: number
  disabled_reason?: string | null
  path?: string
}

export interface ChannelTestResult {
  ok: boolean
  detail?: string
  database_title?: string
  missing?: string[]
  wrong_type?: { name: string; expected: string; found: string }[]
}

export type RuleMode = 'instant' | 'digest_hourly' | 'digest_daily'
export const RULE_MODES: RuleMode[] = ['instant', 'digest_hourly', 'digest_daily']

export interface RuleFilters {
  plan?: string[]
  tags_any?: string[]
  org_ids?: number[]
  lifecycle?: string[]
  severity_min?: string
}

export interface Rule {
  rule_uuid: string
  name: string
  enabled: boolean
  channel_uuid?: string | null
  channel_name?: string | null
  channel_kind?: string | null
  event_types: string[]
  filters: RuleFilters
  mode: RuleMode | string
  quiet_hours?: { start: string; end: string } | null
  inbox_roles?: string[]
  created_by_user_id?: number | null
  created_at?: string
  updated_at?: string
}

export type DeliveryStatus = 'queued' | 'sent' | 'failed' | 'skipped' | 'digest' | 'batched'
export const DELIVERY_STATUSES: DeliveryStatus[] = ['queued', 'sent', 'failed', 'skipped', 'digest', 'batched']

export interface Delivery {
  id: number
  rule_uuid?: string | null
  rule_name?: string | null
  channel_uuid?: string | null
  channel_name?: string | null
  channel_kind?: string | null
  recipient_user_id?: number | null
  event_key: string
  org_id?: number | null
  org_name?: string | null
  status: DeliveryStatus | string
  attempts?: number
  next_attempt_at?: string | null
  error?: string | null
  payload?: Record<string, unknown> | null
  created_at: string
  sent_at?: string | null
  path?: string
}

export interface InboxEntry {
  id: number
  event_key?: string
  title: string
  body?: string | null
  severity?: string
  link?: string | null
  org_id?: number | null
  read_at?: string | null
  created_at: string
}

export type PrefValue = 'inbox' | 'email' | 'off'
export interface Preferences {
  groups: Record<string, PrefValue | string>
  daily_digest: boolean
  values?: string[]
}

export const getEventCatalog = (token?: string) => saRequest<NotificationEvent[]>('/notifications/events', token)

export const listChannels = (token?: string, query?: Query) => saRequest<Channel[]>('/notifications/channels', token, { query })
export const createChannel = (token: string | undefined, body: { name: string; kind: string; config: Record<string, unknown>; enabled?: boolean }) =>
  saRequest<Channel>('/notifications/channels', token, { method: 'POST', body })
export const updateChannel = (token: string | undefined, uuid: string, body: { name?: string; config?: Record<string, unknown>; enabled?: boolean }) =>
  saRequest<Channel>(`/notifications/channels/${uuid}`, token, { method: 'PUT', body })
export const deleteChannel = (token: string | undefined, uuid: string) => saRequest(`/notifications/channels/${uuid}`, token, { method: 'DELETE' })
export const testChannel = (token: string | undefined, uuid: string) =>
  saRequest<ChannelTestResult>(`/notifications/channels/${uuid}/test`, token, { method: 'POST' })
export const setupNotion = (token: string | undefined, uuid: string) =>
  saRequest<{ ok: boolean; detail?: string; created?: string[] }>(`/notifications/channels/${uuid}/notion/setup`, token, { method: 'POST' })

export const listRules = (token?: string) => saRequest<Rule[]>('/notifications/rules', token)
export type RuleBody = Partial<Omit<Rule, 'rule_uuid' | 'channel_name' | 'channel_kind' | 'created_at' | 'updated_at' | 'created_by_user_id'>>
export const createRule = (token: string | undefined, body: RuleBody) => saRequest<Rule>('/notifications/rules', token, { method: 'POST', body })
export const updateRule = (token: string | undefined, uuid: string, body: RuleBody) =>
  saRequest<Rule>(`/notifications/rules/${uuid}`, token, { method: 'PUT', body })
export const deleteRule = (token: string | undefined, uuid: string) => saRequest(`/notifications/rules/${uuid}`, token, { method: 'DELETE' })

export const listDeliveries = (token: string | undefined, query: Query) =>
  saRequest<Paginated<Delivery> & { facets?: { status?: FacetCount[] } }>('/notifications/deliveries', token, { query })
export const getDelivery = (token: string | undefined, id: number | string) => saRequest<Delivery>(`/notifications/deliveries/${id}`, token)
export const retryDelivery = (token: string | undefined, id: number | string) =>
  saRequest<Delivery>(`/notifications/deliveries/${id}/retry`, token, { method: 'POST' })

export const listInbox = (token: string | undefined, query: Query) =>
  saRequest<Paginated<InboxEntry> & { unread?: number }>('/notifications/inbox', token, { query })
export const markRead = (token: string | undefined, body: { ids?: number[]; all?: boolean }) =>
  saRequest<{ ok: boolean; marked: number; unread: number }>('/notifications/inbox/read', token, { method: 'POST', body })

export const getPreferences = (token?: string) => saRequest<Preferences>('/notifications/preferences', token)
export const updatePreferences = (token: string | undefined, body: Partial<Pick<Preferences, 'groups' | 'daily_digest'>>) =>
  saRequest<Preferences>('/notifications/preferences', token, { method: 'PUT', body })

// ── follows ─────────────────────────────────────────────────────────────────

export type FollowLevel = 'all' | 'important' | 'custom'
export const FOLLOW_LEVELS: FollowLevel[] = ['all', 'important', 'custom']

// Follow event keys (custom level), split by the API's importance.
export const FOLLOW_KEYS_IMPORTANT = [
  'plan_changed',
  'lifecycle_changed',
  'poc_events',
  'courses_published',
  'courses_deleted',
  'members_left',
  'roles_changed',
  'domains_changed',
  'security_events',
  'data_exported',
  'content_wiped',
] as const
export const FOLLOW_KEYS_ALL = [
  'courses_created',
  'courses_updated',
  'content_updated',
  'members_joined',
  'members_invited',
  'settings_updated',
  'integrations_changed',
  'groups_changed',
  'ai_usage',
  'notes_added',
  'automation_actions',
] as const

export interface Follow {
  org_id: number
  user_id?: number
  level: FollowLevel | string
  event_types: string[]
  deliver_inbox: boolean
  deliver_email: boolean
  channel_uuid?: string | null
  created_at?: string
  updated_at?: string
  org?: OrgMini
  unread?: number
  pending?: number
}

export interface FollowBody {
  level: FollowLevel
  event_types?: string[]
  deliver_inbox: boolean
  deliver_email: boolean
  channel_uuid?: string | null
}

export interface Follower {
  user_id: number
  username: string
  email?: string
  avatar_image?: string | null
  user_uuid?: string
  level: string
  since?: string
  path?: string
}

export const listFollows = (token?: string) => saRequest<Follow[]>('/follows', token)
export const followOrg = (token: string | undefined, orgId: number | string, body: FollowBody) =>
  saRequest<Follow>(`/organizations/${orgId}/follow`, token, { method: 'PUT', body })
export const unfollowOrg = (token: string | undefined, orgId: number | string) => saRequest(`/organizations/${orgId}/follow`, token, { method: 'DELETE' })
export const listFollowers = (token: string | undefined, orgId: number | string) => saRequest<Follower[]>(`/organizations/${orgId}/followers`, token)
export const getFollowFeed = (token: string | undefined, query: Query) =>
  saRequest<Paginated<UnifiedEvent> & { following?: number; redacted?: boolean }>('/follows/feed', token, { query })

// ── tasks ───────────────────────────────────────────────────────────────────

export interface TaskPerson {
  user_id?: number
  id?: number
  username: string
  email?: string
  avatar_image?: string | null
  user_uuid?: string
}

export interface Task {
  task_uuid: string
  org_id?: number | null
  org?: OrgMini | null
  title: string
  notes?: string | null
  due_at?: string | null
  overdue?: boolean
  assignee_user_id?: number | null
  assignee?: TaskPerson | null
  status: 'open' | 'done' | string
  created_by_user_id?: number | null
  created_from?: string | null
  created_at?: string
  updated_at?: string
  done_at?: string | null
  path?: string
}

export interface TaskBody {
  title?: string
  org_id?: number | null
  notes?: string | null
  due_at?: string | null
  assignee_user_id?: number | null
  status?: 'open' | 'done'
}

export const listTasks = (token: string | undefined, query: Query) =>
  saRequest<Paginated<Task> & { facets?: { status?: FacetCount[]; overdue?: number } }>('/tasks', token, { query })
export const getTask = (token: string | undefined, uuid: string) => saRequest<Task>(`/tasks/${uuid}`, token)
export const createTask = (token: string | undefined, body: TaskBody) => saRequest<Task>('/tasks', token, { method: 'POST', body })
export const updateTask = (token: string | undefined, uuid: string, body: TaskBody) => saRequest<Task>(`/tasks/${uuid}`, token, { method: 'PUT', body })
export const deleteTask = (token: string | undefined, uuid: string) => saRequest(`/tasks/${uuid}`, token, { method: 'DELETE' })

// ── org timeline ────────────────────────────────────────────────────────────

export type TimelineKind = 'note' | 'task' | 'poc' | 'platform' | 'org'
export const TIMELINE_KINDS: TimelineKind[] = ['note', 'task', 'poc', 'platform', 'org']

export interface TimelineItem {
  kind: TimelineKind | string
  id: string | number
  at: string
  title: string
  body?: string | null
  actor_label?: string | null
  actor_user_id?: number | null
  path?: string | null
}

export const getTimeline = (token: string | undefined, orgId: number | string, query: Query) =>
  saRequest<Paginated<TimelineItem>>(`/organizations/${orgId}/timeline`, token, { query })

// ── settings, signals, deletions ────────────────────────────────────────────

export interface PlatformSettings {
  auto_delete_enabled: boolean
  env_kill_switch: boolean
  auto_delete_effective: boolean
  limits?: {
    max_executions_per_day?: number
    max_schedules_per_run?: number
    grace_days?: [number, number] | number[]
    max_members?: number
    max_activities?: number
    min_inactive_days?: number
    min_age_days?: number
    recent_note_days?: number
  }
}

export interface AdminSignal {
  email: string
  disposable: boolean
  abstract_disposable?: boolean | null
  free_provider: boolean
  looks_test: boolean
}

export interface OrgSignals {
  org_id: number
  admins: AdminSignal[]
  facts: Record<string, unknown>
  name_reasons?: string[]
  test_org_score: number
  reasons: string[]
  guards: { ok: boolean; failures: string[] }
}

export interface PendingDeletion {
  org_id: number
  name: string
  slug: string
  lifecycle?: string
  deletion_scheduled_at: string
  deletion_requested_at?: string | null
  deletion_reason?: string | null
  deletion_requested_by?: string | null
  days_left?: number | null
  path?: string
  test_org_score?: number | null
  score_reasons?: string[]
  logo_image?: string | null
  org_uuid?: string
  plan?: string
}

export interface Tombstone {
  id: number
  org_id: number
  name: string
  slug: string
  admin_emails: string[]
  member_count: number
  org_created_at?: string | null
  deleted_at: string
  reason?: string | null
  test_org_score?: number | null
  score_reasons?: string[]
  requested_by?: string | null
  executed_by?: string | null
}

export interface DeletionsResponse {
  pending: PendingDeletion[]
  deleted: Tombstone[]
  today?: number
  settings?: PlatformSettings
}

export const getSettings = (token?: string) => saRequest<PlatformSettings>('/settings', token)
export const updateSettings = (token: string | undefined, body: { auto_delete_enabled?: boolean }) =>
  saRequest<PlatformSettings>('/settings', token, { method: 'PUT', body })
export const getSignals = (token: string | undefined, orgId: number | string) => saRequest<OrgSignals>(`/organizations/${orgId}/signals`, token)
export const listDeletions = (token: string | undefined, query: Query) => saRequest<DeletionsResponse>('/deletions', token, { query })
export const scheduleDeletion = (
  token: string | undefined,
  orgId: number | string,
  body: { grace_days: number; reason: string; warn_admins: boolean; warn_template_uuid?: string | null }
) => saRequest<PendingDeletion>(`/organizations/${orgId}/deletion`, token, { method: 'POST', body })
export const cancelDeletion = (token: string | undefined, orgId: number | string, reason?: string) =>
  saRequest(`/organizations/${orgId}/deletion/cancel`, token, { method: 'POST', body: { reason } })
export const executeDeletion = (token: string | undefined, orgId: number | string, body: { confirm_slug: string; reason?: string }) =>
  saRequest<Tombstone>(`/organizations/${orgId}/deletion/execute`, token, { method: 'POST', body })

// ── emails ──────────────────────────────────────────────────────────────────

export type EmailCategory = 'transactional' | 'product' | 'marketing'
export const EMAIL_CATEGORIES: EmailCategory[] = ['transactional', 'product', 'marketing']
export const EMAIL_VARIABLES = ['org_name', 'org_url', 'admin_name', 'plan', 'login_url', 'days_left', 'poc_end_date', 'support_email', 'date'] as const

export interface EmailTemplate {
  template_uuid: string
  name: string
  subject: string
  body: string
  category: EmailCategory | string
  variables?: string[]
  created_by_user_id?: number | null
  created_at?: string
  updated_at?: string
  path?: string
}

export type CampaignRecipients = 'admins' | 'owners' | 'all_members'
export const CAMPAIGN_RECIPIENTS: CampaignRecipients[] = ['admins', 'owners', 'all_members']
export type CampaignStatus = 'draft' | 'scheduled' | 'sending' | 'sent' | 'cancelled'
export const CAMPAIGN_STATUSES: CampaignStatus[] = ['draft', 'scheduled', 'sending', 'sent', 'cancelled']
export const SEND_STATUSES = [
  'queued',
  'sent',
  'failed',
  'skipped_unsubscribed',
  'skipped_suppressed',
  'skipped_demo',
  'skipped_duplicate',
  'skipped_cap',
  'skipped_cancelled',
] as const

export interface CampaignAudience {
  filters?: Record<string, string | number | boolean>
  saved_view_uuid?: string
}

export interface Campaign {
  campaign_uuid: string
  name: string
  template_uuid?: string | null
  template_name?: string | null
  audience: CampaignAudience
  recipients: CampaignRecipients | string
  status: CampaignStatus | string
  scheduled_at?: string | null
  stats?: Record<string, number | string>
  throttle_per_second?: number | null
  created_by_user_id?: number | null
  approved_by_user_id?: number | null
  approved_at?: string | null
  created_at?: string
  updated_at?: string
  sent_at?: string | null
  path?: string
}

export interface CampaignPreview {
  recipients: number
  orgs: number
  samples: { to?: string; org_name?: string; subject?: string; html?: string }[]
  needs_approval: boolean
  approved: boolean
}

export interface CampaignRecipient {
  id?: number
  email: string
  org_id?: number | null
  org_name?: string | null
  status: string
  error?: string | null
  sent_at?: string | null
  created_at?: string
}

export const listTemplates = (token?: string, query?: Query) => saRequest<EmailTemplate[]>('/emails/templates', token, { query })
export const createTemplate = (token: string | undefined, body: Partial<EmailTemplate>) =>
  saRequest<EmailTemplate>('/emails/templates', token, { method: 'POST', body })
export const updateTemplate = (token: string | undefined, uuid: string, body: Partial<EmailTemplate>) =>
  saRequest<EmailTemplate>(`/emails/templates/${uuid}`, token, { method: 'PUT', body })
export const deleteTemplate = (token: string | undefined, uuid: string) => saRequest(`/emails/templates/${uuid}`, token, { method: 'DELETE' })

export interface OrgEmailBody {
  template_uuid?: string
  subject?: string
  body?: string
  category: EmailCategory
  recipients: 'admins' | 'owners'
  preview: boolean
}
export const emailOrg = (token: string | undefined, orgId: number | string, body: OrgEmailBody) =>
  saRequest<{ subject: string; html?: string; recipients: string[] | number; sent?: number }>(`/organizations/${orgId}/email`, token, { method: 'POST', body })

export const listCampaigns = (token?: string, query?: Query) => saRequest<Campaign[]>('/campaigns', token, { query })
export const getCampaign = (token: string | undefined, uuid: string) => saRequest<Campaign>(`/campaigns/${uuid}`, token)
export const createCampaign = (
  token: string | undefined,
  body: { name: string; template_uuid?: string; audience: CampaignAudience; recipients: string; throttle_per_second?: number }
) => saRequest<Campaign>('/campaigns', token, { method: 'POST', body })
export const updateCampaign = (token: string | undefined, uuid: string, body: Partial<Pick<Campaign, 'name' | 'template_uuid' | 'audience' | 'recipients'>>) =>
  saRequest<Campaign>(`/campaigns/${uuid}`, token, { method: 'PUT', body })
export const deleteCampaign = (token: string | undefined, uuid: string) => saRequest(`/campaigns/${uuid}`, token, { method: 'DELETE' })
export const previewCampaign = (token: string | undefined, uuid: string) =>
  saRequest<CampaignPreview>(`/campaigns/${uuid}/preview`, token, { method: 'POST' })
export const testCampaign = (token: string | undefined, uuid: string) =>
  saRequest<{ ok: boolean; to?: string; error?: string | null }>(`/campaigns/${uuid}/test`, token, { method: 'POST' })
export const approveCampaign = (token: string | undefined, uuid: string) => saRequest<Campaign>(`/campaigns/${uuid}/approve`, token, { method: 'POST' })
export const sendCampaign = (token: string | undefined, uuid: string) => saRequest<Campaign>(`/campaigns/${uuid}/send`, token, { method: 'POST' })
export const scheduleCampaign = (token: string | undefined, uuid: string, scheduledAt: string) =>
  saRequest<Campaign>(`/campaigns/${uuid}/schedule`, token, { method: 'POST', body: { scheduled_at: scheduledAt } })
export const cancelCampaign = (token: string | undefined, uuid: string) => saRequest<Campaign>(`/campaigns/${uuid}/cancel`, token, { method: 'POST' })
export const listCampaignRecipients = (token: string | undefined, uuid: string, query: Query) =>
  saRequest<Paginated<CampaignRecipient>>(`/campaigns/${uuid}/recipients`, token, { query })

// ── query keys ──────────────────────────────────────────────────────────────

export const opsKeys = {
  events: () => ['platform', 'notifications', 'events'] as const,
  channels: () => ['platform', 'notifications', 'channels'] as const,
  rules: () => ['platform', 'notifications', 'rules'] as const,
  deliveries: (q?: object) => (q ? (['platform', 'notifications', 'deliveries', q] as const) : (['platform', 'notifications', 'deliveries'] as const)),
  delivery: (id: string | number) => ['platform', 'notifications', 'delivery', String(id)] as const,
  // The top-bar bell uses ['platform', 'inbox', …]; invalidating 'inbox' refreshes both.
  inbox: (q?: object) => (q ? (['platform', 'inbox', 'page', q] as const) : (['platform', 'inbox'] as const)),
  preferences: () => ['platform', 'notifications', 'preferences'] as const,
  follows: () => ['platform', 'follows'] as const,
  feed: (q: object) => ['platform', 'follows', 'feed', q] as const,
  followers: (orgId: string | number) => ['platform', 'org', String(orgId), 'followers'] as const,
  tasks: (q?: object) => (q ? (['platform', 'tasks', q] as const) : (['platform', 'tasks'] as const)),
  task: (uuid: string) => ['platform', 'tasks', 'one', uuid] as const,
  timeline: (orgId: string | number, q: object) => ['platform', 'org', String(orgId), 'timeline', q] as const,
  settings: () => ['platform', 'settings'] as const,
  signals: (orgId: string | number) => ['platform', 'org', String(orgId), 'signals'] as const,
  deletions: (q?: object) => (q ? (['platform', 'deletions', q] as const) : (['platform', 'deletions'] as const)),
  templates: () => ['platform', 'emails', 'templates'] as const,
  campaigns: () => ['platform', 'emails', 'campaigns'] as const,
  campaign: (uuid: string) => ['platform', 'emails', 'campaigns', uuid] as const,
  campaignRecipients: (uuid: string, q: object) => ['platform', 'emails', 'campaigns', uuid, 'recipients', q] as const,
}
