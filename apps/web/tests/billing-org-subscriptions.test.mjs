// Behaviour tests for finding and cancelling an organization's subscriptions
// when the organization is deleted. A deleted org must stop being charged even
// when the person deleting it is not the one paying for it.
//
// All fixtures are synthetic.

import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

process.env.STRIPE_SECRET_KEY = "sk_test_stub";

mock.module("@services/billing/orgPlan", () => ({
  updateOrganizationConfigInternally: async () => ({ ok: true }),
}));

mock.module("@services/billing/emails", () => ({
  sendPlanSwitchMail: async () => ({}),
  sendSubscriptionCanceledMail: async () => ({}),
}));

let searchPages = [];
const searchCalls = [];
let customerSubs = {};
let customersByEmail = {};
const cancelCalls = [];
let cancelFailures = new Set();

const fakeStripe = {
  customers: {
    list: async ({ email }) => ({ data: (customersByEmail[email] ?? []).map((id) => ({ id })) }),
  },
  subscriptions: {
    search: async (params) => {
      searchCalls.push(params);
      return searchPages.shift() ?? { data: [], has_more: false, next_page: null };
    },
    list: async ({ customer }) => ({ data: customerSubs[customer] ?? [] }),
    cancel: async (id, params) => {
      if (cancelFailures.has(id)) throw new Error("card_declined_test");
      cancelCalls.push({ id, params });
      return { id, status: "canceled" };
    },
  },
};
const stripeEntry = require.resolve("stripe");
require.cache[stripeEntry] = { id: stripeEntry, filename: stripeEntry, loaded: true, exports: () => fakeStripe };

const { listChargeableOrgSubscriptions, cancelSubscriptionsNow } = await import("../services/billing/stripe.ts");

function sub(id, overrides = {}) {
  return { id, status: "active", metadata: { org_id: "4242", plan: "pro" }, ...overrides };
}

beforeEach(() => {
  searchPages = [];
  searchCalls.length = 0;
  customerSubs = {};
  customersByEmail = {};
  cancelCalls.length = 0;
  cancelFailures = new Set();
});

describe("listChargeableOrgSubscriptions", () => {
  test("finds the org's plan and pack subscriptions by org id, whoever pays", async () => {
    searchPages = [
      {
        data: [
          sub("sub_plan"),
          sub("sub_pack", { metadata: { org_id: "4242", type: "pack", pack_id: "ai_500" } }),
        ],
        has_more: false,
      },
    ];
    const subs = await listChargeableOrgSubscriptions("4242");
    expect(subs.map((s) => s.id).sort()).toEqual(["sub_pack", "sub_plan"]);
    expect(searchCalls[0].query).toBe("metadata['org_id']:'4242'");
  });

  test("skips subscriptions that can no longer charge and ones for other orgs", async () => {
    searchPages = [
      {
        data: [
          sub("sub_live"),
          sub("sub_past_due", { status: "past_due" }),
          sub("sub_done", { status: "canceled" }),
          sub("sub_expired", { status: "incomplete_expired" }),
          sub("sub_other_org", { metadata: { org_id: "42420" } }),
        ],
        has_more: false,
      },
    ];
    const subs = await listChargeableOrgSubscriptions("4242");
    expect(subs.map((s) => s.id).sort()).toEqual(["sub_live", "sub_past_due"]);
  });

  test("follows search pagination", async () => {
    searchPages = [
      { data: [sub("sub_a")], has_more: true, next_page: "page_2" },
      { data: [sub("sub_b")], has_more: false, next_page: null },
    ];
    const subs = await listChargeableOrgSubscriptions("4242");
    expect(subs.map((s) => s.id).sort()).toEqual(["sub_a", "sub_b"]);
    expect(searchCalls[1].page).toBe("page_2");
  });

  test("also scans the caller's customers, so a subscription too new for search is caught", async () => {
    customersByEmail = { "admin@example.test": ["cus_a"] };
    customerSubs = { cus_a: [sub("sub_fresh"), sub("sub_elsewhere", { metadata: { org_id: "7" } })] };
    const subs = await listChargeableOrgSubscriptions("4242", "admin@example.test");
    expect(subs.map((s) => s.id)).toEqual(["sub_fresh"]);
  });

  test("returns each subscription once when both lookups find it", async () => {
    searchPages = [{ data: [sub("sub_plan")], has_more: false }];
    customersByEmail = { "admin@example.test": ["cus_a"] };
    customerSubs = { cus_a: [sub("sub_plan")] };
    const subs = await listChargeableOrgSubscriptions("4242", "admin@example.test");
    expect(subs.map((s) => s.id)).toEqual(["sub_plan"]);
  });

  test("refuses an org id that isn't a plain integer", async () => {
    await expect(listChargeableOrgSubscriptions("1' OR status:'active")).rejects.toThrow("Invalid org id");
    expect(searchCalls).toHaveLength(0);
  });
});

describe("cancelSubscriptionsNow", () => {
  test("cancels immediately without proration or a final invoice", async () => {
    const result = await cancelSubscriptionsNow([sub("sub_a"), sub("sub_b")]);
    expect(result).toEqual({ canceled: ["sub_a", "sub_b"], failed: [] });
    expect(cancelCalls).toEqual([
      { id: "sub_a", params: { prorate: false, invoice_now: false } },
      { id: "sub_b", params: { prorate: false, invoice_now: false } },
    ]);
  });

  test("keeps going past a failure and reports it", async () => {
    cancelFailures = new Set(["sub_a"]);
    const result = await cancelSubscriptionsNow([sub("sub_a"), sub("sub_b")]);
    expect(result.canceled).toEqual(["sub_b"]);
    expect(result.failed).toEqual([{ id: "sub_a", error: "card_declined_test" }]);
  });
});
