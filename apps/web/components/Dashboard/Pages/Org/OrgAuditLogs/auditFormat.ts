/**
 * Pure helpers for the audit log page: the English source of every string
 * (keys under `dashboard.audit.*`), the human sentence for an entry, and
 * how diff values and labels read. No React here, so tests can import it.
 */

export type AuditOutcome = 'success' | 'denied' | 'failed'
export type AuditVia = 'ui' | 'api_token' | 'mcp' | 'atlas' | 'system' | 'scim' | 'support'

export type AuditEntry = {
  id: number
  created_at: string
  action: string
  category?: string | null
  outcome?: AuditOutcome | null
  reason?: string | null
  via?: AuditVia | null
  user_id?: number | null
  username?: string | null
  user_uuid?: string | null
  avatar_url?: string | null
  actor_name?: string | null
  actor_email?: string | null
  actor_role?: string | null
  target_type?: string | null
  target_id?: string | null
  target_name?: string | null
  resource?: string | null
  resource_id?: string | null
  changes?: Record<string, { from: unknown; to: unknown }> | null
  details?: Record<string, unknown> | null
  payload?: unknown
  method?: string | null
  path?: string | null
  status_code?: number | null
  ip_address?: string | null
  user_agent?: string | null
  request_id?: string | null
  client?: { browser?: string | null; os?: string | null; device?: string | null } | null
}

export const KEY_PREFIX = 'dashboard.audit.'

