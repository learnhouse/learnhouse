import { NextRequest, NextResponse } from "next/server";
import { reconcileAllOrgPlans } from "@services/billing/stripe";
import { guardBilling, requireCronSecret } from "../../_lib";

// GET /api/billing/cron/reconcile  (requires header: x-cron-secret: $CRON_SECRET)
//
// Durable backstop that re-syncs every org's stored plan with Stripe (the
// source of truth). Catches missed `customer.subscription.deleted` webhooks
// (orgs stuck on a paid plan after cancel), billing-portal plan changes (stale
// metadata), and any dropped webhook delivery. Iterates ALL orgs, so it is
// gated by a shared cron secret — it must never be invocable from a browser.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const blocked = await guardBilling();
  if (blocked) return blocked;

  const forbidden = requireCronSecret(request);
  if (forbidden) return forbidden;

  try {
    const result = await reconcileAllOrgPlans();
    console.log("[billing/cron/reconcile]", JSON.stringify(result));
    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    console.error("[billing/cron/reconcile] failed:", err);
    return NextResponse.json({ ok: false, error: err?.message }, { status: 500 });
  }
}
