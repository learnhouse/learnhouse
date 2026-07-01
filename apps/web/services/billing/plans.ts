// Plan / pack type primitives + Stripe price-id configuration.
//
// Pure config module: it exports types and constant maps so it can be imported
// from the server-only stripe.ts, the webhook route, and the cron route. Types
// may also be imported (via `import type`) by client components. The price ids
// are read from server-only env vars at module load.

export type Billing = "monthly" | "annual";
export type PlanId = "free" | "standard" | "pro" | "enterprise" | "personal" | "personal-family";
export type PaidPlanId = Exclude<PlanId, "free" | "enterprise">;
export type PackId = "ai_500" | "seats_200";
export type LearnHousePlanType = "free" | "personal" | "personal-family" | "standard" | "pro" | "enterprise";

import { buildPriceToPlan, type PriceMapEntry } from "./subscriptionUtils";

// NOTE: never hardcode price-id fallbacks. Stale test-mode ids here silently
// mask a missing env var with a price that doesn't exist in the live account
// (checkout then 400s at Stripe). An empty string fails loudly and consistently
// via the "No Stripe price ID configured" guard in stripe.ts.
export const PRICE_IDS: Record<PaidPlanId, Record<Billing, string>> = {
  standard: {
    annual:  process.env.STRIPE_PRICE_STANDARD_ANNUAL  ?? "",
    monthly: process.env.STRIPE_PRICE_STANDARD_MONTHLY ?? "",
  },
  pro: {
    annual:  process.env.STRIPE_PRICE_PRO_ANNUAL  ?? "",
    monthly: process.env.STRIPE_PRICE_PRO_MONTHLY ?? "",
  },
  personal: {
    annual:  process.env.STRIPE_PRICE_PERSONAL_ANNUAL  ?? "",
    monthly: process.env.STRIPE_PRICE_PERSONAL_MONTHLY ?? "",
  },
  "personal-family": {
    annual:  process.env.STRIPE_PRICE_PERSONAL_FAMILY_ANNUAL  ?? "",
    monthly: process.env.STRIPE_PRICE_PERSONAL_FAMILY_MONTHLY ?? "",
  },
};

// Pack add-on Stripe price IDs (monthly subscriptions)
export const PACK_PRICE_IDS: Record<PackId, string> = {
  ai_500:    process.env.STRIPE_PRICE_PACK_AI_500    ?? "",
  seats_200: process.env.STRIPE_PRICE_PACK_SEATS_200 ?? "",
};

// Reverse lookup: Stripe price id → plan/billing (or pack). Used to derive an
// org's plan from the subscription's PRICE (the source of truth) rather than
// stale metadata — see subscriptionUtils for why metadata can't be trusted
// after a billing-portal change. Built once at module load.
export const PRICE_TO_PLAN: ReadonlyMap<string, PriceMapEntry> = buildPriceToPlan(PRICE_IDS, PACK_PRICE_IDS);