/** Every UI string of the page, English. Keys are relative to KEY_PREFIX. */
export const UI_STRINGS: Record<string, string> = {
  'search.placeholder': 'Search actions, people, targets, IPs…',
  'filters.date': 'Date range',
  'filters.date_all': 'All time',
  'filters.date_today': 'Today',
  'filters.date_7d': 'Last 7 days',
  'filters.date_30d': 'Last 30 days',
  'filters.date_90d': 'Last 90 days',
  'filters.date_custom': 'Custom range',
  'filters.from': 'From',
  'filters.to': 'To',
  'filters.actor': 'Actor',
  'filters.actor_all': 'Everyone',
  'filters.category': 'Category',
  'filters.category_all': 'All categories',
  'filters.target': 'Target type',
  'filters.target_all': 'All targets',
  'filters.outcome': 'Outcome',
  'filters.outcome_all': 'Any outcome',
  'filters.via': 'Channel',
  'filters.via_all': 'Any channel',
  'filters.clear': 'Clear filters',
  'filters.more': 'Filters',
  'filters.active': '{{count}} active',
  'actions.refresh': 'Refresh',
  'actions.export': 'Export',
  'actions.export_csv': 'Export CSV',
  'actions.export_json': 'Export JSON',
  'actions.retention': 'Retention',
  'actions.close': 'Close',
  'actions.retry': 'Try again',
  'actions.copy': 'Copy',
  'actions.copied': 'Copied',
  'actions.view_raw': 'Raw entry',
  'actions.hide_raw': 'Hide raw entry',
  'export.generating': 'Preparing the export…',
  'export.done': 'Export downloaded',
  'export.failed': 'The export failed. Try again.',
  'table.when': 'When',
  'table.actor': 'Actor',
  'table.event': 'Event',
  'table.outcome': 'Outcome',
  'table.via': 'Channel',
  'table.open': 'Open details',
  'list.showing': '{{start}}–{{end}} of {{total}}',
  'list.previous': 'Previous page',
  'list.next': 'Next page',
  'empty.title': 'No audit events yet',
  'empty.description': 'Sign-ins, settings changes, content edits and exports will show up here as they happen.',
  'empty.filtered_title': 'No events match these filters',
  'empty.filtered_description': 'Try a wider date range or clear the filters.',
  'error.title': 'Couldn’t load the audit log',
  'error.description': 'Something went wrong while fetching events. Check your connection and try again.',
  'drawer.title': 'Event details',
  'drawer.changes': 'Changes',
  'drawer.field': 'Field',
  'drawer.before': 'Before',
  'drawer.after': 'After',
  'drawer.no_changes': 'No field changes recorded for this event.',
  'drawer.actor': 'Actor',
  'drawer.target': 'Target',
  'drawer.context': 'Context',
  'drawer.details': 'Details',
  'drawer.related': 'Related events',
  'drawer.related_empty': 'No other events from this request or about this target.',
  'drawer.same_request': 'Same request',
  'drawer.same_target': 'Same target',
  'drawer.ip': 'IP address',
  'drawer.device': 'Device',
  'drawer.request_id': 'Request ID',
  'drawer.time': 'Time',
  'drawer.role': 'Role at the time',
  'drawer.email': 'Email',
  'drawer.type': 'Type',
  'drawer.id': 'ID',
  'drawer.name': 'Name',
  'drawer.reason': 'Reason',
  'drawer.http': 'Request',
  'drawer.loading': 'Loading details…',
  'drawer.unknown': 'Unknown',
  'drawer.empty_value': 'empty',
  'retention.title': 'Audit log retention',
  'retention.description': 'Events older than this are deleted automatically. The cleanup runs every few hours.',
  'retention.label': 'Keep events for',
  'retention.days': '{{count}} days',
  'retention.year': '1 year',
  'retention.years': '{{count}} years',
  'retention.default': 'default',
  'retention.save': 'Save',
  'retention.cancel': 'Cancel',
  'retention.saved': 'Retention updated',
  'retention.failed': 'Couldn’t update retention',
  'retention.shorter_warning': 'Shortening retention deletes older events at the next cleanup. This can’t be undone.',
  'retention.current': 'Kept for {{value}}',
  'outcome.success': 'Success',
  'outcome.denied': 'Denied',
  'outcome.failed': 'Failed',
  'via.ui': 'Dashboard',
  'via.api_token': 'API token',
  'via.mcp': 'AI app (MCP)',
  'via.atlas': 'Atlas',
  'via.system': 'System',
  'via.scim': 'SCIM (identity provider)',
  'via.support': 'LearnHouse',
  'category.auth': 'Sign-in',
  'category.security': 'Security',
  'category.members': 'Members',
  'category.roles': 'Roles',
  'category.org': 'Organization',
  'category.billing': 'Billing',
  'category.content': 'Content',
  'category.enrollment': 'Enrollments',
  'category.certificates': 'Certificates',
  'category.grading': 'Grading',
  'category.community': 'Community',
  'category.data': 'Data exports',
  'category.integrations': 'Integrations',
  'category.ai': 'AI',
  'category.other': 'Other requests',
  'actor.system': 'System',
  'actor.unknown': 'Someone',
  'actor.scim': 'Your identity provider',
  'actor.support': 'LearnHouse',
  'actor.via_token': 'via {{name}}',
  'target.fallback': 'an item',
  'device.desktop': 'Desktop',
  'device.mobile': 'Mobile',
  'device.tablet': 'Tablet',
  'device.app': 'Mobile app',
  'device.script': 'Script',
}

/** The sentence for each typed action. `<b>` marks emphasis; placeholders:
 * actor, target, type, learner, field, from, to, count, plan, role. */
