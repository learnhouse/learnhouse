import { NextRequest, NextResponse } from "next/server";
import { createPackCheckoutSession } from "@services/billing/stripe";
import type { PackId } from "@services/billing/plans";
import { guardBilling, badRequest, requireOrgBillingAccess } from "../_lib";

// POST /api/billing/pack-checkout
// Body: { packId, orgId, orgSlug? }
// → { id, url } — a Stripe Checkout session for a pack add-on subscription.
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

  const { packId, orgId, orgSlug } = body ?? {};
  if (!packId || !orgId) {
    return badRequest("Missing required fields: packId, orgId");
  }

  const access = await requireOrgBillingAccess(orgId);
  if ("error" in access) return access.error;

  try {
    const session = await createPackCheckoutSession(
      packId as PackId,
      access.user.email,
      String(orgId),
      orgSlug ? String(orgSlug) : undefined,
    );
    return NextResponse.json(session);
  } catch (err: any) {
    console.error("[billing/pack-checkout] failed:", err);
    return NextResponse.json({ error: err?.message ?? "Pack checkout failed" }, { status: 500 });
  }
}
