import { NextRequest, NextResponse } from "next/server";
import { listInvoices } from "@services/billing/stripe";
import { guardBilling, badRequest, requireOrgBillingAccess } from "../_lib";

// GET /api/billing/invoices?orgId=…
// → the org's recent invoices, newest first (empty array when it has none).
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
    const invoices = await listInvoices(access.user.email, String(orgId));
    return NextResponse.json(invoices);
  } catch (err: any) {
    console.error("[billing/invoices] failed:", err);
    return NextResponse.json(
      { error: err?.message ?? "Failed to load invoices" },
      { status: 500 },
    );
  }
}
