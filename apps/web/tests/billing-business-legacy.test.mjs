// Behaviour tests for the Business plan and for grandfathered (legacy) prices.
//
// When a plan's price changes, existing subscribers keep paying the old Stripe
// price. Their renewals and portal updates still carry that old price id, so
// it must keep resolving to its plan; it must never be offered at checkout.
//
// All fixtures are synthetic.

import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

// plans.ts reads price ids at module load; map invented ids before importing.
process.env.STRIPE_SECRET_KEY = "sk_test_stub";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
process.env.STRIPE_PRICE_STANDARD_MONTHLY = "price_new_standard_m";
process.env.STRIPE_PRICE_STANDARD_ANNUAL = "price_new_standard_y";
process.env.STRIPE_PRICE_PRO_MONTHLY = "price_new_pro_m";
process.env.STRIPE_PRICE_PRO_ANNUAL = "price_new_pro_y";
process.env.STRIPE_PRICE_BUSINESS_MONTHLY = "price_new_business_m";
process.env.STRIPE_PRICE_BUSINESS_ANNUAL = "price_new_business_y";
process.env.STRIPE_PRICE_LEGACY_STANDARD_MONTHLY = "price_old_standard_m";
process.env.STRIPE_PRICE_LEGACY_STANDARD_ANNUAL = "price_old_standard_y";
process.env.STRIPE_PRICE_LEGACY_PRO_MONTHLY = "price_old_pro_m, price_older_pro_m";
process.env.STRIPE_PRICE_LEGACY_PRO_ANNUAL = "price_old_pro_y";
process.env.STRIPE_PRICE_PACK_AI_500 = "price_test_pack";

const planWrites = [];
const checkoutCreates = [];
const subscriptionUpdates = [];
const scheduleUpdates = [];
let sessionFixture = null;
let orgSubscriptions = [];
let currentEvent = null;

mock.module("next/headers", () => ({
  headers: async () => new Map([["stripe-signature", "sig_test"]]),
}));

mock.module("@services/billing/orgPlan", () => ({
  updateOrganizationConfigInternally: async (orgId, plan) => {
    planWrites.push({ orgId, plan });
    return { ok: true };
  },
}));

mock.module("@services/billing/emails", () => ({
  sendPlanSwitchMail: async () => ({}),
  sendSubscriptionCanceledMail: async () => ({}),
  sendPurchaseCompleteMail: async () => ({}),
  sendPackActivatedMail: async () => ({}),
  sendPaymentFailedMail: async () => ({}),
}));

mock.module("@services/billing/packs", () => ({
  activatePackInternally: async () => ({}),
  deactivatePackInternally: async () => ({}),
  deactivateAllPacksInternally: async () => ({}),
  markPackCancelingInternally: async () => ({}),
}));

mock.module("@services/billing/activeUserBilling", () => ({
  billOverageForInvoice: async () => ({}),
}));

const fakeStripe = {
  webhooks: { constructEvent: () => currentEvent },
  checkout: {
    sessions: {
      create: async (params) => {
        checkoutCreates.push(params);
        return { id: "cs_new", url: "https://checkout.example.test/cs_new" };
      },
      retrieve: async () => sessionFixture,
    },
  },
  customers: {
    list: async () => ({ data: [{ id: "cus_test" }] }),
    create: async () => ({ id: "cus_created" }),
    retrieve: async () => ({ email: "billing@example.test" }),
  },
  promotionCodes: { list: async () => ({ data: [] }) },
  subscriptions: {
    search: async () => ({ data: [], has_more: false, next_page: null }),
    list: async () => ({ data: orgSubscriptions }),
    // The webhook reads the subscription live; serve the event's own object.
    retrieve: async () => orgSubscriptions[0] ?? currentEvent?.data?.object,
    update: async (id, params) => {
      subscriptionUpdates.push({ id, params });
      return { id };
    },
  },
  subscriptionSchedules: {
    create: async () => ({ id: "sub_sched_test" }),
    retrieve: async () => ({ id: "sub_sched_test", phases: [{ start_date: 1 }] }),
    update: async (id, params) => {
      scheduleUpdates.push({ id, params });
      return { id };
    },
  },
};
// stripe.ts loads the SDK with `require("stripe")(key)`, which mock.module
// can't make callable; seed the CJS cache instead so no request leaves the test.
const stripeEntry = require.resolve("stripe");
require.cache[stripeEntry] = { id: stripeEntry, filename: stripeEntry, loaded: true, exports: () => fakeStripe };

