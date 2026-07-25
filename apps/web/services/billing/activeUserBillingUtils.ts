// Pure, dependency-free helpers for active-user overage billing.
//
// These deliberately live OUTSIDE activeUserBilling.ts (which imports the Stripe
// SDK and is server-only). Keeping the period math and payload shape handling
// here lets us unit-test it in isolation — no Stripe SDK, no network.

/** The `count` complete calendar months strictly before a UTC date's month,
 *  oldest first. For Aug 15 with count=3 → [May, Jun, Jul]. */
export function completeMonthsBefore(
  dateUtc: Date,
  count: number,
): { year: number; month: number }[] {
  const out: { year: number; month: number }[] = [];
  let year = dateUtc.getUTCFullYear();
  let month = dateUtc.getUTCMonth() + 1; // current month, 1-12
  for (let i = 0; i < count; i++) {
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
    out.push({ year, month });
  }
  return out.reverse();
}

export function periodKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** First second of a UTC month, as a Unix timestamp. */
export function monthStartUnix(year: number, month: number): number {
  return Math.floor(Date.UTC(year, month - 1, 1) / 1000);
}

/** How many months one billing cycle of this subscription spans. Annual plans
 *  only ever get one renewal invoice a year, so their invoice has to reconcile
 *  all twelve months, not just the last one. */
export function intervalMonths(subscription: any): number {
  const recurring = subscription?.items?.data?.[0]?.price?.recurring;
  const count = recurring?.interval_count ?? 1;
  if (recurring?.interval === "year") return 12 * count;
  if (recurring?.interval === "month") return count;
  // week/day intervals bill more often than monthly — one month is enough.
  return 1;
}

/** The subscription id on an invoice. Moved under `parent` in Stripe's Basil
 *  API version; the top-level field is the pre-Basil shape. Either can arrive
 *  depending on the API version the webhook endpoint is pinned to. */
export function invoiceSubscriptionId(invoice: any): string | undefined {
  const raw = invoice?.parent?.subscription_details?.subscription ?? invoice?.subscription;
  return typeof raw === "string" ? raw : raw?.id;
}
