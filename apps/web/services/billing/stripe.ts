import "server-only";
// SaaS subscription billing service layer (server-only).
//
// Faithful port of the platform repo's services/stripe/stripe.ts. These are
// plain server-only functions — NOT "use server" server actions — so they can
// only be invoked from route handlers that have authenticated + authorized the
// caller (see app/api/billing/_lib.ts). The `server-only` import hard-fails the
// build if any client bundle imports this module. Pure decision logic lives in
// ./subscriptionUtils; static price/type config in ./plans.
import { getServerAPIUrl, getLEARNHOUSE_HTTP_PROTOCOL_VAL, getLEARNHOUSE_DOMAIN_VAL } from "@services/config/config";
import {
  PRICE_IDS,
  PACK_PRICE_IDS,
  PRICE_TO_PLAN,
  type PlanId,
  type Billing,
  type PackId,
} from "./plans";
import {
  selectOrgPlanSubscription,
  selectCheckoutCustomerId,
  planFromPriceId,
  effectivePlanForSubscription,
  type PriceMapEntry,
} from "./subscriptionUtils";
import { updateOrganizationConfigInternally } from "./orgPlan";
import { sendPlanSwitchMail, sendSubscriptionCanceledMail } from "./emails";

// Resolve the Stripe secret key. Prefer the billing-specific STRIPE_SECRET_KEY,
// but fall back to LEARNHOUSE_STRIPE_SECRET_KEY (the platform Stripe account's
// secret key — the same account the SaaS subscription prices live in) so
// deployments that only set the LEARNHOUSE_-prefixed var still work. Shared by
// the lazy Stripe client here, the webhook route, and the billing guard.
export function getStripeSecretKey(): string | undefined {
  return process.env.STRIPE_SECRET_KEY || process.env.LEARNHOUSE_STRIPE_SECRET_KEY;
}

// Lazy Stripe client. The SDK throws if instantiated without a key, so we must
// NOT create it at module load — that would crash `next build` (page-data
// collection evaluates this module) and any non-SaaS deployment that imports it
// without a Stripe key. The Proxy instantiates the real client on first
// property access (request time, after the SaaS/key guard has run).
let _stripeClient: any = null;
const stripe: any = new Proxy(
  {},
  {
    get(_t, prop) {
      if (!_stripeClient) {
        const key = getStripeSecretKey();
        if (!key) throw new Error("STRIPE_SECRET_KEY is not configured");
        _stripeClient = require("stripe")(key);
      }
      return _stripeClient[prop];
    },
  },
);

// APP_URL is computed per-call: apps/web reads runtime config lazily, so a
// module-load constant could capture an empty domain before config is hydrated.
function appUrl(): string {
  return `${getLEARNHOUSE_HTTP_PROTOCOL_VAL()}${getLEARNHOUSE_DOMAIN_VAL()}`;
}

/** Resolve a Stripe price id to its plan/billing (or pack). */
export async function planForPriceId(priceId: string | undefined | null): Promise<PriceMapEntry | null> {
  return planFromPriceId(PRICE_TO_PLAN, priceId);
}

// Stripe's basil API (2025-03-31) moved the billing-period fields off the
// top-level subscription object onto each subscription item. Read from the
// item, falling back to the legacy top-level field for older API versions.
// Every subscription here is created with a single line item, so data[0] is
// the relevant item.
function getPeriodEnd(subscription: any): number | undefined {
  return subscription?.items?.data?.[0]?.current_period_end ?? subscription?.current_period_end;
}
function getPeriodStart(subscription: any): number | undefined {
  return subscription?.items?.data?.[0]?.current_period_start ?? subscription?.current_period_start;
}

// ── Customer resolution ──────────────────────────────────────────────────────
// A single email can map to MULTIPLE Stripe customers. Duplicates arise because
// other LearnHouse products share this Stripe account and create their own
// customer per email. `customers.list({ email, limit: 1 })` returns an arbitrary
// (most-recently created) customer, which may not be the one holding this org's
// subscription — that made getActiveSubscription return null and wrongly route
// paying users into a brand-new checkout (duplicate sub). Always resolve across
// ALL customers for the email.
async function listCustomerIdsByEmail(email: string): Promise<string[]> {
  const customers = await stripe.customers.list({ email, limit: 100 });
  return customers.data.map((c: any) => c.id);
}