export const ACTION_SENTENCES: Record<string, string> = {
  'auth.login.succeeded': '<b>{{actor}}</b> signed in',
  'auth.login.failed': 'Failed sign-in to <b>{{actor}}</b>’s account',
  'auth.mfa_challenge.failed': '<b>{{actor}}</b> entered a wrong two-factor code',
  'auth.logout': '<b>{{actor}}</b> signed out',
  'auth.session.replay_detected': 'A reused session token was blocked for <b>{{actor}}</b>; all their sessions were signed out',
  'security.mfa.enabled': '<b>{{actor}}</b> turned on two-factor authentication',
  'security.support_access.started': '<b>{{actor}}</b> started impersonating <b>{{target}}</b>',
  'security.support_access.ended': '<b>{{actor}}</b> stopped impersonating <b>{{target}}</b>',
  'security.mfa.disabled': '<b>{{actor}}</b> turned off two-factor authentication',
  'security.mfa.verify_failed': '<b>{{actor}}</b> entered a wrong two-factor code',
  'security.mfa.backup_codes_regenerated': '<b>{{actor}}</b> generated new backup codes',
  'security.mfa.reset_by_admin': '<b>{{actor}}</b> reset two-factor for <b>{{target}}</b>',
  'security.policy.updated': '<b>{{actor}}</b> changed the sign-in and two-factor policy',
  'security.password.changed': '<b>{{actor}}</b> changed their password',
  'security.password.change_failed': '<b>{{actor}}</b> entered a wrong password while changing it',
  'security.password_reset.requested': 'A password reset was requested for <b>{{actor}}</b>',
  'security.password_reset.completed': '<b>{{actor}}</b> reset their password',
  'security.email.changed': '<b>{{actor}}</b> changed the email of <b>{{target}}</b>',
  'security.sso.created': '<b>{{actor}}</b> set up single sign-on (<b>{{target}}</b>)',
  'security.sso.updated': '<b>{{actor}}</b> updated single sign-on (<b>{{target}}</b>)',
  'security.sso.deleted': '<b>{{actor}}</b> removed single sign-on',
  'security.api_token.created': '<b>{{actor}}</b> created the API token <b>{{target}}</b>',
  'security.api_token.updated': '<b>{{actor}}</b> updated the API token <b>{{target}}</b>',
  'security.api_token.revoked': '<b>{{actor}}</b> revoked the API token <b>{{target}}</b>',
  'security.api_token.regenerated': '<b>{{actor}}</b> regenerated the secret of API token <b>{{target}}</b>',
  'audit.retention_updated': '<b>{{actor}}</b> changed audit log retention',
  'integrations.lti.platform_created': '<b>{{actor}}</b> connected the LMS <b>{{target}}</b>',
  'integrations.lti.platform_updated': '<b>{{actor}}</b> updated the LMS <b>{{target}}</b>',
  'integrations.lti.platform_deleted': '<b>{{actor}}</b> removed the LMS <b>{{target}}</b>',
  'integrations.lti.key_rotated': '<b>{{actor}}</b> rotated the LTI signing key',
  'integrations.mcp.grant_approved': '<b>{{actor}}</b> connected the AI app <b>{{target}}</b>',
  'integrations.mcp.grant_denied': '<b>{{actor}}</b> declined access for the AI app <b>{{target}}</b>',
  'integrations.mcp.grant_revoked': '<b>{{actor}}</b> disconnected the AI app <b>{{target}}</b>',
  'integrations.mcp.refresh_replay': 'A reused token was blocked and the AI app <b>{{target}}</b> was disconnected',
  'integrations.mcp.settings_updated': '<b>{{actor}}</b> changed AI app connection settings',
  'members.invite_code.created': '<b>{{actor}}</b> created an invite link',
  'members.invite_code.deleted': '<b>{{actor}}</b> deleted an invite link',
  'members.invited': '<b>{{actor}}</b> invited {{count}} people by email',
  'members.invite.cancelled': '<b>{{actor}}</b> cancelled the invitation for <b>{{target}}</b>',
  'members.joined': '<b>{{actor}}</b> joined the organization',
  'members.removed': '<b>{{actor}}</b> removed <b>{{target}}</b> from the organization',
  'members.removed_bulk': '<b>{{actor}}</b> removed {{count}} members from the organization',
  'members.left': '<b>{{actor}}</b> left the organization',
  'members.role_changed': '<b>{{actor}}</b> changed <b>{{target}}</b>’s role from {{from}} to {{to}}',
  'members.added': '<b>{{actor}}</b> added <b>{{target}}</b> to the organization',
  'members.linked': '<b>{{actor}}</b> linked the account of <b>{{target}}</b>',
  'members.updated': '<b>{{actor}}</b> updated <b>{{target}}</b>',
  'members.deactivated': '<b>{{actor}}</b> deactivated <b>{{target}}</b>',
  'members.reactivated': '<b>{{actor}}</b> reactivated <b>{{target}}</b>',
  'members.deprovisioned': '<b>{{actor}}</b> deprovisioned <b>{{target}}</b>',
  'members.profile_updated': '<b>{{actor}}</b> updated the profile of <b>{{target}}</b>',
  'members.profiles_imported': '<b>{{actor}}</b> imported member profiles from a CSV file',
  'members.signup_answers_updated': '<b>{{actor}}</b> edited the signup answers of <b>{{target}}</b>',
  'members.signup_backfilled': '<b>{{actor}}</b> copied signup answers to people data',
  'groups.linked': '<b>{{actor}}</b> linked the group <b>{{target}}</b>',
  'groups.unlinked': '<b>{{actor}}</b> unlinked the group <b>{{target}}</b>',
  'groups.renamed': '<b>{{actor}}</b> renamed the group <b>{{target}}</b>',
  'groups.members_synced': '<b>{{actor}}</b> synced the members of <b>{{target}}</b>',
  'integrations.scim.updated': '<b>{{actor}}</b> changed SCIM provisioning settings',
  'integrations.scim.token_created': '<b>{{actor}}</b> created the SCIM token <b>{{target}}</b>',
  'integrations.scim.token_rotated': '<b>{{actor}}</b> rotated the SCIM token <b>{{target}}</b>',
  'integrations.scim.token_revoked': '<b>{{actor}}</b> revoked the SCIM token <b>{{target}}</b>',
  'training.rule_created': '<b>{{actor}}</b> created the required training <b>{{target}}</b>',
  'training.rule_updated': '<b>{{actor}}</b> updated the required training <b>{{target}}</b>',
  'training.rule_deleted': '<b>{{actor}}</b> deleted the required training <b>{{target}}</b>',
  'training.exempted': '<b>{{actor}}</b> exempted <b>{{target}}</b> from required training',
  'training.exemption_removed': '<b>{{actor}}</b> removed the exemption of <b>{{target}}</b>',
  'training.nudged': '<b>{{actor}}</b> sent a training reminder to <b>{{target}}</b>',
  'groups.created': '<b>{{actor}}</b> created the group <b>{{target}}</b>',
  'groups.updated': '<b>{{actor}}</b> updated the group <b>{{target}}</b>',
  'groups.deleted': '<b>{{actor}}</b> deleted the group <b>{{target}}</b>',
  'groups.members_added': '<b>{{actor}}</b> added {{count}} people to the group <b>{{target}}</b>',
  'groups.members_removed': '<b>{{actor}}</b> removed {{count}} people from the group <b>{{target}}</b>',
  'roles.created': '<b>{{actor}}</b> created the role <b>{{target}}</b>',
  'roles.updated': '<b>{{actor}}</b> changed the permissions of role <b>{{target}}</b>',
  'roles.deleted': '<b>{{actor}}</b> deleted the role <b>{{target}}</b>',
  'org.updated': '<b>{{actor}}</b> updated the organization details',
  'org.branding.updated': '<b>{{actor}}</b> changed the organization branding',
  'org.signup.updated': '<b>{{actor}}</b> changed sign-up settings',
  'org.ai.updated': '<b>{{actor}}</b> changed AI settings',
  'org.features.updated': '<b>{{actor}}</b> turned features on or off',
  'org.settings.updated': '<b>{{actor}}</b> changed organization settings',
  'org.landing.updated': '<b>{{actor}}</b> edited the landing page',
  'org.seo.updated': '<b>{{actor}}</b> changed SEO settings',
  'org.domain.added': '<b>{{actor}}</b> added the domain <b>{{target}}</b>',
  'org.domain.verified': '<b>{{actor}}</b> verified the domain <b>{{target}}</b>',
  'org.domain.verify_failed': 'Verification of the domain <b>{{target}}</b> failed',
  'org.domain.removed': '<b>{{actor}}</b> removed the domain <b>{{target}}</b>',
  'org.analytics_settings.updated': '<b>{{actor}}</b> changed analytics settings',
  'org.content_wiped': '<b>{{actor}}</b> deleted all courses of the organization',
  'org.deleted': '<b>{{actor}}</b> deleted the organization',
  'billing.plan.changed': 'The plan changed from {{from}} to {{to}}',
  'billing.payments.connected': '<b>{{actor}}</b> connected payments (<b>{{target}}</b>)',
  'billing.payments.updated': '<b>{{actor}}</b> updated the payments connection',
  'billing.payments.disconnected': '<b>{{actor}}</b> disconnected payments',
  'billing.payment_refunded': 'A payment was refunded',
  'course.created': '<b>{{actor}}</b> created the course <b>{{target}}</b>',
  'course.updated': '<b>{{actor}}</b> updated the course <b>{{target}}</b>',
  'course.published': '<b>{{actor}}</b> published the course <b>{{target}}</b>',
  'course.unpublished': '<b>{{actor}}</b> unpublished the course <b>{{target}}</b>',
  'course.deleted': '<b>{{actor}}</b> deleted the course <b>{{target}}</b>',
  'course.cloned': '<b>{{actor}}</b> duplicated a course as <b>{{target}}</b>',
  'chapter.created': '<b>{{actor}}</b> added the chapter <b>{{target}}</b>',
  'chapter.updated': '<b>{{actor}}</b> updated the chapter <b>{{target}}</b>',
  'chapter.deleted': '<b>{{actor}}</b> deleted the chapter <b>{{target}}</b>',
  'content.reordered': '<b>{{actor}}</b> reordered the content of <b>{{target}}</b>',
  'activity.created': '<b>{{actor}}</b> added the lesson <b>{{target}}</b>',
  'activity.updated': '<b>{{actor}}</b> edited the lesson <b>{{target}}</b>',
  'activity.published': '<b>{{actor}}</b> published the lesson <b>{{target}}</b>',
  'activity.unpublished': '<b>{{actor}}</b> unpublished the lesson <b>{{target}}</b>',
  'activity.deleted': '<b>{{actor}}</b> deleted the lesson <b>{{target}}</b>',
  'enrollment.created': '<b>{{actor}}</b> enrolled in <b>{{target}}</b>',
  'enrollment.created_other': '<b>{{actor}}</b> enrolled <b>{{learner}}</b> in <b>{{target}}</b>',
  'enrollment.removed': '<b>{{actor}}</b> left <b>{{target}}</b>',
  'enrollment.removed_other': '<b>{{actor}}</b> unenrolled <b>{{learner}}</b> from <b>{{target}}</b>',
  'certificate.issued': '<b>{{actor}}</b> earned the certificate for <b>{{target}}</b>',
  'certificate.issued_other': '<b>{{actor}}</b> issued <b>{{learner}}</b> the certificate for <b>{{target}}</b>',
  'certificate.revoked': 'The certificate for <b>{{target}}</b> was revoked from <b>{{learner}}</b>',
  'assignment.graded': '<b>{{actor}}</b> graded <b>{{learner}}</b> on <b>{{target}}</b>: {{to}}',
  'discussion.pinned': '<b>{{actor}}</b> pinned the discussion <b>{{target}}</b>',
  'discussion.unpinned': '<b>{{actor}}</b> unpinned the discussion <b>{{target}}</b>',
  'discussion.locked': '<b>{{actor}}</b> locked the discussion <b>{{target}}</b>',
  'discussion.unlocked': '<b>{{actor}}</b> unlocked the discussion <b>{{target}}</b>',
  'discussion.deleted': '<b>{{actor}}</b> deleted the discussion <b>{{target}}</b>',
  'comment.deleted': '<b>{{actor}}</b> deleted a comment in <b>{{target}}</b>',
  'data.exported': '<b>{{actor}}</b> exported <b>{{target}}</b>',
  'data.analytics_deleted': '<b>{{actor}}</b> deleted all analytics data',
  'ai.tool.executed': '<b>{{actor}}</b> ran the AI action <b>{{target}}</b>',
}

