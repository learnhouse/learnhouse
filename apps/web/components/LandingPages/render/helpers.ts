/**
 * Pure helpers shared by the landing page renderer: safe links, video hosts,
 * countdowns and pricing plans linked to store offers.
 */
import { normalizeBillingInterval, type BillingInterval } from '@lib/payments/billingInterval'
import { youTubeId, vimeoId, toEmbedUrl } from '@/lib/media/embedUrl'

/** A pricing plan as the pricing element stores it. */
export interface PricingPlanInput {
  name: string
  price: string
  period: string
  description: string
  // One feature per line.
  features: string
  button: { text: string; link: string; [key: string]: unknown }
  highlighted: boolean
  // Links the plan to a store offer: the live price replaces `price`, the
  // button goes to the offer's checkout page, and empty name / description /
  // features fall back to the offer's own.
  offer_uuid?: string
}

export type LandingVideoSource =
  | { kind: 'embed'; src: string }
  | { kind: 'file'; src: string }
  | null

/**
 * Only known video hosts become an iframe. Anything else http(s) is treated
 * as a video file, so an arbitrary page can never be framed on the landing.
 */
export function resolveLandingVideo(url: string): LandingVideoSource {
  const trimmed = (url || '').trim()
  if (!/^https?:\/\//i.test(trimmed)) return null
  const isLoom = /^https?:\/\/www\.loom\.com\/(share|embed)\//.test(trimmed)
  if (youTubeId(trimmed) || vimeoId(trimmed) || isLoom) {
    return { kind: 'embed', src: toEmbedUrl(trimmed) }
  }
  return { kind: 'file', src: trimmed }
}

export interface CountdownParts {
  days: number
  hours: number
  minutes: number
  seconds: number
  done: boolean
}

export function countdownParts(target: string, now: Date): CountdownParts {
  const end = Date.parse(target)
  const left = Number.isNaN(end) ? 0 : Math.max(0, end - now.getTime())
  const totalSeconds = Math.floor(left / 1000)
  return {
    days: Math.floor(totalSeconds / 86400),
    hours: Math.floor((totalSeconds % 86400) / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
    done: left === 0,
  }
}

/**
 * Links typed into the landing editor end up as hrefs on a public page. Allow
 * internal paths, in-page anchors, http(s) and mailto/tel; anything else
 * (javascript:, data:, protocol-relative) becomes an inert "#".
 */
export function safeHref(link?: string): string {
  const value = (link || '').trim()
  if (!value) return '#'
  if (value.startsWith('#')) return value
  if (value.startsWith('/') && !value.startsWith('//')) return value
  if (/^(https?:\/\/|mailto:|tel:)/i.test(value)) return value
  return '#'
}

/** The fields of a public store offer that a pricing plan can draw from. */
export interface LandingOffer {
  offer_uuid: string
  name: string
  description: string
  offer_type: 'one_time' | 'subscription'
  price_type: 'fixed_price' | 'customer_choice'
  billing_interval?: string
  amount: number
  currency: string
  benefits: string
}

export interface ResolvedPricingPlan {
  name: string
  price: string
  period: string
  description: string
  features: string[]
  highlighted: boolean
  button: PricingPlanInput['button']
  // The live price is still being fetched.
  loading: boolean
  // "Pay what you want" offers: `price` is the minimum.
  priceIsMinimum: boolean
  subscription: boolean
  // Renewal period of a linked subscription offer; null for everything else.
  billingInterval: BillingInterval | null
}

const splitLines = (value: string, separator: RegExp) =>
  (value || '').split(separator).map((line) => line.trim()).filter(Boolean)

/**
 * Merge a pricing plan with the store offer it links to.
 *
 * `offers` is undefined while the listing loads. A linked offer that is not in
 * the public listing (archived, unlisted) returns null: showing a typed-in
 * price for something that can no longer be bought would be worse than
 * dropping the plan.
 */
export function resolvePricingPlan(
  plan: PricingPlanInput,
  offers: LandingOffer[] | undefined,
  formatPrice: (amount: number, currency: string) => string
): ResolvedPricingPlan | null {
  const base: ResolvedPricingPlan = {
    name: plan.name,
    price: plan.price,
    period: plan.period,
    description: plan.description,
    features: splitLines(plan.features, /\n/),
    highlighted: !!plan.highlighted,
    button: plan.button,
    loading: false,
    priceIsMinimum: false,
    subscription: false,
    billingInterval: null,
  }
  if (!plan.offer_uuid) return base
  if (!offers) return { ...base, price: '', loading: true }

  const offer = offers.find((candidate) => candidate.offer_uuid === plan.offer_uuid)
  if (!offer) return null

  return {
    ...base,
    name: plan.name || offer.name,
    description: plan.description || offer.description || '',
    features: base.features.length ? base.features : splitLines(offer.benefits, /,/),
    price: formatPrice(offer.amount, offer.currency),
    // Like the price, a subscription's period comes from the offer: a typed
    // "/ month" must not survive the offer switching to yearly billing.
    period: offer.offer_type === 'subscription' ? '' : plan.period,
    priceIsMinimum: offer.price_type === 'customer_choice',
    subscription: offer.offer_type === 'subscription',
    billingInterval: offer.offer_type === 'subscription' ? normalizeBillingInterval(offer.billing_interval) : null,
    button: { ...plan.button, link: `/store/offers/${offer.offer_uuid}` },
  }
}
