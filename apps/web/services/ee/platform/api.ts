import type { ImpersonationSession } from '@/lib/auth/impersonation'
import { getAPIUrl } from '@services/config/config'
import { errorHandling } from '@services/utils/ts/requests'
import type {
  Automation,
  AutomationRun,
  AutomationSchema,
  AutomationTemplate,
  AuditEvent,
  CreatedToken,
  OrgListItem,
  OrgNote,
  OrgProfile,
  Overview,
  Paginated,
  PlatformMe,
  PocOrg,
  PreviewResult,
  RunMini,
  SearchResults,
  SuperadminToken,
  SystemStatus,
  TeamMember,
  TeamResponse,
  UnifiedEvent,
  UnifiedFacets,
  InboxItem,
  UserDetail,
  AICostsOverview,
  AIPricing,
  OrgAICosts,
  OrgConfiguration,
  OrgConfigWriteResult,
  OrgImageSlot,
} from './types'

// Thin client for the platform console API. Every call goes through
// `errorHandling`, so failures throw an Error carrying `.status` and `.detail`
// (a 401 also triggers the shared "session expired" flow).

export const superadminBase = () => `${getAPIUrl()}ee/superadmin`

type Query = Record<string, string | number | boolean | null | undefined | string[]>

export function buildQuery(query?: Query): string {
  if (!query) return ''
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue
    if (Array.isArray(value)) value.forEach((v) => params.append(key, v))
    else params.set(key, String(value))
  }
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

export async function saRequest<T>(
  path: string,
  token: string | undefined,
  { method = 'GET', body, query }: { method?: string; body?: unknown; query?: Query } = {}
): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`${superadminBase()}${path}${buildQuery(query)}`, {
    method,
    headers,
    credentials: 'include',
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) {
    // Keep the structured field errors (`errors: [{loc, field_label, message}]`)
    // that errorHandling would drop; it still handles 401s and `detail`.
    const body = await res.clone().json().catch(() => null)
    try {
      return await errorHandling(res)
    } catch (err) {
      if (err && typeof err === 'object' && Array.isArray(body?.errors)) (err as { errors?: unknown }).errors = body.errors
      throw err
    }
  }
  // DELETEs answer 204 or an empty 200; don't let .json() throw on those.
  const text = await res.text()
  if (!text) return {} as T
  try {
    return JSON.parse(text) as T
  } catch {
    return text as unknown as T
  }
}