// Find the org's PLAN subscription (never a pack) across every customer that
// shares this email. Selection/ranking lives in subscriptionUtils so it can be
// unit-tested without the Stripe SDK.
async function findOrgPlanSubscription(email: string, orgId: string): Promise<any | null> {
  const customerIds = await listCustomerIdsByEmail(email);
  if (customerIds.length === 0) return null;

  const allSubs: any[] = [];
  for (const customerId of customerIds) {
    const subs = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 100 });
    allSubs.push(...subs.data);
  }
  return selectOrgPlanSubscription(allSubs, orgId);
}

// Resolve the customer to use for a new checkout: reuse the one that already
// holds a subscription for this email (any product), else the most-recent
// customer, else null (caller creates a fresh customer). Avoids fragmenting a
// user across duplicate customer records.
async function resolveExistingCustomerId(email: string): Promise<string | null> {
  const customers = await stripe.customers.list({ email, limit: 100 }); // newest-first
  if (customers.data.length === 0) return null;

  const idsWithSubs = new Set<string>();
  for (const c of customers.data) {
    const subs = await stripe.subscriptions.list({ customer: c.id, status: "all", limit: 1 });
    if (subs.data.length > 0) idsWithSubs.add(c.id);
  }
  return selectCheckoutCustomerId(customers.data, idsWithSubs);
}

export async function validatePromotionCode(code: string): Promise<{ valid: boolean; promotionCodeId?: string; couponId?: string; percentOff?: number; amountOff?: number; currency?: string }> {
  if (!code.trim()) return { valid: false };
  try {
    // Stripe's clover API (2025-09-30, "polymorphic-coupon") moved the coupon
    // off the top-level PromotionCode object into `promotion.coupon`. Expand it
    // so we get the full coupon object; fall back to the legacy `coupon` field
    // for older API versions.
    const promotionCodes = await stripe.promotionCodes.list({
      code: code.trim(),
      active: true,
      limit: 1,
      expand: ["data.promotion.coupon"],
    });
    if (promotionCodes.data.length === 0) return { valid: false };
    const promo = promotionCodes.data[0];
    const coupon = promo.promotion?.coupon ?? promo.coupon;
    // A promotion code can be `active` while its coupon is no longer valid
    // (redeemed out / past redeem_by). Treat that as invalid so the UI doesn't
    // show "Code applied" and then have Stripe reject it at apply time.
    if (!coupon || coupon.valid === false) return { valid: false };
    return {
      valid: true,
      promotionCodeId: promo.id,
      couponId: coupon.id,
      percentOff: coupon.percent_off ?? undefined,
      amountOff: coupon.amount_off ? coupon.amount_off / 100 : undefined,
      currency: coupon.currency ?? undefined,
    };
  } catch {
    return { valid: false };
  }
}

export async function createCheckoutSession(
  plan: PlanId,
  billing: Billing,
  email: string,
  orgId: string,
  orgSlug?: string,
  promotionCode?: string,
) {
  const priceId = (PRICE_IDS as Record<string, Record<Billing, string>>)[plan]?.[billing];
  if (!priceId) throw new Error(`No Stripe price ID configured for plan "${plan}" / billing "${billing}". Set the corresponding STRIPE_PRICE_* env var.`);

  const existingCustomerId = await resolveExistingCustomerId(email);
  const customerId = existingCustomerId ?? (await stripe.customers.create({ email })).id;

  // If a promotion code is provided, resolve it and pre-apply as a discount;
  // otherwise let Stripe show its own promo-code input field.
  let discountsOrPromo: Record<string, any> = { allow_promotion_codes: true };
  if (promotionCode?.trim()) {
    const resolved = await validatePromotionCode(promotionCode);
    if (resolved.valid && resolved.promotionCodeId) {
      discountsOrPromo = { discounts: [{ promotion_code: resolved.promotionCodeId }] };
    }
  }

  const APP_URL = appUrl();
  // cancelUrl returns the user to their plan page if org context is known,
  // otherwise the new-org flow — so they land with context instead of a
  // blank org list and have to navigate back to checkout themselves.
  // The `checkout=cancelled` marker lets the landing page fire a
  // `checkout_canceled` analytics event (closing the checkout_initiated loop).
  const cancelUrl = orgSlug
    ? `${APP_URL}/dashboard/${orgSlug}/plan?checkout=cancelled`
    : `${APP_URL}/dashboard/new?checkout=cancelled`;

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    mode: "subscription",
    ...discountsOrPromo,
    subscription_data: {
      metadata: { org_id: orgId, plan, billing, ...(orgSlug ? { org_slug: orgSlug } : {}) },
    },
    success_url: `${APP_URL}/dashboard?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url:  cancelUrl,
  });

  return { id: session.id, url: session.url };
}

export async function getCustomerPortal(email: string) {
  // Open the portal for the customer that actually holds the subscriptions,
  // not an arbitrary duplicate customer record for this email.
  const customerId = await resolveExistingCustomerId(email);
  if (!customerId) return null;

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${appUrl()}/dashboard`,
  });
  return session.url;
}

