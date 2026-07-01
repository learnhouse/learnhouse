import { NextResponse } from "next/server";
import { fetchPlanPrices, fetchPackPrices, fetchPlanLimits } from "@services/billing/stripe";
import { guardBilling } from "../_lib";

// GET /api/billing/prices
// → { plans, packs, limits } — the public-ish price/limit catalog used by the
// billing UI to override the static fallback catalog with live Stripe prices.
//
// Prices are not per-user data, so this is gated on SaaS availability only
// (guardBilling) and needs no authentication: any visitor on a SaaS deployment
// may read the plan/pack prices, exactly as they appear on the pricing page.
export async function GET() {
  const blocked = await guardBilling();
  if (blocked) return blocked;

  try {
    const [plans, packs, limits] = await Promise.all([
      fetchPlanPrices(),
      fetchPackPrices(),
      fetchPlanLimits(),
    ]);
    return NextResponse.json({ plans, packs, limits });
  } catch (err: any) {
    console.error("[billing/prices] failed:", err);
    return NextResponse.json(
      { error: err?.message ?? "Failed to load prices" },
      { status: 500 },
    );
  }
}
