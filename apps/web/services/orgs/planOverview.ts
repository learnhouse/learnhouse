// Settings → Plan & usage: the plan overview payload (GET /orgs/{id}/plan-overview)
// and the pure helpers the page uses to group and summarise it. The feature
// states are computed by the API from plans.py and the org config; nothing here
// decides what a plan includes.
import { getAPIUrl } from '@services/config/config'
import { apiFetch } from '@services/utils/ts/requests'
import type { DeploymentMode } from '@services/orgs/usage'

export type FeatureState = 'included' | 'poc' | 'addon' | 'locked' | 'edition'
export type PlanStatusKey =
  | 'active'
  | 'free'
  | 'trial'
  | 'poc'
  | 'suspended'
  | 'past_due'
  | 'canceling'
  | 'community'
  | 'licensed'
export type StatusTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info'

export interface PlanFeature {
  key: string
  area: string
  state: FeatureState
  enabled: boolean
  disabled_by: 'org' | 'platform' | null
  limit: number
  upgrade_plan: string | null
  toggle_tab: string | null
}

export interface PocBrief {
  state: 'active' | 'ended'
  plan: string | null
  returns_to: string
  started_at: string | null
  ends_at: string | null
  days_left: number | null
  total_days: number
  extended: boolean
  outcome: 'won' | 'lost' | 'expired' | null
  ended_at: string | null
  contact: { name: string } | null
  unlocks: string[]
}

export interface LicenseBrief {
  active: boolean
  tier: string | null
  expires_at: number | null
  reason: string | null
}

export interface PlanOverview {
  org_id: number
  mode: DeploymentMode
  plan: string
  status: 'active' | 'free' | 'trial' | 'poc' | 'suspended' | 'community' | 'licensed'
  billing: 'stripe' | 'contract' | 'none'
  next_plan: string | null
  poc: PocBrief | null
  license: LicenseBrief | null
  features: PlanFeature[]
  usage: { newsletter_emails?: { usage: number; limit: number | 'unlimited' } }
  areas: string[]
}

/** The Stripe subscription fields the summary reads (see /api/billing/subscription). */
export interface SubscriptionLike {
  status: string
  cancelAtPeriodEnd: boolean
  currentPeriodEnd?: number
  amount?: number
  currency?: string
  interval?: string
}

export function getPlanOverview(orgId: number | string, token: string): Promise<PlanOverview> {
  return apiFetch(`${getAPIUrl()}orgs/${orgId}/plan-overview`, token)
}

export type FeatureFilter = 'all' | 'have' | 'missing'

const HAVE: FeatureState[] = ['included', 'poc', 'addon']

export function hasFeature(f: Pick<PlanFeature, 'state'>): boolean {
  return HAVE.includes(f.state)
}

/**
 * Features grouped by area, in the API's area order (areas it didn't list go
 * last, in first-seen order). Empty groups are dropped, so a filter never
 * leaves a heading with nothing under it.
 */
export function groupFeatures(
  features: PlanFeature[],
  areas: string[] = [],
  filter: FeatureFilter = 'all'
): { area: string; features: PlanFeature[] }[] {
  const keep = (f: PlanFeature) => filter === 'all' || (filter === 'have' ? hasFeature(f) : !hasFeature(f))
  const order = [...areas]
  for (const f of features) if (!order.includes(f.area)) order.push(f.area)
  return order
    .map((area) => ({ area, features: features.filter((f) => f.area === area && keep(f)) }))
    .filter((g) => g.features.length > 0)
}

export function featureCounts(features: PlanFeature[]): { all: number; have: number; missing: number; poc: number } {
  const have = features.filter(hasFeature).length
  return {
    all: features.length,
    have,
    missing: features.length - have,
    poc: features.filter((f) => f.state === 'poc').length,
  }
}

export type MeterLevel = 'ok' | 'near' | 'full' | 'unlimited'

/** Near at 80% of the limit, full at the limit. A limit of 0 or 'unlimited' never fills. */
export function meterLevel(usage: number, limit: number | 'unlimited' | null | undefined): MeterLevel {
  if (limit === 'unlimited' || !limit || limit <= 0) return 'unlimited'
  if (usage >= limit) return 'full'
  if (usage / limit >= 0.8) return 'near'
  return 'ok'
}

export function meterPercent(usage: number, limit: number | 'unlimited' | null | undefined): number {
  if (limit === 'unlimited' || !limit || limit <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((usage / limit) * 100)))
}

/** How far through the POC we are, 0 to 100, and whole days left (never negative). */
export function pocProgress(
  poc: Pick<PocBrief, 'started_at' | 'ends_at'>,
  now: number = Date.now()
): { pct: number; daysLeft: number } {
  const start = poc.started_at ? Date.parse(poc.started_at) : NaN
  const end = poc.ends_at ? Date.parse(poc.ends_at) : NaN
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return { pct: 0, daysLeft: 0 }
  const pct = Math.max(0, Math.min(100, Math.round(((now - start) / (end - start)) * 100)))
  const daysLeft = Math.max(0, Math.floor((end - now) / 86_400_000))
  return { pct, daysLeft }
}

/**
 * The status shown next to the plan name. The platform status (trial, POC,
 * suspended, self-hosted) comes first; on a paid plan the Stripe subscription
 * can then say a payment is due or the plan cancels at the period end.
 */
export function planStatus(
  overview: Pick<PlanOverview, 'status'>,
  subscription?: SubscriptionLike | null
): { key: PlanStatusKey; tone: StatusTone } {
  const s = overview.status
  if (s === 'community' || s === 'licensed') return { key: s, tone: s === 'licensed' ? 'success' : 'neutral' }
  if (s === 'poc' || s === 'trial') return { key: s, tone: 'info' }
  if (s === 'suspended') return { key: s, tone: 'danger' }
  if (subscription) {
    if (subscription.status === 'past_due' || subscription.status === 'unpaid') return { key: 'past_due', tone: 'danger' }
    if (subscription.cancelAtPeriodEnd) return { key: 'canceling', tone: 'warning' }
    if (subscription.status === 'trialing') return { key: 'trial', tone: 'info' }
  }
  if (s === 'free') return { key: 'free', tone: 'neutral' }
  return { key: 'active', tone: 'success' }
}

/** Minor units (cents) to a localized price, or null when Stripe gave nothing. */
export function formatMoney(amount: number | null | undefined, currency: string | null | undefined, locale?: string): string | null {
  if (amount == null || !currency) return null
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: currency.toUpperCase() }).format(amount / 100)
  } catch {
    return null
  }
}