export async function getActiveSubscription(email: string, orgId: string) {
  // Resolves the org's plan subscription across ALL customers for this email,
  // including recoverable states (past_due/unpaid) and excluding pack subs.
  return findOrgPlanSubscription(email, orgId);
}

export async function switchSubscriptionPlan(
  email: string,
  orgId: string,
  newPlan: PlanId,
  newBilling: Billing,
  downgrade = false,
  promotionCode?: string,
) {
  const newPriceId = (PRICE_IDS as Record<string, Record<Billing, string>>)[newPlan]?.[newBilling];
  if (!newPriceId) throw new Error(`No Stripe price ID configured for plan "${newPlan}" / billing "${newBilling}".`);

  const subscription = await getActiveSubscription(email, orgId);
  if (!subscription) throw new Error("No active subscription found for this organization");

  const oldPlan = subscription.metadata.plan || "free";

  if (downgrade) {
    // Resolve promotion code to coupon if provided
    let downgradeCoupon: string | undefined;
    if (promotionCode?.trim()) {
      const resolved = await validatePromotionCode(promotionCode);
      if (resolved.valid && resolved.couponId) {
        downgradeCoupon = resolved.couponId;
      }
    }

    // Schedule the plan change at the end of the current billing period.
    const periodEnd = getPeriodEnd(subscription);
    if (!periodEnd) throw new Error("Could not determine current period end for subscription");

    // Reuse an existing schedule if the subscription already has one (e.g. a
    // prior scheduled downgrade); a second `from_subscription` create throws
    // "Subscription already has a schedule".
    const scheduleId: string = subscription.schedule
      ? (typeof subscription.schedule === "string" ? subscription.schedule : subscription.schedule.id)
      : (await stripe.subscriptionSchedules.create({ from_subscription: subscription.id })).id;

    // Keep Stripe's own seeded start anchor for the current phase.
    const schedule = await stripe.subscriptionSchedules.retrieve(scheduleId);
    const currentPhaseStart = schedule.phases?.[0]?.start_date ?? getPeriodStart(subscription);

    await stripe.subscriptionSchedules.update(scheduleId, {
      end_behavior: "release",
      // No proration: the user keeps the plan they already paid for until period
      // end, and the new plan starts cleanly next cycle — exactly what the UI
      // promises. A proration invoice here would contradict that.
      proration_behavior: "none",
      phases: [
        {
          items: [{ price: subscription.items.data[0].price.id, quantity: 1 }],
          start_date: currentPhaseStart,
          end_date: periodEnd,
          metadata: { org_id: orgId, plan: subscription.metadata.plan, billing: subscription.metadata.billing },
        },
        {
          items: [{ price: newPriceId, quantity: 1 }],
          start_date: periodEnd,
          metadata: { org_id: orgId, plan: newPlan, billing: newBilling },
          ...(downgradeCoupon ? { discounts: [{ coupon: downgradeCoupon }] } : {}),
        },
      ],
    });

    // Send downgrade notification email
    await sendPlanSwitchMail({
      email,
      oldPlan,
      newPlan: newPlan as string,
      isDowngrade: true,
    }).catch((err) => console.error("Failed to send plan switch email:", err));

    return { scheduled: true, plan: newPlan };
  }

  // Resolve the promotion code. Apply it by `promotion_code` (not the bare
  // coupon) so the promotion's own restrictions — max redemptions, per-customer
  // limits, expiry, minimum amount — are enforced, matching the checkout path.
  let discountParam: Record<string, any> = {};
  if (promotionCode?.trim()) {
    const resolved = await validatePromotionCode(promotionCode);
    if (resolved.valid && resolved.promotionCodeId) {
      discountParam = { discounts: [{ promotion_code: resolved.promotionCodeId }] };
    }
  }

  // Upgrade: apply immediately with proration. Preserve existing metadata
  // (e.g. org_slug, used by the cancellation email) and only override the
  // plan/billing keys.
  await stripe.subscriptions.update(subscription.id, {
    items: [{
      id: subscription.items.data[0].id,
      price: newPriceId,
    }],
    proration_behavior: "create_prorations",
    metadata: { ...(subscription.metadata ?? {}), org_id: orgId, plan: newPlan, billing: newBilling },
    ...discountParam,
  });

  // Best-effort direct org-config update. Stripe has already applied the
  // upgrade at this point, so a backend hiccup here must NOT surface to the
  // user as a failed upgrade — the customer.subscription.updated webhook
  // reconciles org config as the safety net.
  try {
    await updateOrganizationConfigInternally(orgId, newPlan as any);
  } catch (err) {
    console.error("[switchSubscriptionPlan] post-update config sync failed (webhook will reconcile):", err);
  }

  // Send upgrade notification email
  await sendPlanSwitchMail({
    email,
    oldPlan,
    newPlan: newPlan as string,
    isDowngrade: false,
  }).catch((err) => console.error("Failed to send plan switch email:", err));

  return { updated: true, plan: newPlan };
}

