// Behaviour tests for the post-checkout fulfillment fallback and the immediate
// upgrade path. Both grant a plan right away, so both must only act on the
// caller's own org and on a subscription in good standing.
//
// All fixtures are synthetic.

import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

// plans.ts reads price ids at module load; map invented ids before importing.
process.env.STRIPE_SECRET_KEY = "sk_test_stub";
process.env.STRIPE_PRICE_PRO_MONTHLY = "price_test_pro";
process.env.STRIPE_PRICE_STANDARD_MONTHLY = "price_test_standard";
process.env.STRIPE_PRICE_PACK_AI_500 = "price_test_pack";

const planWrites = [];
const subscriptionUpdates = [];
let sessionFixture = null;
let orgSubscriptions = [];

mock.module("@services/billing/orgPlan", () => ({
  updateOrganizationConfigInternally: async (orgId, plan) => {
    planWrites.push({ orgId, plan });
    return { ok: true };
  },
}));

mock.module("@services/billing/emails", () => ({
  sendPlanSwitchMail: async () => ({}),
  sendSubscriptionCanceledMail: async () => ({}),
}));

const scheduleUpdates = [];

const fakeStripe = {
  subscriptionSchedules: {
    create: async () => ({ id: "sub_sched_test" }),
    retrieve: async () => ({ id: "sub_sched_test", phases: [{ start_date: 1 }] }),
    update: async (id, params) => {
      scheduleUpdates.push({ id, params });
      return { id };
    },
  },
  checkout: { sessions: { retrieve: async () => sessionFixture } },
  customers: { list: async () => ({ data: [{ id: "cus_test" }] }) },
  subscriptions: {
    list: async () => ({ data: orgSubscriptions }),
    update: async (id, params) => {
      subscriptionUpdates.push({ id, params });
      return { id };
    },
  },
};
// stripe.ts loads the SDK with `require("stripe")(key)`, which mock.module
// can't make callable; seed the CJS cache instead so no request leaves the test.
const stripeEntry = require.resolve("stripe");
require.cache[stripeEntry] = { id: stripeEntry, filename: stripeEntry, loaded: true, exports: () => fakeStripe };

const { fulfillCheckoutSession, switchSubscriptionPlan } = await import("../services/billing/stripe.ts");

function subscription(overrides = {}) {
  return {
    id: "sub_test",
    status: "active",
    created: 1,
    metadata: { org_id: "4242", plan: "pro", billing: "monthly" },
    items: { data: [{ id: "si_test", price: { id: "price_test_pro" } }] },
    ...overrides,
  };
}

function paidSession(sub) {
  return { id: "cs_test", payment_status: "paid", subscription: sub };
}

beforeEach(() => {
  planWrites.length = 0;
  subscriptionUpdates.length = 0;
  scheduleUpdates.length = 0;
  sessionFixture = null;
  orgSubscriptions = [];
});

describe("fulfillCheckoutSession", () => {
  test("applies the plan for the caller's own active subscription", async () => {
    sessionFixture = paidSession(subscription());
    const result = await fulfillCheckoutSession("cs_test", "4242");
    expect(result).toEqual({ fulfilled: true, orgId: "4242", plan: "pro" });
    expect(planWrites).toEqual([{ orgId: "4242", plan: "pro" }]);
  });

  test("refuses a session that belongs to another org", async () => {
    sessionFixture = paidSession(subscription({ metadata: { org_id: "9999", plan: "pro" } }));
    const result = await fulfillCheckoutSession("cs_test", "4242");
    expect(result).toEqual({ fulfilled: false, reason: "org_mismatch" });
    expect(planWrites).toHaveLength(0);
  });

  test("refuses a subscription that is no longer in good standing", async () => {
    sessionFixture = paidSession(subscription({ status: "canceled" }));
    const result = await fulfillCheckoutSession("cs_test", "4242");
    expect(result).toEqual({ fulfilled: false, reason: "not_active" });
    expect(planWrites).toHaveLength(0);
  }, 10000);

  test("derives the plan from the live price, not stale metadata", async () => {
    sessionFixture = paidSession(
      subscription({ items: { data: [{ price: { id: "price_test_standard" } }] } }),
    );
    const result = await fulfillCheckoutSession("cs_test", "4242");
    expect(result.plan).toBe("standard");
    expect(planWrites).toEqual([{ orgId: "4242", plan: "standard" }]);
  });

  test("never turns a pack session into a plan", async () => {
    sessionFixture = paidSession(
      subscription({
        metadata: { org_id: "4242", type: "pack", pack_id: "ai_500", plan: "pro" },
        items: { data: [{ price: { id: "price_test_pack" } }] },
      }),
    );
    const result = await fulfillCheckoutSession("cs_test", "4242");
    expect(result).toEqual({ fulfilled: false, reason: "not_a_plan" });
    expect(planWrites).toHaveLength(0);
  });

  test("an unpaid session is not fulfilled", async () => {
    sessionFixture = { id: "cs_test", payment_status: "unpaid", subscription: subscription() };
    expect(await fulfillCheckoutSession("cs_test", "4242")).toEqual({ fulfilled: false, reason: "not_paid" });
    expect(planWrites).toHaveLength(0);
  });
});

describe("switchSubscriptionPlan upgrade", () => {
  test("upgrades an active subscription immediately", async () => {
    orgSubscriptions = [subscription({ metadata: { org_id: "4242", plan: "standard", billing: "monthly" } })];
    const result = await switchSubscriptionPlan("owner@example.test", "4242", "pro", "monthly");
    expect(result).toEqual({ updated: true, plan: "pro" });
    expect(subscriptionUpdates).toHaveLength(1);
  });

  for (const status of ["past_due", "unpaid"]) {
    test(`refuses to upgrade a ${status} subscription`, async () => {
      orgSubscriptions = [subscription({ status })];
      const err = await switchSubscriptionPlan("owner@example.test", "4242", "pro", "monthly").catch((e) => e);
      expect(err).toBeInstanceOf(Error);
      expect(err.status).toBe(409);
      expect(subscriptionUpdates).toHaveLength(0);
      expect(planWrites).toHaveLength(0);
    });
  }

  test("a past_due subscription can still schedule a downgrade", async () => {
    orgSubscriptions = [
      subscription({
        status: "past_due",
        items: { data: [{ id: "si_test", current_period_end: 2, price: { id: "price_test_pro" } }] },
      }),
    ];
    const result = await switchSubscriptionPlan("owner@example.test", "4242", "standard", "monthly", true);
    expect(result).toEqual({ scheduled: true, plan: "standard" });
    expect(scheduleUpdates).toHaveLength(1);
    expect(subscriptionUpdates).toHaveLength(0);
  });
});
