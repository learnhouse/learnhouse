// Behaviour tests for the org-level subscription guards in the billing service.
//
// An org's plan subscription can be paid by any of its admins, so it has to be
// found by org id, not only through the caller's own Stripe customers. Missing
// it let a second admin buy a second subscription; cancelling either one then
// moved the org to Free while the other kept billing. A downgrade scheduled
// earlier must not swallow a later upgrade or block a cancellation, and an
// unpaid subscription must stop granting its plan.
//
// All fixtures are synthetic.

import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

process.env.STRIPE_SECRET_KEY = "sk_test_stub";
process.env.STRIPE_PRICE_PRO_MONTHLY = "price_test_pro";
process.env.STRIPE_PRICE_STANDARD_MONTHLY = "price_test_standard";

const planWrites = [];
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

let searchResults = [];
const searchCalls = [];
let customersByEmail = {};
let customerSubs = {};
let allSubs = [];
const releases = [];
const updates = [];
const calls = [];

const fakeStripe = {
  customers: {
    list: async ({ email }) => ({ data: (customersByEmail[email] ?? []).map((id) => ({ id })) }),
  },
  subscriptions: {
    search: async (params) => {
      searchCalls.push(params);
      return { data: searchResults, has_more: false, next_page: null };
    },
    list: async ({ customer }) =>
      customer ? { data: customerSubs[customer] ?? [] } : { data: allSubs, has_more: false },
    update: async (id, params) => {
      calls.push("update");
      updates.push({ id, params });
      return { id };
    },
  },
  subscriptionSchedules: {
    release: async (id) => {
      calls.push("release");
      releases.push(id);
      return { id };
    },
  },
  promotionCodes: { list: async () => ({ data: [] }) },
};
const stripeEntry = require.resolve("stripe");
require.cache[stripeEntry] = { id: stripeEntry, filename: stripeEntry, loaded: true, exports: () => fakeStripe };

const {
  getActiveSubscription,
  findOrgEntitledPlanSubscription,
  switchSubscriptionPlan,
  cancelSubscription,
  reconcileAllOrgPlans,
} = await import("../services/billing/stripe.ts");
const {
  isPlanEndedStatus,
  isPlanGrantingStatus,
  selectOrgEntitledSubscription,
} = await import("../services/billing/subscriptionUtils.ts");

function sub(id, overrides = {}) {
  return {
    id,
    status: "active",
    created: 1,
    metadata: { org_id: "4242", plan: "pro", billing: "monthly" },
    items: { data: [{ id: `si_${id}`, price: { id: "price_test_pro" } }] },
    ...overrides,
  };
}

beforeEach(() => {
  searchResults = [];
  searchCalls.length = 0;
  customersByEmail = {};
  customerSubs = {};
  allSubs = [];
  releases.length = 0;
  updates.length = 0;
  calls.length = 0;
  planWrites.length = 0;
});

describe("getActiveSubscription", () => {
  test("finds the org's subscription when another admin pays for it", async () => {
    searchResults = [sub("sub_paid_by_other_admin")];
    customersByEmail = { "second-admin@example.test": ["cus_second"] };
    const found = await getActiveSubscription("second-admin@example.test", "4242");
    expect(found?.id).toBe("sub_paid_by_other_admin");
    expect(searchCalls[0].query).toBe("metadata['org_id']:'4242'");
  });

  test("still finds a subscription too new for search on the caller's customers", async () => {
    customersByEmail = { "admin@example.test": ["cus_a"] };
    customerSubs = { cus_a: [sub("sub_fresh")] };
    expect((await getActiveSubscription("admin@example.test", "4242"))?.id).toBe("sub_fresh");
  });

  test("never searches with an org id that isn't a plain integer", async () => {
    customersByEmail = { "admin@example.test": ["cus_a"] };
    customerSubs = { cus_a: [sub("sub_x", { metadata: { org_id: "1' OR 'a" } })] };
    expect(await getActiveSubscription("admin@example.test", "1' OR 'a")).not.toBeNull();
    expect(searchCalls).toHaveLength(0);
  });

  test("returns null when the org has no live plan subscription", async () => {
    searchResults = [sub("sub_done", { status: "canceled" })];
    expect(await getActiveSubscription("admin@example.test", "4242")).toBeNull();
  });
});

