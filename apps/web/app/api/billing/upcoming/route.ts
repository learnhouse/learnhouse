import { NextRequest, NextResponse } from "next/server";
import { getUpcomingInvoice } from "@services/billing/stripe";
import { guardBilling, badRequest, requireOrgBillingAccess } from "../_lib";

// GET /api/billing/upcoming?orgId=…
// → preview of the org's next plan invoice, or `null` when there is nothing to
// preview (no subscription, or a subscription Stripe won't bill again).
// Email comes from the authenticated session; caller must be an admin of orgId.
export async function GET(request: NextRequest) {
  const blocked = await guardBilling();
  if (blocked) return blocked;

  const orgId = request.nextUrl.searchParams.get("orgId");
  if (!orgId) {
    return badRequest("Missing required query param: orgId");
  }

  const access = await requireOrgBillingAccess(orgId);
  if ("error" in access) return access.error;

  try {
    const invoice = await getUpcomingInvoice(access.user.email, String(orgId));
    return NextResponse.json(invoice);
  } catch (err: any) {
    console.error("[billing/upcoming] failed:", err);
    return NextResponse.json(
      { error: err?.message ?? "Failed to load upcoming invoice" },
      { status: 500 },
    );
  }
}
