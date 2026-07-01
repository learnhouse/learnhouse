import { NextRequest, NextResponse } from "next/server";
import { validatePromotionCode } from "@services/billing/stripe";
import { guardBilling, authenticateUser, badRequest } from "../_lib";

// POST /api/billing/promo  body { code }
// → promotion-code validation result from Stripe ({ valid, percentOff, ... }).
//
// Gated on SaaS availability AND authentication (so anonymous callers can't
// probe the account's promotion codes), but NOT on per-org admin: a promo code
// is not org-scoped — it's only resolved/applied server-side during checkout or
// switch, both of which independently enforce org-admin.
export async function POST(request: NextRequest) {
  const blocked = await guardBilling();
  if (blocked) return blocked;

  const user = await authenticateUser();
  if (user instanceof NextResponse) return user;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return badRequest("Invalid JSON body");
  }

  const code = body?.code;
  if (typeof code !== "string" || !code.trim()) {
    return badRequest("Missing required field: code");
  }

  try {
    const result = await validatePromotionCode(code);
    return NextResponse.json(result);
  } catch (err: any) {
    console.error("[billing/promo] failed:", err);
    return NextResponse.json(
      { error: err?.message ?? "Failed to validate promotion code" },
      { status: 500 },
    );
  }
}