/** Downloads a CSV export and hands it to the browser as a file. */
export async function saDownload(path: string, token: string | undefined, filename: string, query?: Query) {
  const res = await fetch(`${superadminBase()}${path}${buildQuery(query)}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    credentials: 'include',
  })
  if (!res.ok) {
    // Reuse the shared error shape (status + detail) for the caller's toast.
    await errorHandling(res)
    return
  }
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Status of a thrown API error (undefined for network errors). */
export function errorStatus(err: unknown): number | undefined {
  return (err as { status?: number } | null)?.status
}

/** True when the endpoint does not exist on this server yet (older backend). */
export function isNotAvailable(err: unknown): boolean {
  const s = errorStatus(err)
  return s === 404 || s === 405 || s === 501
}

export interface FieldError {
  loc: string
  label: string
  message: string
}

/** Field errors from a 4xx body, keyed by their dotted `loc` (0-based: `actions.1.params.grace_days`). */
export function fieldErrors(err: unknown): Record<string, FieldError> {
  const list = (err as { errors?: unknown } | null)?.errors
  const out: Record<string, FieldError> = {}
  if (!Array.isArray(list)) return out
  for (const e of list) {
    if (!e || typeof e.loc !== 'string') continue
    out[e.loc] = { loc: e.loc, label: String(e.field_label ?? e.loc), message: String(e.message ?? '') }
  }
  return out
}

export function errorMessage(err: unknown, fallback: string): string {
  if (!err) return fallback
  const detail = (err as { detail?: unknown }).detail
  if (typeof detail === 'string' && detail) return detail
  if (detail && typeof detail === 'object' && typeof (detail as { message?: unknown }).message === 'string') {
    return (detail as { message: string }).message
  }
  if (Array.isArray(detail) && typeof detail[0]?.msg === 'string') {
    // Pydantic errors: name the field from `loc` ("contact_email" → "Contact email").
    const loc = Array.isArray(detail[0].loc) ? detail[0].loc[detail[0].loc.length - 1] : null
    const field = typeof loc === 'string' && loc !== 'body' ? loc.replace(/_/g, ' ').replace(/^./, (c: string) => c.toUpperCase()) : ''
    const msg = String(detail[0].msg).replace(/^Value error, /, '')
    return field ? `${field}: ${msg}` : msg
  }
  if (err instanceof Error && err.message && !err.message.startsWith('{')) return err.message
  return fallback
}

// ── identity, overview, search, system ──────────────────────────────────────

export const getMe = (token?: string) => saRequest<PlatformMe>('/me', token)
export const getOverview = (token: string | undefined, days = 30) => saRequest<Overview>('/overview', token, { query: { days } })
export const searchPlatform = (token: string | undefined, q: string) => saRequest<SearchResults>('/search', token, { query: { q } })
export const getSystem = (token?: string) => saRequest<SystemStatus>('/system', token)

// ── team ────────────────────────────────────────────────────────────────────

export const getTeam = (token?: string, query?: Query) => saRequest<TeamResponse>('/team', token, { query })
export const addTeamMember = (token: string | undefined, body: { email?: string; username?: string; role: string; note?: string }) =>
  saRequest<TeamMember>('/team', token, { method: 'POST', body })
export const updateTeamMember = (token: string | undefined, userId: number, body: { role?: string; note?: string }) =>
  saRequest<TeamMember>(`/team/${userId}`, token, { method: 'PUT', body })
export const setTeamImpersonation = (token: string | undefined, userId: number, level: 'default' | 'none' | 'readonly' | 'full') =>
  saRequest<TeamMember>(`/team/${userId}/impersonation`, token, { method: 'PUT', body: { level } })
export const removeTeamMember = (token: string | undefined, userId: number) =>
  saRequest<{ ok: boolean }>(`/team/${userId}`, token, { method: 'DELETE' })

// ── audit ───────────────────────────────────────────────────────────────────

export interface AuditFilters {
  page?: number
  limit?: number
  action?: string
  actor_user_id?: number | string
  org_id?: number | string
  target_type?: string
  since?: string
}
export const getAudit = (token: string | undefined, filters: AuditFilters) =>
  saRequest<Paginated<AuditEvent>>('/audit', token, { query: filters as Query })
export const exportAudit = (token: string | undefined, filters: AuditFilters) =>
  saDownload('/audit/export.csv', token, 'platform-audit.csv', filters as Query)

// ── organizations ───────────────────────────────────────────────────────────

export interface OrgFilters {
  page?: number
  limit?: number
  q?: string
  plan?: string
  lifecycle?: string
  tag?: string
  sort?: string
  order?: 'asc' | 'desc'
}

function orgQuery(f: OrgFilters): Query {
  // `search` is the pre-v2 name of `q`; sending both keeps older APIs filtering.
  return { ...f, search: f.q } as Query
}

export const listOrgs = (token: string | undefined, filters: OrgFilters) =>
  saRequest<Paginated<OrgListItem>>('/organizations', token, { query: orgQuery(filters) })
export const exportOrgs = (token: string | undefined, filters: OrgFilters) =>
  saDownload('/organizations/export.csv', token, 'organizations.csv', orgQuery({ ...filters, page: undefined, limit: undefined }))
export const getOrgVisits = (token?: string) =>
  saRequest<{ data: { org_id: number; date: string; views: number }[] }>('/organizations/visits', token)
export const createOrg = (token: string | undefined, body: Record<string, unknown>) =>
  saRequest<{ id?: number } & Record<string, unknown>>('/organizations', token, { method: 'POST', body })

export const getOrg = (token: string | undefined, orgId: string | number) => saRequest<any>(`/organizations/${orgId}`, token)
export const getOrgUsage = (token: string | undefined, orgId: string | number) => saRequest<any>(`/organizations/${orgId}/usage`, token)
export const getOrgAnalytics = (token: string | undefined, orgId: string | number, days: number) =>
  saRequest<Record<string, any>>(`/organizations/${orgId}/analytics`, token, { query: { days } })
export const getOrgCourses = (token: string | undefined, orgId: string | number, page: number, limit = 20) =>
  saRequest<Paginated<any>>(`/organizations/${orgId}/courses`, token, { query: { page, limit } })
export const getOrgUsers = (token: string | undefined, orgId: string | number, page: number, search: string, limit = 20) =>
  saRequest<Paginated<any>>(`/organizations/${orgId}/users`, token, { query: { page, limit, search } })
export const updateOrgPlan = (token: string | undefined, orgId: string | number, plan: string) =>
  saRequest(`/organizations/${orgId}/plan`, token, { method: 'PUT', body: { plan } })
export const updateOrgSettings = (token: string | undefined, orgId: string | number, body: Record<string, string>) =>
  saRequest(`/organizations/${orgId}/settings`, token, { method: 'PUT', body })
export const updateOrgConfig = (token: string | undefined, orgId: string | number, config: unknown) =>
  saRequest(`/organizations/${orgId}/config`, token, { method: 'PUT', body: { config } })
export const updateOrgAdminToggles = (token: string | undefined, orgId: string | number, toggles: unknown) =>
  saRequest(`/organizations/${orgId}/admin_toggles`, token, { method: 'PUT', body: { toggles } })

// Branding + configuration: every write goes through the org's own service on
// the API side (same validation and upload checks) and is audited per field.
export type OrgConfigSection = 'profile' | 'general' | 'theme' | 'auth_branding' | 'seo' | 'menu' | 'signup' | 'ai' | 'features'
export const getOrgConfiguration = (token: string | undefined, orgId: string | number) =>
  saRequest<OrgConfiguration>(`/organizations/${orgId}/configuration`, token)
export const getOrgConfigHistory = (token: string | undefined, orgId: string | number, limit = 25) =>
  saRequest<AuditEvent[]>(`/organizations/${orgId}/configuration/history`, token, { query: { limit } })
export const updateOrgConfigSection = (token: string | undefined, orgId: string | number, section: OrgConfigSection, body: unknown) =>
  saRequest<OrgConfigWriteResult>(`/organizations/${orgId}/configuration/${section}`, token, { method: 'PUT', body })
export const deleteOrgImage = (token: string | undefined, orgId: string | number, slot: OrgImageSlot, filename?: string) =>
  saRequest<OrgConfigWriteResult>(`/organizations/${orgId}/images/${slot}`, token, { method: 'DELETE', query: { filename } })

/** Multipart upload (saRequest is JSON-only). Errors carry `.status` / `.detail` like every other call. */
export async function uploadOrgImage(token: string | undefined, orgId: string | number, slot: OrgImageSlot, file: File): Promise<OrgConfigWriteResult> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(`${superadminBase()}/organizations/${orgId}/images/${slot}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    credentials: 'include',
    body: form,
  })
  if (!res.ok) await errorHandling(res)
  return res.json()
}