/** Generic sentences, for typed actions without their own. */
export const GENERIC_SENTENCES: Record<string, string> = {
  'generic.changed_field': '<b>{{actor}}</b> changed the {{type}} {{field}} of <b>{{target}}</b> from “{{from}}” to “{{to}}”',
  'generic.created': '<b>{{actor}}</b> created the {{type}} <b>{{target}}</b>',
  'generic.updated': '<b>{{actor}}</b> updated the {{type}} <b>{{target}}</b>',
  'generic.deleted': '<b>{{actor}}</b> deleted the {{type}} <b>{{target}}</b>',
  'generic.other': '<b>{{actor}}</b>: {{event}}',
  'generic.request': '<b>{{actor}}</b> sent {{method}} {{path}}',
}

/** Names of target types inside sentences ("the {{type}}"). */
export const TARGET_TYPES: Record<string, string> = {
  course: 'course',
  chapter: 'chapter',
  activity: 'lesson',
  usergroup: 'group',
  role: 'role',
  user: 'member',
  users: 'members',
  organization: 'organization',
  api_token: 'API token',
  sso_connection: 'SSO connection',
  lti_platform: 'LMS',
  lti_key: 'LTI key',
  mcp_app: 'AI app',
  invite_code: 'invite link',
  invite: 'invitation',
  domain: 'domain',
  discussion: 'discussion',
  comment: 'comment',
  community: 'community',
  assignment: 'assignment',
  certification: 'certificate',
  collection: 'collection',
  path: 'learning path',
  folder: 'folder',
  board: 'board',
  podcast: 'podcast',
  payments_provider: 'payments provider',
  audit_log: 'audit log',
  analytics: 'analytics',
  customers: 'customer list',
  scim: 'SCIM provisioning',
  scim_token: 'SCIM token',
  training_rule: 'required training',
}

