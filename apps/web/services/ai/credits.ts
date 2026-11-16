// AI credits: balance, published per-feature prices, usage breakdown, and the
// small helpers every AI surface uses to show "About N credits" before a
// request and "Used N credits" after it. Numbers always come from the API
// (GET /orgs/{id}/ai-credits/prices); never hardcode a credit price in the UI.
import { getAPIUrl } from '@services/config/config'
import { apiFetch } from '@services/utils/ts/requests'

export type AIBalanceState = 'ok' | 'low' | 'critical' | 'empty' | 'unlimited'

export interface AICreditsSummary {
  plan: string
  base_credits: number | string
  purchased_credits: number
  total_credits: number | string
  used_credits: number
  remaining_credits: number | string
  mode?: string | null
  balance_state?: AIBalanceState
  remaining_pct?: number | null
}

export interface AIFeaturePrice {
  key: string
  label: string
  credits: number
  unit: string
  metered: boolean
  group: string
  edition: string
  extra?: Record<string, number>
  note?: string
  absorbed?: boolean
  /** "About N credits": the minimum, or a typical request when that is higher. */
  typical?: number
}

export interface AICreditPrices {
  features: AIFeaturePrice[]
  low_balance_pct: number
  critical_balance_pct: number
}

export interface AIUsageReport {
  from: string
  to: string
  days: number
  total_credits: number
  total_requests: number
  by_feature: { feature: string; label: string; credits: number; requests: number }[]
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
  by_day: { date: string; credits: number; by_feature: Record<string, number> }[]
}

export const CREDITS_HEADER = 'X-AI-Credits-Used'

/** Spoken words per minute, used to estimate audio length from a script. */
export const WORDS_PER_MINUTE = 140

export function getAICredits(orgId: number, token?: string): Promise<AICreditsSummary> {
  return apiFetch(`${getAPIUrl()}orgs/${orgId}/ai-credits`, token)
}

export function getAICreditPrices(orgId: number, token?: string): Promise<AICreditPrices> {
  return apiFetch(`${getAPIUrl()}orgs/${orgId}/ai-credits/prices`, token)
}

export function getAIUsage(orgId: number, days: number, token?: string): Promise<AIUsageReport> {
  return apiFetch(`${getAPIUrl()}orgs/${orgId}/ai-credits/usage?days=${days}`, token)
}

export function findPrice(prices: AICreditPrices | undefined | null, key: string): AIFeaturePrice | undefined {
  return prices?.features?.find((f) => f.key === key)
}

/**
 * Credits to show before ``key`` runs: published price x units (+ per-unit
 * extras), rounded up. ``null`` when the price isn't known (yet).
 * Metered features may charge more for heavy requests: the UI says "About".
 */
export function estimateCredits(
  prices: AICreditPrices | undefined | null,
  key: string,
  units = 1,
  extra?: Record<string, number>,
): number | null {
  const fp = findPrice(prices, key)
  if (!fp) return null
  if (fp.absorbed) return 0
  // Show what a typical request costs (metered features can charge more than their minimum).
  let total = Math.max(fp.credits, fp.typical ?? 0) * Math.max(units, 0)
  for (const [name, count] of Object.entries(extra || {})) {
    total += (fp.extra?.[name] || 0) * Math.max(count, 0)
  }
  if (total <= 0) return 0
  return Math.max(1, Math.ceil(total - 1e-9))
}

/** Started minutes of speech for a script (at least 1). */
export function minutesFromText(text: string, wpm = WORDS_PER_MINUTE): number {
  const words = (text || '').trim().split(/\s+/).filter(Boolean).length
  return Math.max(1, Math.ceil(words / wpm))
}

/** Credits a non-streaming AI response charged (X-AI-Credits-Used), or null. */
export function creditsUsedFromResponse(res: { headers?: { get(_name: string): string | null } } | null | undefined): number | null {
  const raw = res?.headers?.get?.(CREDITS_HEADER)
  if (raw == null || raw === '') return null
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : null
}

/** Credits carried by a stream event (`done.credits` or a `{type: 'credits'}` event). */
export function creditsFromEvent(event: any): number | null {
  if (!event || typeof event !== 'object') return null
  if ((event.type === 'credits' || event.type === 'done') && typeof event.credits === 'number') return event.credits
  return null
}

/** True for an API error that means "the organization is out of AI credits". */
export function isOutOfCreditsError(detail: unknown, status?: number): boolean {
  if (status !== undefined && status !== 402 && status !== 403) return false
  const text =
    typeof detail === 'string'
      ? detail
      : detail && typeof (detail as any).message === 'string'
        ? (detail as any).message
        : detail && typeof (detail as any).detail === 'string'
          ? (detail as any).detail
          : ''
  if ((detail as any)?.code === 'out_of_credits') return true
  return /AI credit limit reached|AI credits are not available|out of AI credits/i.test(text)
}

/** Balance state from the summary (the API sends it; older APIs don't). */
export function balanceState(summary: AICreditsSummary | undefined | null): AIBalanceState {
  if (!summary) return 'ok'
  if (summary.balance_state) return summary.balance_state
  const total = summary.total_credits
  const remaining = summary.remaining_credits
  if (typeof total !== 'number' || typeof remaining !== 'number') return 'unlimited'
  if (total <= 0 || remaining <= 0) return 'empty'
  const pct = (remaining / total) * 100
  if (pct <= 5) return 'critical'
  if (pct <= 20) return 'low'
  return 'ok'
}