const { PRICE_IDS, PRICE_TO_PLAN } = await import("../services/billing/plans.ts");
const { parseLegacyPriceIds } = await import("../services/billing/subscriptionUtils.ts");
const { createCheckoutSession, fulfillCheckoutSession, switchSubscriptionPlan, planForPriceId } =
  await import("../services/billing/stripe.ts");
const { POST } = await import("../app/api/billing/webhook/route.ts");

function subscription(priceId, overrides = {}) {
  return {
    id: "sub_test",
    status: "active",
    // Listed through the caller's own customer, so they are the payer.
    customer: "cus_test",
    created: 1,
    cancel_at_period_end: false,
    metadata: { org_id: "4242", plan: "pro", billing: "monthly" },
    items: { data: [{ id: "si_test", price: { id: priceId }, current_period_end: 2_000_000_000, current_period_start: 1 }] },
    ...overrides,
  };
}

let eventCounter = 0;
async function deliver(type, object) {
  eventCounter += 1;
  currentEvent = { id: `evt_legacy_${eventCounter}`, type, data: { object } };
  return POST(new Request("https://example.test/api/billing/webhook", { method: "POST", body: "{}" }));
}

const ALL_LEGACY = ["price_old_standard_m", "price_old_standard_y", "price_old_pro_m", "price_older_pro_m", "price_old_pro_y"];

beforeEach(() => {
  planWrites.length = 0;
  checkoutCreates.length = 0;
  subscriptionUpdates.length = 0;
  scheduleUpdates.length = 0;
  sessionFixture = null;
  orgSubscriptions = [];
  currentEvent = null;
});

describe("legacy price env parsing", () => {
  test("splits comma lists, trims spaces and ignores blanks", () => {
    expect(parseLegacyPriceIds("a, b ,,c ")).toEqual(["a", "b", "c"]);
    expect(parseLegacyPriceIds("")).toEqual([]);
    expect(parseLegacyPriceIds(undefined)).toEqual([]);
  });
});

describe("price → plan map", () => {
  test("legacy prices resolve to their plan and billing, flagged legacy", () => {
    expect(PRICE_TO_PLAN.get("price_old_pro_m")).toEqual({ plan: "pro", billing: "monthly", isPack: false, legacy: true });
    expect(PRICE_TO_PLAN.get("price_older_pro_m")).toEqual({ plan: "pro", billing: "monthly", isPack: false, legacy: true });
    expect(PRICE_TO_PLAN.get("price_old_standard_y")).toEqual({ plan: "standard", billing: "annual", isPack: false, legacy: true });
  });

  test("current prices, including Business, resolve without the legacy flag", () => {
    expect(PRICE_TO_PLAN.get("price_new_business_m")).toEqual({ plan: "business", billing: "monthly", isPack: false });
    expect(PRICE_TO_PLAN.get("price_new_business_y")).toEqual({ plan: "business", billing: "annual", isPack: false });
    expect(PRICE_TO_PLAN.get("price_new_pro_m")).toEqual({ plan: "pro", billing: "monthly", isPack: false });
  });

  test("legacy ids never appear among the prices that can be sold", () => {
    const sellable = Object.values(PRICE_IDS).flatMap((b) => Object.values(b));
    for (const id of ALL_LEGACY) expect(sellable).not.toContain(id);
  });
});

describe("checkout", () => {
  test("Business checkout charges the Business price", async () => {
    await createCheckoutSession("business", "annual", "owner@example.test", "4242", "acme");
    expect(checkoutCreates).toHaveLength(1);
    expect(checkoutCreates[0].line_items).toEqual([{ price: "price_new_business_y", quantity: 1 }]);
    expect(checkoutCreates[0].subscription_data.metadata).toMatchObject({ org_id: "4242", plan: "business", billing: "annual" });
  });

  test("Standard and Pro checkout use the new prices, never a legacy one", async () => {
    await createCheckoutSession("standard", "monthly", "owner@example.test", "4242");
    await createCheckoutSession("pro", "monthly", "owner@example.test", "4242");
    await createCheckoutSession("pro", "annual", "owner@example.test", "4242");
    const charged = checkoutCreates.map((c) => c.line_items[0].price);
    expect(charged).toEqual(["price_new_standard_m", "price_new_pro_m", "price_new_pro_y"]);
    for (const id of ALL_LEGACY) expect(charged).not.toContain(id);
  });
});

