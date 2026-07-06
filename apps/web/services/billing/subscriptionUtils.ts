// Pure, dependency-free helpers for resolving the correct Stripe subscription
// and customer for an organization.
//
// These deliberately live OUTSIDE stripe.ts (which imports the Stripe SDK and is
// server-only). Keeping the pure decision logic here lets us unit-test it in
// isolation — no Stripe SDK, no network.

export type Subscriptionish = {
  status?: string;
  created?: number;
  metadata?: { org_id?: unknown; type?: string } | null;
};

// Statuses we treat as a live plan subscription the user can switch/cancel,
// ordered best → worst (used for ranking when an org has more than one).
//
//   active / trialing     — healthy, currently paying.
//   past_due / unpaid     — a renewal failed, but the FIRST payment succeeded,
//                           so this is still the customer's subscription. If we
//                           ignored these the UI would think they have no sub
//                           and route them into a brand-new checkout — billing
//                           them twice. They must remain switchable/cancelable.
//
// `incomplete` / `incomplete_expired` are intentionally excluded: no payment
// ever succeeded, so a fresh checkout is the correct path for those.
export const SWITCHABLE_STATUSES = ["active", "trialing", "past_due", "unpaid"] as const;

export function isSwitchableStatus(status: string | undefined): boolean {
  return status !== undefined && (SWITCHABLE_STATUSES as readonly string[]).includes(status);
}

/**
 * Select an organization's PLAN subscription from a flat list of subscriptions
 * that may span multiple Stripe customers (a single email can map to several
 * customer records). Pack add-on subscriptions and non-switchable statuses are
 * excluded. When an org somehow has more than one matching subscription, the
 * healthiest status wins, then the most recently created.
 */
export function selectOrgPlanSubscription<T extends Subscriptionish>(
  subs: readonly T[],
  orgId: string | number,
): T | null {
  const wanted = String(orgId);
  const matches = subs.filter(
    (s) =>
      String(s?.metadata?.org_id) === wanted &&
      s?.metadata?.type !== "pack" &&
      isSwitchableStatus(s?.status),
  );
  if (matches.length === 0) return null;

  const rank = (s: T) => (SWITCHABLE_STATUSES as readonly string[]).indexOf(s.status as string);
  return [...matches].sort((a, b) => rank(a) - rank(b) || (b.created ?? 0) - (a.created ?? 0))[0];
}

/**
 * Pick the customer to use for a NEW checkout. Reuse a customer that already
 * holds a subscription (any product) so we don't fragment the user across
 * duplicate customer records; otherwise the most-recently created customer;
 * otherwise null (the caller should create a fresh customer).
 *
 * @param customersNewestFirst Stripe returns customers newest-first.
 * @param customerIdsWithSubs   Ids of customers known to have ≥1 subscription.
 */
export function selectCheckoutCustomerId(
  customersNewestFirst: readonly { id: string }[],
  customerIdsWithSubs: ReadonlySet<string>,
): string | null {
  if (customersNewestFirst.length === 0) return null;
  const withSub = customersNewestFirst.find((c) => customerIdsWithSubs.has(c.id));
  return (withSub ?? customersNewestFirst[0]).id;
}

// ── Price → plan mapping ─────────────────────────────────────────────────────
// The org's plan must be derived from the subscription's PRICE id, not from
// `subscription.metadata.plan`. Metadata is only written at checkout/switch; if
// a customer changes their plan through the Stripe billing portal, the price
// changes but the metadata stays stale — so reconciling org config from
// metadata would set the WRONG (old) plan. The price id is the source of truth.

export type PriceMapEntry = { plan: string; billing?: "monthly" | "annual"; isPack: boolean };

/**
 * Build a reverse lookup (Stripe price id → plan/billing) from the app's
 * configured PRICE_IDS and PACK_PRICE_IDS maps. Empty/unset price ids are
 * skipped so unconfigured plans never collide on "".
 */
export function buildPriceToPlan(
  priceIds: Record<string, Partial<Record<"monthly" | "annual", string>>>,
  packPriceIds: Record<string, string> = {},
): Map<string, PriceMapEntry> {
  const map = new Map<string, PriceMapEntry>();
  for (const [plan, byBilling] of Object.entries(priceIds)) {
    for (const [billing, priceId] of Object.entries(byBilling ?? {})) {
      if (priceId) map.set(priceId, { plan, billing: billing as "monthly" | "annual", isPack: false });
    }
  }
  for (const [packId, priceId] of Object.entries(packPriceIds)) {
    if (priceId) map.set(priceId, { plan: packId, isPack: true });
  }
  return map;
}

export function planFromPriceId(
  map: ReadonlyMap<string, PriceMapEntry>,
  priceId: string | undefined | null,
): PriceMapEntry | null {
  if (!priceId) return null;
  return map.get(priceId) ?? null;
}

/**
 * The authoritative plan for an org given its (already filtered) plan
 * subscription and a price→plan map. Prefers the price-derived plan; falls back
 * to metadata.plan only when the price isn't recognized (e.g. a legacy/manually
 * created price). Returns "free" when there is no live subscription.
 */
export function effectivePlanForSubscription(
  subscription: { metadata?: { plan?: string } | null; items?: { data?: { price?: { id?: string } }[] } } | null,
  priceToPlan: ReadonlyMap<string, PriceMapEntry>,
): string {
  if (!subscription) return "free";
  const priceId = subscription.items?.data?.[0]?.price?.id;
  const derived = planFromPriceId(priceToPlan, priceId);
  if (derived && !derived.isPack) return derived.plan;
  return subscription.metadata?.plan ?? "free";
}
