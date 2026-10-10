import { NextRequest, NextResponse } from "next/server";
import { fulfillCheckoutSession } from "@services/billing/stripe";
import { guardBilling, badRequest, requireOrgBillingAccess } from "../_lib";

// POST /api/billing/fulfill
// Body: { sessionId, orgId }
// → { fulfilled, plan? }: verifies a completed Stripe Checkout session and
// applies the org's plan directly, WITHOUT depending on webhook delivery.
//
// This is the redundant automatic upgrade path: the client calls it when the
// user lands back on /billing?checkout=success. The webhook remains the primary
// path, but if it is delayed or misconfigured (wrong dashboard endpoint / stale
// STRIPE_WEBHOOK_SECRET), the customer's return from checkout still upgrades the
// org. fulfillCheckoutSession is idempotent, only applies a session whose
// subscription belongs to the authorized org, and derives the plan from the live
// subscription (never from the request body).
export async function POST(request: NextRequest) {
  const blocked = await guardBilling();
  if (blocked) return blocked;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return badRequest("Invalid JSON body");
  }

  const { sessionId, orgId } = body ?? {};
  if (!sessionId || !orgId) {
    return badRequest("Missing required fields: sessionId, orgId");
  }

  // Authorize the caller for this org. fulfillCheckoutSession then checks the
  // session's subscription is this org's, so a caller cannot replay another
  // org's paid session onto an org they administer.
  const access = await requireOrgBillingAccess(orgId);
  if ("error" in access) return access.error;

  try {
    const result = await fulfillCheckoutSession(String(sessionId), String(orgId));
    return NextResponse.json(result);
  } catch (err: any) {
    console.error("[billing/fulfill] failed:", err);
    return NextResponse.json(
      { error: err?.message ?? "Fulfillment failed" },
      { status: 500 },
    );
  }
}
