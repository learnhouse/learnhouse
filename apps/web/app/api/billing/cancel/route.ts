import { NextRequest, NextResponse } from "next/server";
import { cancelSubscription } from "@services/billing/stripe";
import { guardBilling, badRequest, requireOrgBillingAccess } from "../_lib";

// POST /api/billing/cancel
// Body: { orgId }
// Marks the org's plan subscription to cancel at period end. → { ok, cancelAtPeriodEnd }
// Email comes from the authenticated session; caller must be an admin of orgId.
export async function POST(request: NextRequest) {
  const blocked = await guardBilling();
  if (blocked) return blocked;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return badRequest("Invalid JSON body");
  }

  const { orgId } = body ?? {};
  if (!orgId) {
    return badRequest("Missing required field: orgId");
  }

  const access = await requireOrgBillingAccess(orgId);
  if ("error" in access) return access.error;

  try {
    const canceled = await cancelSubscription(access.user.email, String(orgId));
    return NextResponse.json({ ok: true, cancelAtPeriodEnd: canceled?.cancel_at_period_end ?? true });
  } catch (err: any) {
    console.error("[billing/cancel] failed:", err);
    return NextResponse.json({ error: err?.message ?? "Cancellation failed" }, { status: 500 });
  }
}