// AI credits: the audited platform endpoints (orgs.plan), not the OSS org router.
export const getAiCredits = (token: string | undefined, orgId: string | number) => saRequest<any>(`/organizations/${orgId}/ai_credits`, token)
export const setAiCredits = (token: string | undefined, orgId: string | number, amount: number, reason?: string) =>
  saRequest(`/organizations/${orgId}/ai_credits/set`, token, { method: 'POST', body: { amount, reason } })
export const resetAiCredits = (token: string | undefined, orgId: string | number, reason?: string) =>
  saRequest(`/organizations/${orgId}/ai_credits/reset`, token, { method: 'POST', body: { reason } })

// ── profile, notes, org activity ────────────────────────────────────────────

export const getOrgProfile = (token: string | undefined, orgId: string | number) =>
  saRequest<OrgProfile>(`/organizations/${orgId}/profile`, token)
export const updateOrgProfile = (
  token: string | undefined,
  orgId: string | number,
  body: { tags?: string[]; account_owner_user_id?: number | null; lifecycle?: string }
) => saRequest<OrgProfile>(`/organizations/${orgId}/profile`, token, { method: 'PUT', body })
export const recomputeHealth = (token: string | undefined, orgId: string | number) =>
  saRequest<OrgProfile>(`/organizations/${orgId}/health`, token, { method: 'POST' })
export const getOrgNotes = (token: string | undefined, orgId: string | number) => saRequest<OrgNote[]>(`/organizations/${orgId}/notes`, token)
export const addOrgNote = (token: string | undefined, orgId: string | number, body: { body: string; kind?: string; pinned?: boolean }) =>
  saRequest<OrgNote>(`/organizations/${orgId}/notes`, token, { method: 'POST', body })
