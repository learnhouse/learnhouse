import "server-only";
/**
 * Active-user overage billing.
 *
 * The backend (apps/api) computes the number of active users (members seen on
 * >=2 distinct UTC days in a month) and the billable overage beyond the plan's
 * included member limit. This module pulls that number and adds it as a single
 * line on the org's existing subscription invoice — no separate charge.
 *
 * The `invoice.created` webhook (billOverageForInvoice) adds the line to that
 * specific draft invoice before Stripe finalizes it. Each renewal invoice
 * reconciles every complete month it covers, so a missed webhook is caught up
 * on the next one. Idempotent per (org, year, month).
 */
import { getServerAPIUrl } from "@services/config/config";
import { getStripeSecretKey } from "@services/billing/stripe";
import { platformApiKey } from "@services/billing/packs";
import {
  completeMonthsBefore,
  intervalMonths,
  invoiceSubscriptionId,
  monthStartUnix,
  periodKey,
} from "./activeUserBillingUtils";

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

// $1 / €1 per active user over the included limit (one minor-unit-hundred).
const OVERAGE_UNIT_AMOUNT = 100;
// Only these plans carry active-user overage.
const BILLABLE_PLANS = new Set(["standard", "pro"]);
// A renewal invoice reconciles every complete month of its own billing interval
// (1 for monthly, 12 for annual) plus this buffer, so a missed invoice.created
// webhook is caught up on the next renewal invoice. Idempotency (alreadyBilled)
// keeps it exactly-once.
const OVERAGE_LOOKBACK_BUFFER_MONTHS = 2;
// Hard ceiling, so an odd interval can't fan out into an unbounded month scan.
const OVERAGE_MAX_LOOKBACK_MONTHS = 15;

type OverageSummary = {
  org_id: number;
  plan: string;
  year: number;
  month: number;
  active_users: number;
  plan_limit: number;
  /** Members held beyond the plan's included seats; only these can be billed. */
  members_beyond_included: number;
  overage_units: number;
  overage_usd: number;
};

/** Pull the active-user overage for an org/month from the backend (platform-key auth). */
export async function fetchActiveUserOverage(
  orgId: string,
  year: number,
  month: number,
): Promise<OverageSummary | null> {
  const url = `${getServerAPIUrl()}internal/packs/${orgId}/active-user-overage?year=${year}&month=${month}`;
  const res = await fetch(url, {
    method: "GET",
    headers: { "x-platform-key": platformApiKey() },
    cache: "no-store",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "overage fetch failed" }));
    throw new Error(err.detail || `overage fetch failed (${res.status})`);
  }
  return res.json();
}

/** True if this org/period was already billed, so webhook retries and the
 *  lookback overlap between consecutive invoices never double-charge.
 *  A period's item can only be created after that month ends, so scanning from
 *  the start of the month is complete — and keeps the page count small. */
async function alreadyBilled(
  customerId: string,
  year: number,
  month: number,
): Promise<boolean> {
  const period = periodKey(year, month);
  const items = await stripe.invoiceItems
    .list({
      customer: customerId,
      created: { gte: monthStartUnix(year, month) },
      limit: 100,
    })
    .autoPagingToArray({ limit: 1000 });
  return items.some(
    (it: any) => it?.metadata?.type === "au_overage" && it?.metadata?.au_period === period,
  );
}

/**
 * Core: add the overage line for one org/month. When invoiceId is given the
 * item attaches to that specific (draft) invoice; otherwise it becomes a
 * pending item on the customer's next invoice.
 */
async function billOverage(params: {
  orgId: string;
  customerId: string;
  currency: string;
  year: number;
  month: number;
  invoiceId?: string;
}): Promise<{ billed: boolean; reason?: string; overage_units?: number }> {
  const { orgId, customerId, currency, year, month, invoiceId } = params;

  const summary = await fetchActiveUserOverage(orgId, year, month);
  if (!summary) return { billed: false, reason: "no summary" };
  if (!BILLABLE_PLANS.has(summary.plan)) return { billed: false, reason: `plan ${summary.plan}` };
  if (summary.overage_units <= 0) return { billed: false, reason: "no overage" };

  const period = periodKey(year, month);
  if (await alreadyBilled(customerId, year, month)) {
    return { billed: false, reason: "already billed" };
  }

  const monthName = new Date(Date.UTC(year, month - 1, 1)).toLocaleString("en-US", {
    month: "long",
    timeZone: "UTC",
  });

  await stripe.invoiceItems.create(
    {
      customer: customerId,
      ...(invoiceId ? { invoice: invoiceId } : {}),
      currency,
      unit_amount: OVERAGE_UNIT_AMOUNT,
      quantity: summary.overage_units,
      description: `Active members beyond plan — ${monthName} ${year} (${summary.members_beyond_included} beyond the ${summary.plan_limit} included, ${summary.overage_units} active)`,
      metadata: {
        org_id: orgId,
        type: "au_overage",
        au_period: period,
        active_users: String(summary.active_users),
        plan_limit: String(summary.plan_limit),
        members_beyond_included: String(summary.members_beyond_included),
        overage_units: String(summary.overage_units),
      },
    },
    { idempotencyKey: `au-overage-${orgId}-${period}` },
  );

  return { billed: true, overage_units: summary.overage_units };
}

/**
 * Webhook entry (invoice.created). Self-healing: adds a line for every complete
 * prior calendar month this invoice's billing interval covers that has
 * active-user overage and isn't billed yet, on the draft invoice before it
 * finalizes. Monthly subscriptions bill last month (plus a buffer); annual ones
 * reconcile the whole year. A missed invoice.created webhook is caught up
 * automatically on the next renewal invoice — no cron needed. Only acts on
 * subscription-cycle (renewal) invoices.
 */
export async function billOverageForInvoice(invoice: any): Promise<void> {
  // Renewals only: skip the first invoice (subscription_create), proration
  // updates, and manual invoices.
  if (invoice?.billing_reason !== "subscription_cycle") return;
  const subscriptionId = invoiceSubscriptionId(invoice);
  const customerId =
    typeof invoice?.customer === "string" ? invoice.customer : invoice?.customer?.id;
  if (!subscriptionId || !customerId) return;

  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const orgId = subscription?.metadata?.org_id;
  if (!orgId || subscription?.metadata?.type === "pack") return;

  const lookback = Math.min(
    intervalMonths(subscription) + OVERAGE_LOOKBACK_BUFFER_MONTHS,
    OVERAGE_MAX_LOOKBACK_MONTHS,
  );
  const periods = completeMonthsBefore(new Date(invoice.created * 1000), lookback);
  let failed = false;
  for (const { year, month } of periods) {
    try {
      const result = await billOverage({
        orgId,
        customerId,
        currency: invoice.currency,
        year,
        month,
        invoiceId: invoice.id,
      });
      console.log(
        `[au-overage] invoice ${invoice.id} org ${orgId} ${periodKey(year, month)}:`,
        JSON.stringify(result),
      );
    } catch (err) {
      failed = true;
      console.error(
        `[au-overage] failed for invoice ${invoice.id} org ${orgId} ${periodKey(year, month)}:`,
        err,
      );
    }
  }
  // Surface a failure so Stripe retries the webhook; already-billed months are
  // skipped on retry (alreadyBilled + idempotency key), so retries are safe.
  if (failed) throw new Error(`active-user overage billing failed for invoice ${invoice.id}`);
}
