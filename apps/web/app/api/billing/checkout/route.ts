import { NextRequest, NextResponse } from "next/server";
import { createCheckoutSession } from "@services/billing/stripe";
import type { PlanId, Billing } from "@services/billing/plans";
import { guardBilling, badRequest, requireOrgBillingAccess } from "../_lib";

// POST /api/billing/checkout
// Body: { plan, billing, orgId, orgSlug?, promotionCode? }
// → { id, url } — a Stripe Checkout session to redirect the user to.
// The customer email comes from the authenticated session, never the body;
// the caller must be an admin of `orgId`.
export async function POST(request: NextRequest) {
  const blocked = await guardBilling();
  if (blocked) return blocked;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return badRequest("Invalid JSON body");
  }

  const { plan, billing, orgId, orgSlug, promotionCode } = body ?? {};
  if (!plan || !billing || !orgId) {
    return badRequest("Missing required fields: plan, billing, orgId");
  }

  const access = await requireOrgBillingAccess(orgId);
  if ("error" in access) return access.error;

  try {
    const session = await createCheckoutSession(
      plan as PlanId,
      billing as Billing,
      access.user.email,
      String(orgId),
      orgSlug ? String(orgSlug) : undefined,
      promotionCode ? String(promotionCode) : undefined,
    );
    return NextResponse.json(session);
  } catch (err: any) {
    console.error("[billing/checkout] failed:", err);
    return NextResponse.json({ error: err?.message ?? "Checkout failed" }, { status: 500 });
  }
}