export const CATEGORIES = [
  'auth', 'security', 'members', 'roles', 'org', 'billing', 'content', 'enrollment',
  'certificates', 'grading', 'community', 'data', 'integrations', 'ai', 'other',
] as const
export const OUTCOMES: AuditOutcome[] = ['success', 'denied', 'failed']
export const VIAS: AuditVia[] = ['ui', 'api_token', 'mcp', 'atlas', 'system', 'scim', 'support']

export const actionKey = (action: string) => `actions.${action.replace(/\./g, '__')}`

/** Every key this page uses, flat, with its English value. */
export function allStrings(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(UI_STRINGS)) out[KEY_PREFIX + k] = v
  for (const [k, v] of Object.entries(ACTION_SENTENCES)) out[KEY_PREFIX + actionKey(k)] = v
  for (const [k, v] of Object.entries(GENERIC_SENTENCES)) out[KEY_PREFIX + k] = v
  for (const [k, v] of Object.entries(TARGET_TYPES)) out[KEY_PREFIX + `types.${k}`] = v
  return out
}

/** "customization.color" → "customization color"; "default_role_id" → "default role". */
export function humanizeField(field: string): string {
  return field
    .split('.')
    .map((part) => part.replace(/_id$/, '').replace(/_/g, ' '))
    .join(' › ')
    .trim()
}

