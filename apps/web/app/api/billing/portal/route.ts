import { NextResponse } from "next/server";
import { getCustomerPortal } from "@services/billing/stripe";
import { guardBilling, authenticateUser } from "../_lib";

// POST /api/billing/portal
// → { url } — a Stripe billing-portal session URL for the authenticated user's
// own customer record. Email comes from the session, never the request body
// (otherwise any user could open another user's billing portal).
export async function POST() {
  const blocked = await guardBilling();
  if (blocked) return blocked;

  const user = await authenticateUser();
  if (user instanceof NextResponse) return user;

  try {
    const url = await getCustomerPortal(user.email);
    if (!url) {
      return NextResponse.json({ error: "No billing customer found" }, { status: 404 });
    }
    return NextResponse.json({ url });
  } catch (err: any) {
    console.error("[billing/portal] failed:", err);
    return NextResponse.json({ error: err?.message ?? "Portal session failed" }, { status: 500 });
  }
}
