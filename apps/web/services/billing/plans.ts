import "server-only";
// Plan / pack type primitives + Stripe price-id configuration.
//
// server-only: this reads process.env.STRIPE_PRICE_* at module load, so it must
// never reach the browser. The guard turns an accidental client VALUE import
// into a hard build failure instead of silently shipping empty price-id
// constants. Type-only imports (`import type`) are elided at compile time and
// remain fine for client components; client UIs otherwise use the pure
// app/(hub)/_billing/plans.ts.

export type Billing = "monthly" | "annual";
export type PlanId = "free" | "standard" | "pro" | "business" | "enterprise" | "personal" | "personal-family";
export type PaidPlanId = Exclude<PlanId, "free" | "enterprise">;
export type PackId = "ai_500";
export type LearnHousePlanType = "free" | "personal" | "personal-family" | "standard" | "pro" | "business" | "enterprise";

import { buildPriceToPlan, parseLegacyPriceIds, type PriceMapEntry } from "./subscriptionUtils";

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
  business: {
    annual:  process.env.STRIPE_PRICE_BUSINESS_ANNUAL  ?? "",
    monthly: process.env.STRIPE_PRICE_BUSINESS_MONTHLY ?? "",
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
};

// Plans and packs that are no longer sold. Their price ids stay mapped above so
// existing subscriptions keep resolving to the right plan, but checkout, plan
// switches and pack purchases reject them.
export const RETIRED_PLANS: ReadonlySet<string> = new Set(["personal", "personal-family"]);
export const RETIRED_PACKS: ReadonlySet<string> = new Set(["ai_500"]);

// Reverse lookup: Stripe price id → plan/billing (or pack). Used to derive an
// org's plan from the subscription's PRICE (the source of truth) rather than
// stale metadata; see subscriptionUtils for why metadata can't be trusted
// after a billing-portal change. Built once at module load.
// Grandfathered prices. When a plan's price changes, existing subscribers keep
// paying the old Stripe price; it is never offered at checkout again, but their
// renewals and portal updates still carry it, so it must keep resolving to its
// plan. Each env is a comma-separated list of old price ids, e.g.
// STRIPE_PRICE_LEGACY_PRO_MONTHLY="price_old1,price_old2".
export const LEGACY_PRICE_IDS: Partial<Record<PaidPlanId, Partial<Record<Billing, string[]>>>> = {
  standard: {
    annual:  parseLegacyPriceIds(process.env.STRIPE_PRICE_LEGACY_STANDARD_ANNUAL),
    monthly: parseLegacyPriceIds(process.env.STRIPE_PRICE_LEGACY_STANDARD_MONTHLY),
  },
  pro: {
    annual:  parseLegacyPriceIds(process.env.STRIPE_PRICE_LEGACY_PRO_ANNUAL),
    monthly: parseLegacyPriceIds(process.env.STRIPE_PRICE_LEGACY_PRO_MONTHLY),
  },
};

export const PRICE_TO_PLAN: ReadonlyMap<string, PriceMapEntry> = buildPriceToPlan(PRICE_IDS, PACK_PRICE_IDS, LEGACY_PRICE_IDS);