describe("fulfilment", () => {
  test("a Business checkout grants the Business plan", async () => {
    sessionFixture = {
      id: "cs_test",
      payment_status: "paid",
      subscription: subscription("price_new_business_m", { metadata: { org_id: "4242", plan: "business", billing: "monthly" } }),
    };
    const result = await fulfillCheckoutSession("cs_test", "4242");
    expect(result).toEqual({ fulfilled: true, orgId: "4242", plan: "business" });
    expect(planWrites).toEqual([{ orgId: "4242", plan: "business" }]);
  });

  test("a subscription on a legacy price still resolves to its plan", async () => {
    sessionFixture = { id: "cs_test", payment_status: "paid", subscription: subscription("price_old_pro_y", { metadata: { org_id: "4242" } }) };
    const result = await fulfillCheckoutSession("cs_test", "4242");
    expect(result.plan).toBe("pro");
    expect(planWrites).toEqual([{ orgId: "4242", plan: "pro" }]);
  });

  test("planForPriceId knows legacy ids", async () => {
    expect((await planForPriceId("price_old_standard_m"))?.plan).toBe("standard");
  });
});

describe("webhook on a grandfathered subscription", () => {
  test("a renewal update keeps the org on its plan instead of failing to resolve", async () => {
    const res = await deliver("customer.subscription.updated", subscription("price_old_standard_m", { metadata: { org_id: "4242" } }));
    expect(res.status).toBe(200);
    expect(planWrites).toEqual([{ orgId: "4242", plan: "standard" }]);
  });

  test("a legacy price beats stale metadata", async () => {
    const res = await deliver(
      "customer.subscription.updated",
      subscription("price_old_pro_m", { metadata: { org_id: "4242", plan: "standard", billing: "monthly" } }),
    );
    expect(res.status).toBe(200);
    expect(planWrites).toEqual([{ orgId: "4242", plan: "pro" }]);
  });

  test("a Business subscription update sets the Business plan", async () => {
    const res = await deliver("customer.subscription.updated", subscription("price_new_business_y", { metadata: { org_id: "4242" } }));
    expect(res.status).toBe(200);
    expect(planWrites).toEqual([{ orgId: "4242", plan: "business" }]);
  });
});

describe("plan changes from a legacy price", () => {
  test("upgrading Pro (legacy) to Business moves to the Business price", async () => {
    orgSubscriptions = [subscription("price_old_pro_m")];
    await switchSubscriptionPlan("owner@example.test", "4242", "business", "monthly");
    expect(subscriptionUpdates).toHaveLength(1);
    expect(subscriptionUpdates[0].params.items).toEqual([{ id: "si_test", price: "price_new_business_m" }]);
    expect(planWrites).toEqual([{ orgId: "4242", plan: "business" }]);
  });

  test("a scheduled downgrade keeps the legacy price until the period ends", async () => {
    orgSubscriptions = [subscription("price_old_pro_m")];
    await switchSubscriptionPlan("owner@example.test", "4242", "standard", "monthly", true);
    expect(scheduleUpdates).toHaveLength(1);
    const phases = scheduleUpdates[0].params.phases;
    expect(phases[0].items).toEqual([{ price: "price_old_pro_m", quantity: 1 }]);
    expect(phases[1].items).toEqual([{ price: "price_new_standard_m", quantity: 1 }]);
  });

  test("a downgrade from Business to Pro is allowed; Pro (legacy) to Business as a 'downgrade' is refused", async () => {
    orgSubscriptions = [subscription("price_new_business_m")];
    await switchSubscriptionPlan("owner@example.test", "4242", "pro", "monthly", true);
    expect(scheduleUpdates).toHaveLength(1);

    orgSubscriptions = [subscription("price_old_pro_m")];
    await expect(
      switchSubscriptionPlan("owner@example.test", "4242", "business", "monthly", true),
    ).rejects.toThrow("upgrade, not a downgrade");
  });
});