export async function cancelSubscription(email: string, orgId: string) {
  const subscription = await getActiveSubscription(email, orgId);
  if (!subscription) throw new Error("No active subscription found for this organization");

  const canceled = await stripe.subscriptions.update(subscription.id, {
    cancel_at_period_end: true,
  });

  // Send cancellation email
  await sendSubscriptionCanceledMail({
    email,
    planName: subscription.metadata.plan || "unknown",
    orgSlug: subscription.metadata.org_slug,
  }).catch((err) => console.error("Failed to send cancellation email:", err));

  return canceled;
}

/**
 * Verify a completed checkout session and update the org plan.
 * Called when the user returns from Stripe checkout with a session_id.
 * This is a safety net — the webhook should also handle this, but
 * webhooks can be delayed or misconfigured (especially on localhost).
 */
export async function fulfillCheckoutSession(sessionId: string) {
  try {
    // Stripe's basil API (2025-03-31) defers subscription creation until after
    // payment completes, so the expanded `subscription` can briefly be null
    // right after the redirect. Retry the retrieve until it (and its metadata)
    // is available.
    let checkoutSession: any;
    let subscription: any;
    for (let attempt = 0; attempt < 3; attempt++) {
      checkoutSession = await stripe.checkout.sessions.retrieve(sessionId, {
        expand: ["subscription"],
      });

      if (checkoutSession.payment_status !== "paid") {
        return { fulfilled: false, reason: "not_paid" };
      }

      subscription = checkoutSession.subscription;
      if (subscription?.metadata?.org_id && subscription?.metadata?.plan) break;
      if (attempt < 2) await new Promise(r => setTimeout(r, 1000));
    }

    console.log("[fulfillCheckout] payment_status:", checkoutSession.payment_status);
    console.log("[fulfillCheckout] subscription metadata:", subscription?.metadata);

    if (!subscription?.metadata?.org_id || !subscription?.metadata?.plan) {
      console.error("[fulfillCheckout] Missing metadata on subscription:", subscription?.metadata);
      return { fulfilled: false, reason: "missing_metadata" };
    }

    console.log("[fulfillCheckout] Updating org", subscription.metadata.org_id, "to plan", subscription.metadata.plan);

    // Retry up to 3 times with 1s delay
    let lastError: any;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await updateOrganizationConfigInternally(
          subscription.metadata.org_id,
          subscription.metadata.plan,
        );
        lastError = null;
        break;
      } catch (err) {
        lastError = err;
        console.warn(`[fulfillCheckout] Attempt ${attempt + 1} failed:`, err);
        if (attempt < 2) await new Promise(r => setTimeout(r, 1000));
      }
    }
    if (lastError) throw lastError;

    return {
      fulfilled: true,
      orgId: subscription.metadata.org_id,
      plan: subscription.metadata.plan,
    };
  } catch (err) {
    console.error("[fulfillCheckout] Error:", err);
    return { fulfilled: false, reason: "error" };
  }
}

