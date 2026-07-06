import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { fetchPlanPrices, fetchPackPrices, fetchPlanLimits } from "@services/billing/stripe";
import { regionFromHeaders, currencyForRegion } from "@services/billing/region";
import { guardBilling } from "../_lib";

// GET /api/billing/prices
// → { plans, packs, limits, region } — the public-ish price/limit catalog used
// by the billing UI to override the static fallback catalog with live Stripe
// prices, localized to the visitor's region (EUR for the EU via the CDN geo
// header, USD otherwise — see services/billing/region.ts).
//
// Prices are not per-user data, so this is gated on SaaS availability only
// (guardBilling) and needs no authentication: any visitor on a SaaS deployment
// may read the plan/pack prices, exactly as they appear on the pricing page.
export async function GET() {
  const blocked = await guardBilling();
  if (blocked) return blocked;

  const region = regionFromHeaders(await headers());
  const currency = currencyForRegion(region);

  try {
    const [plans, packs, limits] = await Promise.all([
      fetchPlanPrices(currency),
      fetchPackPrices(currency),
      fetchPlanLimits(),
    ]);
    return NextResponse.json({ plans, packs, limits, region });
  } catch (err: any) {
    console.error("[billing/prices] failed:", err);
    return NextResponse.json(
      { error: err?.message ?? "Failed to load prices" },
      { status: 500 },
    );
  }
}