export const updateOrgNote = (token: string | undefined, orgId: string | number, noteId: number, body: { body?: string; pinned?: boolean }) =>
  saRequest<OrgNote>(`/organizations/${orgId}/notes/${noteId}`, token, { method: 'PUT', body })
export const deleteOrgNote = (token: string | undefined, orgId: string | number, noteId: number) =>
  saRequest(`/organizations/${orgId}/notes/${noteId}`, token, { method: 'DELETE' })
export const getOrgActivity = (token: string | undefined, orgId: string | number) =>
  saRequest<AuditEvent[] | Paginated<AuditEvent>>(`/organizations/${orgId}/activity`, token)

// ── POCs ────────────────────────────────────────────────────────────────────

export type PocStatus = 'active' | 'ending' | 'ended' | 'all'
export const listPocs = (token: string | undefined, status: PocStatus = 'all') => saRequest<PocOrg[]>('/pocs', token, { query: { status } })
export interface StartPocBody {
  org_id?: number
  create_org?: { name: string; slug: string; email?: string; description?: string }
  plan: string
  days: number
  goal?: string
  contact_name?: string
  contact_email?: string
  owner_user_id?: number
}
export const startPoc = (token: string | undefined, body: StartPocBody) => saRequest<OrgProfile>('/pocs', token, { method: 'POST', body })
export const extendPoc = (token: string | undefined, orgId: number, days: number) =>
  saRequest<OrgProfile>(`/organizations/${orgId}/poc/extend`, token, { method: 'POST', body: { days } })
export const convertPoc = (token: string | undefined, orgId: number, plan: string) =>
  saRequest<OrgProfile>(`/organizations/${orgId}/poc/convert`, token, { method: 'POST', body: { plan } })
export const endPoc = (token: string | undefined, orgId: number, outcome: 'lost' | 'expired', reason?: string) =>
  saRequest<OrgProfile>(`/organizations/${orgId}/poc/end`, token, { method: 'POST', body: { outcome, reason } })
export const reopenOrg = (token: string | undefined, orgId: number) =>
  saRequest<OrgProfile>(`/organizations/${orgId}/reopen`, token, { method: 'POST' })

// ── automations ─────────────────────────────────────────────────────────────

// Optional filters (q, enabled, dry_run, schedule, status, template, created_since/until);
// an API that ignores them still works, the console filters client-side too.
export const listAutomations = (token?: string, filters?: Record<string, string | undefined>) =>
  saRequest<Automation[]>('/automations', token, { query: filters })
export const getAutomation = (token: string | undefined, uuid: string) => saRequest<Automation>(`/automations/${uuid}`, token)
/** One run with its per-org results (deep links to `?section=runs&run=<id>`). */
export const getAutomationRun = (token: string | undefined, runId: number | string) =>
  saRequest<AutomationRun>(`/automations/runs/${runId}`, token)
export const getAutomationTemplates = (token?: string) => saRequest<AutomationTemplate[]>('/automations/templates', token)
export const getAutomationSchema = (token?: string) => saRequest<AutomationSchema>('/automations/schema', token)
export const createAutomation = (token: string | undefined, body: Partial<Automation> & { template?: string; channel_uuid?: string }) =>
  saRequest<Automation>('/automations', token, { method: 'POST', body })
export const updateAutomation = (token: string | undefined, uuid: string, body: Partial<Automation>) =>
  saRequest<Automation>(`/automations/${uuid}`, token, { method: 'PUT', body })
export const deleteAutomation = (token: string | undefined, uuid: string) => saRequest(`/automations/${uuid}`, token, { method: 'DELETE' })
/** `target`: one org (required to run an event rule by hand) and optionally the event it simulates. */
export const previewAutomation = (token: string | undefined, uuid: string, target?: { org_id?: number; event_key?: string }) =>
  saRequest<PreviewResult>(`/automations/${uuid}/preview`, token, { method: 'POST', query: target })
export const runAutomation = (token: string | undefined, uuid: string, target?: { org_id?: number; event_key?: string }) =>
  saRequest<AutomationRun>(`/automations/${uuid}/run`, token, { method: 'POST', query: target })
export const getAutomationRuns = (
  token: string | undefined,
  uuid: string,
  page = 1,
  filters?: { status?: string; trigger?: string; dry_run?: string; since?: string; until?: string; org_id?: string; org_plan?: string }
) => saRequest<Paginated<AutomationRun>>(`/automations/${uuid}/runs`, token, { query: { page, ...filters } })
export const getRecentRuns = (token?: string, filters?: Record<string, string | undefined>) =>
  saRequest<RunMini[]>('/automations/runs/recent', token, { query: filters })
