import { NextRequest, NextResponse } from "next/server";
import { switchSubscriptionPlan } from "@services/billing/stripe";
import type { PlanId, Billing } from "@services/billing/plans";
import { guardBilling, badRequest, requireOrgBillingAccess } from "../_lib";

// POST /api/billing/switch
// Body: { orgId, newPlan, newBilling, downgrade?, promotionCode? }
// → { scheduled, plan } (downgrade) | { updated, plan } (upgrade)
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

  const { orgId, newPlan, newBilling, downgrade, promotionCode } = body ?? {};
  if (!orgId || !newPlan || !newBilling) {
    return badRequest("Missing required fields: orgId, newPlan, newBilling");
  }

  const access = await requireOrgBillingAccess(orgId);
  if ("error" in access) return access.error;

  try {
    const result = await switchSubscriptionPlan(
      access.user.email,
      String(orgId),
      newPlan as PlanId,
      newBilling as Billing,
      Boolean(downgrade),
      promotionCode ? String(promotionCode) : undefined,
    );
    return NextResponse.json(result);
  } catch (err: any) {
    console.error("[billing/switch] failed:", err);
    return NextResponse.json({ error: err?.message ?? "Plan switch failed" }, { status: 500 });
  }
}
