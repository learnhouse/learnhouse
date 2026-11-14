import { saRequest } from './api'

// Client for the console's newsletter deliverability API (EE superadmin,
// `/ee/superadmin/newsletter/*`): provider health, platform totals and
// thresholds, per-org sending state with resume / suspend / verify, and the
// global suppression list. Mirrors the "Superadmin" section of the newsletter
// spec; kept in OSS so console pages never import `@ee/*`.

export type SendingStatus = 'active' | 'paused' | 'suspended' | 'review'

export interface DeliverabilityProvider {
  name: string
  configured: boolean
  healthy: boolean
  from_domain: string | null
  last_ok_at: string | null
  last_error: string | null
  last_error_at: string | null
  /** Why the provider can't send (set when it isn't configured). */
  error?: string | null
}

export interface DeliverabilityTotals {
  sent_24h: number
  sent_30d: number
  failed_24h: number
  queue_depth: number
  bounce_rate_7d: number
  complaint_rate_7d: number
}

export interface DeliverabilityThresholds {
  bounce_rate: number
  complaint_rate: number
  min_sample: number
  spike_factor: number
  review_threshold: number
  global_rate: number
  org_rate: number
}

export interface DeliverabilityOrg {
  org_id: number
  name: string
  slug: string
  plan: string
  status: SendingStatus
  paused_reason: string | null
  /** Translatable reason: newsletter.reasons.<code> with these params. */
  paused_reason_code?: string | null
  paused_reason_params?: Record<string, any>
  paused_at: string | null
  verified: boolean
  sent_24h: number
  sent_30d: number
  bounce_rate_7d: number
  complaint_rate_7d: number
  warmup_day: number
  daily_cap: number
  /** Campaigns waiting for manual review. */
  in_review?: number
}

export interface DeliverabilityOverview {
  provider: DeliverabilityProvider
  totals: DeliverabilityTotals
  thresholds: DeliverabilityThresholds
  orgs: DeliverabilityOrg[]
}

export interface GlobalSuppression {
  id: number
  email: string
  reason: string
  scope: 'org' | 'global'
  created_at: string
}

const B = '/newsletter'

export const deliverabilityKeys = {
  all: ['platform', 'deliverability'] as const,
  overview: () => ['platform', 'deliverability', 'overview'] as const,
  suppressions: (filters?: { q?: string; page?: number }) =>
    (filters
      ? ['platform', 'deliverability', 'suppressions', filters]
      : ['platform', 'deliverability', 'suppressions']) as readonly unknown[],
}

export const getDeliverability = (token: string | undefined) =>
  saRequest<DeliverabilityOverview>(`${B}/overview`, token)

export const resumeOrgSending = (token: string | undefined, orgId: number) =>
  saRequest<unknown>(`${B}/orgs/${orgId}/resume`, token, {
    method: 'POST',
    body: {},
  })

export const suspendOrgSending = (
  token: string | undefined,
  orgId: number,
  reason: string
) =>
  saRequest<unknown>(`${B}/orgs/${orgId}/suspend`, token, {
    method: 'POST',
    body: { reason },
  })

export const verifyOrgSending = (token: string | undefined, orgId: number) =>
  saRequest<unknown>(`${B}/orgs/${orgId}/verify`, token, {
    method: 'POST',
    body: {},
  })

export const listGlobalSuppressions = (
  token: string | undefined,
  filters: { q?: string; page?: number }
) =>
  saRequest<{ items: GlobalSuppression[]; total: number }>(
    `${B}/suppressions`,
    token,
    { query: filters }
  )

export const addGlobalSuppression = (
  token: string | undefined,
  email: string,
  reason: string
) =>
  saRequest<GlobalSuppression>(`${B}/suppressions`, token, {
    method: 'POST',
    body: { email, reason },
  })

export const removeGlobalSuppression = (
  token: string | undefined,
  id: number
) => saRequest<unknown>(`${B}/suppressions/${id}`, token, { method: 'DELETE' })

const REASON_CODES = ['review_threshold', 'volume_spike', 'campaign_bounces', 'bounce_rate', 'complaint_rate', 'suspended']

/** The translated pause reason, or the API's text for unknown codes. */
export function pausedReasonText(t: (key: string, opts?: any) => string, o: Pick<DeliverabilityOrg, 'paused_reason' | 'paused_reason_code' | 'paused_reason_params'>): string {
  if (o.paused_reason_code && REASON_CODES.includes(o.paused_reason_code)) return t(`newsletter.reasons.${o.paused_reason_code}`, o.paused_reason_params ?? {})
  return o.paused_reason ?? ''
}