// Pickers for the rule builder's channel and email-template params.
export const listPickerChannels = (token?: string) =>
  saRequest<{ channel_uuid: string; name: string; kind?: string; enabled?: boolean }[]>('/notifications/channels', token)
/** Event catalogue (key → label) for event-triggered automations. */
export const listNotificationEvents = (token?: string) =>
  saRequest<{ key: string; label: string; group?: string; severity?: string }[]>('/notifications/events', token)
export const listPickerEmailTemplates = (token?: string) =>
  saRequest<{ template_uuid: string; name: string; category?: string; subject?: string }[]>('/emails/templates', token)

// ── users, analytics ────────────────────────────────────────────────────────

export const listUsers = (token: string | undefined, query: Query) => saRequest<Paginated<any>>('/users', token, { query })
export const getUser = (token: string | undefined, userId: number | string) => saRequest<UserDetail>(`/users/${userId}`, token)
export const getGlobalAnalytics = (token: string | undefined, days: number) =>
  saRequest<Record<string, any>>('/analytics/global', token, { query: { days } })

export type OnboardingFunnel = {
  days: number
  since: string
  orgs: number
  steps: { key: string; count: number; rate: number }[]
  by_goal: Record<string, number>
  events: Record<string, number>
}
// Signup → verified → org → goal → course → published → learner → paid.
export const getOnboardingFunnel = (token: string | undefined, days: number) =>
  saRequest<OnboardingFunnel>('/analytics/onboarding-funnel', token, { query: { days } })

// ── AI costs ────────────────────────────────────────────────────────────────

export const getAICosts = (token: string | undefined, days: number, feature?: string) =>
  saRequest<AICostsOverview>('/ai-costs', token, { query: { days, feature } })
export const getAIPricing = (token?: string) => saRequest<AIPricing>('/ai-costs/pricing', token)
export const getOrgAICosts = (token: string | undefined, orgId: number | string, days: number) =>
  saRequest<OrgAICosts>(`/organizations/${orgId}/ai-costs`, token, { query: { days } })

// ── tokens ──────────────────────────────────────────────────────────────────

export const listTokens = (token?: string) => saRequest<SuperadminToken[]>('/tokens/', token)
export const createToken = (
  token: string | undefined,
  body: { name: string; description?: string; expires_at?: string; role?: string; scopes?: string[] }
) => saRequest<CreatedToken>('/tokens/', token, { method: 'POST', body })
export const revokeToken = (token: string | undefined, uuid: string) => saRequest(`/tokens/${uuid}`, token, { method: 'DELETE' })

// ── unified audit log (§8) ──────────────────────────────────────────────────

export interface UnifiedAuditFilters {
  source?: 'all' | 'org' | 'platform'
  org_id?: string | number
  actor_user_id?: string | number
  actor_q?: string
  action?: string
  action_prefix?: string
  category?: string
  outcome?: string
  via?: string
  target_type?: string
  target_id?: string
  q?: string
  since?: string
  until?: string
  ip?: string
  org_plan?: string
  org_lifecycle?: string
  org_tag?: string
  page?: number
  limit?: number
  sort?: 'desc' | 'asc'
}
export const getUnifiedAudit = (token: string | undefined, f: UnifiedAuditFilters) =>
  saRequest<Paginated<UnifiedEvent>>('/audit/unified', token, { query: f as Query })
export const getUnifiedFacets = (token: string | undefined, f: UnifiedAuditFilters) =>
  saRequest<UnifiedFacets>('/audit/unified/facets', token, { query: { ...f, page: undefined, limit: undefined } as Query })
export const getUnifiedEvent = (token: string | undefined, source: string, id: string | number) =>
  saRequest<UnifiedEvent>(`/audit/unified/${source}/${id}`, token)
export const exportUnifiedAudit = (token: string | undefined, f: UnifiedAuditFilters) =>
  saDownload('/audit/unified/export.csv', token, 'audit-log.csv', { ...f, page: undefined, limit: undefined } as Query)

