// Personal, Family and the AI credit pack are no longer sold. Their Stripe
// products are archived, so a checkout for them would fail at Stripe. The
// billing routes must refuse them up front, while their price ids keep
// resolving for orgs that are already subscribed.
//
// All fixtures are synthetic.

import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Map(),
}));
mock.module("@services/billing/guard", () => ({
  BillingUnavailableError: class extends Error {},
  assertSaaSBilling: async () => {},
}));

process.env.STRIPE_PRICE_PERSONAL_MONTHLY = "price_personal_m";
process.env.STRIPE_PRICE_PERSONAL_FAMILY_MONTHLY = "price_family_m";
process.env.STRIPE_PRICE_PACK_AI_500 = "price_pack_ai";

const stripeCalls = [];
mock.module("@services/billing/stripe", () => ({
  createCheckoutSession: async (...args) => {
    stripeCalls.push(["checkout", ...args]);
    return { id: "cs", url: "https://checkout.example.test" };
  },
  switchSubscriptionPlan: async (...args) => {
    stripeCalls.push(["switch", ...args]);
    return { updated: true };
  },
  createPackCheckoutSession: async (...args) => {
    stripeCalls.push(["pack", ...args]);
    return { id: "cs", url: "https://checkout.example.test" };
  },
}));

const checkout = await import("../app/api/billing/checkout/route.ts");
const sw = await import("../app/api/billing/switch/route.ts");
const pack = await import("../app/api/billing/pack-checkout/route.ts");
const plans = await import("../services/billing/plans.ts");
const hubPlans = await import("../app/(hub)/_billing/plans.ts");

function post(body) {
  return new Request("http://app.test/api/billing", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  stripeCalls.length = 0;
});

describe("retired plans", () => {
  for (const plan of ["personal", "personal-family"]) {
    test(`checkout refuses ${plan}`, async () => {
      const res = await checkout.POST(post({ plan, billing: "monthly", orgId: 1 }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("This plan is no longer available");
      expect(stripeCalls).toHaveLength(0);
    });

    test(`switching to ${plan} is refused`, async () => {
      const res = await sw.POST(post({ orgId: 1, newPlan: plan, newBilling: "monthly" }));
      expect(res.status).toBe(400);
      expect(stripeCalls).toHaveLength(0);
    });
  }

  test("existing Personal and Family subscriptions still resolve to their plan", () => {
    expect(plans.PRICE_TO_PLAN.get("price_personal_m")).toMatchObject({ plan: "personal", billing: "monthly" });
    expect(plans.PRICE_TO_PLAN.get("price_family_m")).toMatchObject({ plan: "personal-family", billing: "monthly" });
  });
});

describe("retired packs", () => {
  test("pack checkout refuses the AI credit pack", async () => {
    const res = await pack.POST(post({ packId: "ai_500", orgId: 1 }));
    expect(res.status).toBe(410);
    expect((await res.json()).error).toBe("This add-on is no longer available");
    expect(stripeCalls).toHaveLength(0);
  });

  test("the billing hub offers no retired pack", () => {
    expect(hubPlans.PURCHASABLE_PACKS.map((p) => p.id)).not.toContain("ai_500");
    expect(hubPlans.PACK_CATALOG.map((p) => p.id)).toContain("ai_500");
  });
});