describe("findOrgEntitledPlanSubscription", () => {
  test("ignores the subscription that just ended", async () => {
    searchResults = [sub("sub_ended")];
    expect(await findOrgEntitledPlanSubscription("4242", { excludeId: "sub_ended" })).toBeNull();
  });

  test("returns another live subscription of the org", async () => {
    searchResults = [sub("sub_ended", { status: "canceled" }), sub("sub_other")];
    const found = await findOrgEntitledPlanSubscription("4242", { excludeId: "sub_ended" });
    expect(found?.id).toBe("sub_other");
  });

  test("an unpaid subscription doesn't count, a past_due one does", async () => {
    searchResults = [sub("sub_unpaid", { status: "unpaid" })];
    expect(await findOrgEntitledPlanSubscription("4242")).toBeNull();
    searchResults = [sub("sub_grace", { status: "past_due" })];
    expect((await findOrgEntitledPlanSubscription("4242"))?.id).toBe("sub_grace");
  });

  test("scans the payer's customer too, for a subscription search hasn't indexed", async () => {
    customerSubs = { cus_payer: [sub("sub_new"), sub("sub_other_org", { metadata: { org_id: "7" } })] };
    const found = await findOrgEntitledPlanSubscription("4242", { excludeId: "sub_old", customerId: "cus_payer" });
    expect(found?.id).toBe("sub_new");
  });

  test("ignores pack subscriptions", async () => {
    searchResults = [sub("sub_pack", { metadata: { org_id: "4242", type: "pack" } })];
    expect(await findOrgEntitledPlanSubscription("4242")).toBeNull();
  });
});

describe("a downgrade scheduled earlier", () => {
  function scheduled(schedule) {
    return sub("sub_sched", { metadata: { org_id: "4242", plan: "standard", billing: "monthly" }, schedule });
  }

  test("is released before an upgrade, so the upgrade isn't reverted at period end", async () => {
    searchResults = [scheduled("sub_sched_1")];
    await switchSubscriptionPlan("owner@example.test", "4242", "pro", "monthly");
    expect(releases).toEqual(["sub_sched_1"]);
    expect(calls).toEqual(["release", "update"]);
  });

  test("is released before a cancellation, which Stripe refuses on a scheduled subscription", async () => {
    searchResults = [scheduled({ id: "sub_sched_2" })];
    await cancelSubscription("owner@example.test", "4242");
    expect(releases).toEqual(["sub_sched_2"]);
    expect(calls).toEqual(["release", "update"]);
    expect(updates[0].params).toEqual({ cancel_at_period_end: true });
  });

  test("nothing is released when no schedule exists", async () => {
    searchResults = [sub("sub_plain")];
    await cancelSubscription("owner@example.test", "4242");
    expect(releases).toHaveLength(0);
    expect(calls).toEqual(["update"]);
  });
});

describe("reconcileAllOrgPlans", () => {
  test("an unpaid subscription reconciles to free; past_due keeps its plan", async () => {
    allSubs = [
      sub("sub_unpaid", { status: "unpaid", metadata: { org_id: "1", plan: "pro" } }),
      sub("sub_grace", { status: "past_due", metadata: { org_id: "2", plan: "pro" } }),
    ];
    const result = await reconcileAllOrgPlans();
    expect(result.errors).toBe(0);
    expect(planWrites.sort((a, b) => a.orgId.localeCompare(b.orgId))).toEqual([
      { orgId: "1", plan: "free" },
      { orgId: "2", plan: "pro" },
    ]);
  });
});

describe("plan status helpers", () => {
  test("past_due grants (grace), unpaid doesn't", () => {
    expect(isPlanGrantingStatus("active")).toBe(true);
    expect(isPlanGrantingStatus("trialing")).toBe(true);
    expect(isPlanGrantingStatus("past_due")).toBe(true);
    expect(isPlanGrantingStatus("unpaid")).toBe(false);
    expect(isPlanGrantingStatus(undefined)).toBe(false);
  });

  test("ended means canceled, unpaid or paused, never a first payment that expired", () => {
    for (const s of ["canceled", "unpaid", "paused"]) expect(isPlanEndedStatus(s)).toBe(true);
    for (const s of ["active", "past_due", "incomplete", "incomplete_expired"]) expect(isPlanEndedStatus(s)).toBe(false);
    expect(isPlanEndedStatus(undefined)).toBe(false);
  });

  test("selectOrgEntitledSubscription skips unpaid and picks the healthiest", () => {
    const subs = [sub("a", { status: "unpaid" }), sub("b", { status: "past_due" }), sub("c")];
    expect(selectOrgEntitledSubscription(subs, "4242")?.id).toBe("c");
    expect(selectOrgEntitledSubscription([sub("a", { status: "unpaid" })], "4242")).toBeNull();
  });
});