/** Normalise facet shapes (`{a: 1}` or `[{value, count}]`) into a list. */
export function facetList(f: unknown): { value: string; count: number; label?: string }[] {
  if (Array.isArray(f)) {
    return f
      .map((x: any) => ({ value: String(x?.value ?? x?.key ?? x?.id ?? x?.name ?? ''), count: Number(x?.count ?? 0), label: x?.label ?? x?.name }))
      .filter((x) => x.value)
  }
  if (f && typeof f === 'object') return Object.entries(f as Record<string, number>).map(([value, count]) => ({ value, count: Number(count) || 0 }))
  return []
}

// ── in-app inbox (§9.3) ─────────────────────────────────────────────────────

export const getInboxUnread = (token?: string) => saRequest<{ count?: number; unread?: number }>('/notifications/inbox/unread_count', token)
export const getInbox = (token: string | undefined, page = 1) =>
  saRequest<Paginated<InboxItem> | InboxItem[]>('/notifications/inbox', token, { query: { page, limit: 10 } })
export const markInboxRead = (token: string | undefined, body: { ids?: number[]; all?: boolean }) =>
  saRequest('/notifications/inbox/read', token, { method: 'POST', body })

// ── saved views (§9.6) ──────────────────────────────────────────────────────

export const listSavedViews = (token: string | undefined, page: string) => saRequest<unknown[]>('/saved_views', token, { query: { page } })
export const createSavedView = (token: string | undefined, body: { page: string; name: string; filters: Record<string, unknown>; shared: boolean }) =>
  saRequest('/saved_views', token, { method: 'POST', body })
export const deleteSavedView = (token: string | undefined, uuid: string) => saRequest(`/saved_views/${uuid}`, token, { method: 'DELETE' })

// ── CRM integrations (status only, never tokens) ────────────────────────────
export const getOrgCrm = (token: string | undefined, orgId: string | number) =>
  saRequest<{ items: OrgCrmConnection[] }>(`/organizations/${orgId}/crm`, token)

export interface OrgCrmConnection {
  provider: 'hubspot' | 'salesforce'
  status: string
  paused: boolean
  health: 'setup' | 'healthy' | 'warning' | 'error' | 'paused'
  account_name: string
  environment: string
  consent: boolean
  uses_own_app: boolean
  last_sync_at: string | null
  last_error: string | null
  connected_at: string | null
  records: Record<string, Record<string, number>>
  queued: number
  failed: number
}

// ── Impersonation ─────────────────────────────────────────────────────────
// Starting goes through the web app's own route (/api/auth/impersonation),
// which keeps the token in an httpOnly cookie; the console lists and revokes here.

export interface ImpersonationTargets {
  org: { id: number; name: string; slug: string }
  /** Who a quick session acts as: the org's first admin, else maintainer, else member. */
  suggested?: { user_id: number; name: string; username: string; role_id: number; role_label: string | null } | null
  members: { user_id: number; username: string; name: string; email: string; avatar_image: string | null; user_uuid: string; role_id: number; role_label: string }[]
  roles: { id: number; name: string; custom: boolean }[]
}

export interface ImpersonationStartBody {
  org_id: number
  /** Neither: the org's owner (first admin). */
  user_id?: number | null
  role_id?: number | null
  /** Default: full when you may make changes, read-only otherwise. */
  mode?: 'read_only' | 'full'
  return_url?: string | null
}

export const getImpersonationTargets = (token: string | undefined, orgId: number, q?: string) =>
  saRequest<ImpersonationTargets>('/impersonations/targets', token, { query: { org_id: orgId, q } })
export const listImpersonations = (
  token: string | undefined,
  query: { status: 'active' | 'history'; org_id?: number; impersonator_id?: number; page?: number; limit?: number },
) => saRequest<Paginated<ImpersonationSession>>('/impersonations', token, { query })
export const revokeImpersonation = (token: string | undefined, sessionUuid: string) =>
  saRequest<ImpersonationSession>(`/impersonations/${encodeURIComponent(sessionUuid)}/revoke`, token, { method: 'POST' })

export async function startImpersonation(token: string | undefined, body: ImpersonationStartBody) {
  const res = await fetch('/api/auth/impersonation', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const detail = data?.detail ?? data?.error ?? res.statusText
    const err: any = new Error(typeof detail === 'string' ? detail : detail?.message || res.statusText)
    err.status = res.status
    err.detail = detail
    throw err
  }
  return data as { session: ImpersonationSession; landing: string }
}
