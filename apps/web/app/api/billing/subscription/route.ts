import { NextRequest, NextResponse } from "next/server";
import { getSubscriptionDetails } from "@services/billing/stripe";
import { guardBilling, badRequest, requireOrgBillingAccess } from "../_lib";

// GET /api/billing/subscription?orgId=…
// → subscription detail object, or `null` when the org has no live plan sub.
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
    const details = await getSubscriptionDetails(access.user.email, String(orgId));
    return NextResponse.json(details);
  } catch (err: any) {
    console.error("[billing/subscription] failed:", err);
    return NextResponse.json({ error: err?.message ?? "Failed to load subscription" }, { status: 500 });
  }
}