/** A diff value as short text. */
export function formatValue(value: unknown, empty = 'empty'): string {
  if (value === null || value === undefined || value === '') return empty
  if (typeof value === 'boolean') return value ? 'on' : 'off'
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') return value.length > 140 ? value.slice(0, 140) + '…' : value
  if (Array.isArray(value)) {
    if (value.every((v) => typeof v !== 'object' || v === null)) return value.map((v) => formatValue(v, empty)).join(', ') || empty
    return `${value.length} items`
  }
  try {
    const json = JSON.stringify(value)
    return json.length > 140 ? json.slice(0, 140) + '…' : json
  } catch {
    return String(value)
  }
}

export type Sentence = { key: string; defaults: string; values: Record<string, string | number> }

type Names = { actor: string; system: string; unknown: string; target: string; type: (_type: string) => string }

/** The sentence that describes an entry, as an i18n key, its English default
 * and the interpolation values. */
export function describeEntry(entry: AuditEntry, names: Names): Sentence {
  const details = (entry.details || {}) as Record<string, unknown>
  const changes = entry.changes || {}
  const fields = Object.keys(changes)
  const typeName = entry.target_type ? names.type(entry.target_type) : ''
  const values: Record<string, string | number> = {
    actor: names.actor,
    target: entry.target_name || entry.target_id || names.target,
    type: typeName,
    learner: String(details.learner_name || (details.learner_id ? `#${details.learner_id}` : names.unknown)),
    count: Number(details.count ?? (Array.isArray(details.user_ids) ? details.user_ids.length : 0)) || 0,
  }
  const first = fields[0] ? changes[fields[0]] : undefined
  if (first) {
    values.field = humanizeField(fields[0])
    values.from = formatValue(first.from)
    values.to = formatValue(first.to)
  }

  const action = entry.action
  const typed = !!entry.category && entry.category !== 'other' ? true : action in ACTION_SENTENCES

  // Untyped Atlas / AI app entries ("Atlas: Update course").
  if (!typed && (entry.method === 'ATLAS' || entry.method === 'MCP')) {
    return {
      key: KEY_PREFIX + 'generic.other',
      defaults: GENERIC_SENTENCES['generic.other'],
      values: { ...values, event: action.replace(/^(Atlas|AI app):\s*/, '') },
    }
  }
  // Untyped entries (written before typed events): the raw request.
  if (!typed && (entry.method || /^[A-Z]+ \//.test(action))) {
    const [method, ...rest] = action.split(' ')
    return {
      key: KEY_PREFIX + 'generic.request',
      defaults: GENERIC_SENTENCES['generic.request'],
      values: { ...values, method: entry.method || method, path: entry.path || rest.join(' ') },
    }
  }

  let variant = action
  const learnerId = details.learner_id
  const isOther = learnerId != null && entry.user_id != null && Number(learnerId) !== Number(entry.user_id)
  if ((action === 'enrollment.created' || action === 'enrollment.removed' || action === 'certificate.issued') && isOther) {
    variant = `${action}_other`
  }
  if (action === 'members.removed' && entry.target_type === 'organization') variant = 'members.removed_bulk'
  if (variant in ACTION_SENTENCES) {
    // A plain ".updated" with exactly one changed field reads better as the field change.
    if (/\.updated$/.test(action) && fields.length === 1 && entry.target_type && !['org', 'security', 'integrations'].includes(entry.category || '')) {
      return { key: KEY_PREFIX + 'generic.changed_field', defaults: GENERIC_SENTENCES['generic.changed_field'], values }
    }
    return { key: KEY_PREFIX + actionKey(variant), defaults: ACTION_SENTENCES[variant], values }
  }

  const verb = action.split('.').pop() || ''
  if (fields.length === 1 && verb === 'updated' && entry.target_type) {
    return { key: KEY_PREFIX + 'generic.changed_field', defaults: GENERIC_SENTENCES['generic.changed_field'], values }
  }
  if (['created', 'updated', 'deleted'].includes(verb) && entry.target_type) {
    return { key: KEY_PREFIX + `generic.${verb}`, defaults: GENERIC_SENTENCES[`generic.${verb}`], values }
  }
  return {
    key: KEY_PREFIX + 'generic.other',
    defaults: GENERIC_SENTENCES['generic.other'],
    values: { ...values, event: action.replace(/[._]/g, ' ') },
  }
}

/** Status-pill meaning of an outcome. */
export function outcomeStatus(outcome?: string | null): 'success' | 'warning' | 'danger' {
  if (outcome === 'denied') return 'warning'
  if (outcome === 'failed') return 'danger'
  return 'success'
}

/** Start/end ISO bounds of a preset date range, relative to `now`. */
export function dateRangeBounds(range: string, now: Date = new Date()): { start?: string; end?: string } {
  const days: Record<string, number> = { today: 0, '7d': 7, '30d': 30, '90d': 90 }
  if (!(range in days)) return {}
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - days[range])
  return { start: start.toISOString() }
}

/** The display name of the actor of an entry. */
export function actorName(entry: AuditEntry, fallbacks: { system: string; unknown: string; scim?: string; support?: string }): string {
  if (entry.actor_name) return entry.actor_name
  if (entry.username) return entry.username
  if (!entry.user_id && entry.via === 'scim') return fallbacks.scim ?? fallbacks.system
  // Platform impersonation shows as "LearnHouse", never a staff name.
  if (!entry.user_id && entry.via === 'support') return fallbacks.support ?? fallbacks.unknown
  if (!entry.user_id) return entry.via === 'system' || !entry.via ? fallbacks.system : fallbacks.unknown
  return fallbacks.unknown
}

/** Initials for an avatar placeholder. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}