export async function getSubscriptionDetails(email: string, orgId: string) {
  const subscription = await getActiveSubscription(email, orgId);
  if (!subscription) return null;

  return {
    id: subscription.id,
    status: subscription.status,
    plan: subscription.metadata.plan,
    billing: subscription.metadata.billing as Billing,
    currentPeriodStart: getPeriodStart(subscription),
    currentPeriodEnd: getPeriodEnd(subscription),
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    priceId: subscription.items.data[0]?.price?.id,
    amount: subscription.items.data[0]?.price?.unit_amount,
    currency: subscription.items.data[0]?.price?.currency,
    interval: subscription.items.data[0]?.price?.recurring?.interval,
  };
}

// ── Pack Add-on Functions ──────────────────────────────────────────────────────

export async function createPackCheckoutSession(
  packId: PackId,
  email: string,
  orgId: string,
  orgSlug?: string,
) {
  const priceId = PACK_PRICE_IDS[packId];
  if (!priceId) throw new Error(`No Stripe price ID configured for pack "${packId}". Set STRIPE_PRICE_PACK_* env var.`);

  const existingCustomerId = await resolveExistingCustomerId(email);
  const customerId = existingCustomerId ?? (await stripe.customers.create({ email })).id;

  const APP_URL = appUrl();
  const returnPath = orgSlug ? `/dashboard/${orgSlug}/plan` : '/dashboard';
  const session = await stripe.checkout.sessions.create({
    payment_method_types: ["card"],
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    mode: "subscription",
    allow_promotion_codes: true,
    subscription_data: {
      metadata: { org_id: orgId, pack_id: packId, type: "pack", ...(orgSlug ? { org_slug: orgSlug } : {}) },
    },
    success_url: `${APP_URL}${returnPath}?pack_purchased=${packId}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url:  `${APP_URL}${returnPath}?checkout=cancelled&pack=${packId}`,
  });

  return { id: session.id, url: session.url };
}

export async function getActivePackSubscriptions(email: string, orgId: string) {
  // Packs can live on any of the email's (possibly duplicate) customers.
  const customerIds = await listCustomerIdsByEmail(email);
  if (customerIds.length === 0) return [];

  // Include past_due/unpaid (not just active) so an org doesn't silently lose
  // pack entitlement during a failed renewal — mirrors plan resolution.
  const PACK_KEEP_STATUSES = ["active", "trialing", "past_due", "unpaid"];
  const packs: any[] = [];
  for (const customerId of customerIds) {
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 100,
    });
    packs.push(
      ...subscriptions.data.filter(
        (sub: any) =>
          String(sub.metadata.org_id) === String(orgId) &&
          sub.metadata.type === "pack" &&
          PACK_KEEP_STATUSES.includes(sub.status)
      )
    );
  }
  return packs;
}

export async function getPackSubscriptionDetails(subscriptionId: string) {
  const sub = await stripe.subscriptions.retrieve(subscriptionId);
  return {
    id: sub.id,
    status: sub.status,
    currentPeriodEnd: getPeriodEnd(sub),
    cancelAtPeriodEnd: sub.cancel_at_period_end,
  };
}

export async function cancelPackSubscription(subscriptionId: string) {
  const canceled = await stripe.subscriptions.update(subscriptionId, {
    cancel_at_period_end: true,
  });
  return canceled;
}

// ── Fetch pack prices from Stripe ────────────────────────────────────────────

export interface StripePackPrice {
  price: number;
  currency: string;
}

export interface StripePackPrices {
  [packId: string]: StripePackPrice;
}

/**
 * Fetch actual prices from Stripe for all pack add-ons.
 * Works the same way as fetchPlanPrices — supports Adaptive Pricing.
 */
export async function fetchPackPrices(displayCurrency?: string): Promise<StripePackPrices> {
  const result: StripePackPrices = {};

  const packs = Object.keys(PACK_PRICE_IDS) as PackId[];

  await Promise.all(
    packs.map(async (packId) => {
      const priceId = PACK_PRICE_IDS[packId];
      if (!priceId) return;

      try {
        const price = await stripe.prices.retrieve(priceId, {
          expand: displayCurrency ? ['currency_options'] : [],
        });
        const extracted = extractAmount(price, displayCurrency);
        result[packId] = {
          price: extracted.amount,
          currency: extracted.currency,
        };
      } catch (err) {
        console.warn(`[fetchPackPrices] Failed to fetch price for pack ${packId}:`, err);
      }
    })
  );

  return result;
}

// ── Fetch prices from Stripe ─────────────────────────────────────────────────

/**
 * Per-plan price info from Stripe.
 * `monthly` = price per month (from the monthly price ID)
 * `annualPerMonth` = price per month when billed annually (annual total / 12)
 * `annualTotal` = full annual price
 * `currency` = currency code from Stripe (e.g. 'eur', 'usd')
 */
export interface StripePlanPrice {
  monthly: number;
  annualPerMonth: number;
  annualTotal: number;
  currency: string;
}

export interface StripePlanPrices {
  [planId: string]: StripePlanPrice;
}

/**
 * Extract the amount for a given display currency from a Stripe price.
 * If the price has Adaptive Pricing / currency_options for the requested
 * currency, use that. Otherwise fall back to the price's base currency.
 */
function extractAmount(price: any, displayCurrency?: string): { amount: number; currency: string } {
  // Check currency_options first (Stripe Adaptive Pricing)
  if (displayCurrency && price.currency_options?.[displayCurrency]) {
    const opt = price.currency_options[displayCurrency];
    return {
      amount: (opt.unit_amount ?? 0) / 100,
      currency: displayCurrency,
    };
  }
  // Fall back to the price's base currency
  return {
    amount: (price.unit_amount ?? 0) / 100,
    currency: price.currency,
  };
}

/**
 * Fetch actual prices from Stripe for all plans.
 * Uses the recurring.interval from each Stripe price to correctly
 * separate monthly vs annual pricing.
 *
 * @param displayCurrency — optional currency code (e.g. 'eur'). If the Stripe
 *   price has Adaptive Pricing enabled, the converted amount for that currency
 *   is returned. Otherwise falls back to the price's base currency.
 */
export async function fetchPlanPrices(displayCurrency?: string): Promise<StripePlanPrices> {
  const result: StripePlanPrices = {};

  const plans = Object.keys(PRICE_IDS) as (keyof typeof PRICE_IDS)[];

  await Promise.all(
    plans.map(async (plan) => {
      const monthlyPriceId = PRICE_IDS[plan].monthly;
      const annualPriceId = PRICE_IDS[plan].annual;

      let monthly = 0;
      let annualTotal = 0;
      let annualPerMonth = 0;
      let currency = 'usd';

      // Fetch monthly price
      if (monthlyPriceId) {
        try {
          const price = await stripe.prices.retrieve(monthlyPriceId, {
            expand: displayCurrency ? ['currency_options'] : [],
          });
          const extracted = extractAmount(price, displayCurrency);
          currency = extracted.currency;

          if (price.recurring?.interval === 'year') {
            annualTotal = extracted.amount;
            annualPerMonth = Math.round((extracted.amount / 12) * 100) / 100;
          } else {
            monthly = extracted.amount;
          }
        } catch (err) {
          console.warn(`[fetchPlanPrices] Failed to fetch monthly price for ${plan}:`, err);
        }
      }

      // Fetch annual price
      if (annualPriceId) {
        try {
          const price = await stripe.prices.retrieve(annualPriceId, {
            expand: displayCurrency ? ['currency_options'] : [],
          });
          const extracted = extractAmount(price, displayCurrency);
          currency = extracted.currency;

          if (price.recurring?.interval === 'month') {
            monthly = extracted.amount;
          } else {
            annualTotal = extracted.amount;
            annualPerMonth = Math.round((extracted.amount / 12) * 100) / 100;
          }
        } catch (err) {
          console.warn(`[fetchPlanPrices] Failed to fetch annual price for ${plan}:`, err);
        }
      }

      if (monthly > 0 || annualTotal > 0) {
        result[plan] = { monthly, annualPerMonth, annualTotal, currency };
      }
    })
  );

  return result;
}

// ── Fetch plan limits from backend ────────────────────────────────────────────

export interface PlanLimitEntry {
  courses: number;
  members: number;
  admin_seats: number;
  ai_credits: number;
  storage: number;
}

export interface PlanLimits {
  [planId: string]: PlanLimitEntry;
}

/** Cached response + timestamp for plan limits */
let _planLimitsCache: { data: PlanLimits; fetchedAt: number } | null = null;
const PLAN_LIMITS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Fetches plan limits from the backend API (GET /api/v1/plans).
 * The backend's plans.py is the single source of truth for all plan limits.
 * Results are cached for 5 minutes to avoid redundant requests.
 */
export async function fetchPlanLimits(): Promise<PlanLimits> {
  // Return cached if still fresh
  if (_planLimitsCache && Date.now() - _planLimitsCache.fetchedAt < PLAN_LIMITS_CACHE_TTL) {
    return _planLimitsCache.data;
  }

  // Plan limits live on the backend API (getServerAPIUrl() already ends in
  // /api/v1/), NOT on the frontend domain — hitting the latter 404s. This is a
  // "use server" action, so THROWING here surfaces as an unhandled
  // server-action exception on every caller route even though callers catch the
  // rejection. Plan limits are display-only and change rarely, so degrade
  // gracefully: serve the last good value (even if stale), else an empty map.
  // Callers already fall back to hardcoded limits when the map is empty.
  try {
    const res = await fetch(`${getServerAPIUrl()}plans`, { next: { revalidate: 300 } });
    if (!res.ok) {
      console.warn(`[fetchPlanLimits] /plans returned ${res.status}; serving ${_planLimitsCache ? "stale cache" : "empty"}`);
      return _planLimitsCache?.data ?? {};
    }
    const data: PlanLimits = await res.json();
    _planLimitsCache = { data, fetchedAt: Date.now() };
    return data;
  } catch (err) {
    console.warn("[fetchPlanLimits] fetch failed; serving fallback:", err);
    return _planLimitsCache?.data ?? {};
  }
}

// ── Reconciliation ───────────────────────────────────────────────────────────

/**
 * Reconcile every org's stored plan against Stripe (the source of truth).
 * Durable backstop for the failure modes webhooks can't fully cover: a missed
 * `customer.subscription.deleted` (org stuck on a paid plan after cancel), a
 * billing-portal plan change (price updated but metadata.plan stale), or any
 * dropped webhook delivery.
 *
 * Iterates all subscriptions, groups plan subs by org, derives each org's plan
 * from its live subscription's PRICE, and pushes the correct plan to the
 * backend. Orgs whose only subs are canceled/expired are set to "free".
 * Idempotent — safe to run on a schedule.
 */
export async function reconcileAllOrgPlans(): Promise<{
  orgsChecked: number;
  updated: { orgId: string; plan: string }[];
  errors: number;
}> {
  const subsByOrg = new Map<string, any[]>();
  let startingAfter: string | undefined;
  for (let page = 0; page < 50; page++) { // safety cap (≤5000 subs)
    const res = await stripe.subscriptions.list({
      status: "all",
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    for (const sub of res.data) {
      const orgId = sub.metadata?.org_id;
      if (!orgId || sub.metadata?.type === "pack") continue; // skip partner/pack subs
      const key = String(orgId);
      (subsByOrg.get(key) ?? subsByOrg.set(key, []).get(key)!).push(sub);
    }
    if (!res.has_more) break;
    startingAfter = res.data[res.data.length - 1]?.id;
  }

  const updated: { orgId: string; plan: string }[] = [];
  let errors = 0;

  for (const [orgId, subs] of Array.from(subsByOrg)) {
    const best = selectOrgPlanSubscription(subs, orgId);
    const plan = effectivePlanForSubscription(best, PRICE_TO_PLAN);
    try {
      await updateOrganizationConfigInternally(orgId, plan as any);
      updated.push({ orgId, plan });
    } catch (err) {
      errors++;
      console.error(`[reconcileAllOrgPlans] failed for org ${orgId}:`, err);
    }
  }

  return { orgsChecked: subsByOrg.size, updated, errors };
}
