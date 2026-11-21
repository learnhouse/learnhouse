// An org gets one plan subscription. The checkout route must refuse a new one
// while the org already has a live subscription, whoever pays for it;
// otherwise a second admin could buy a second plan for the same org.
//
// All fixtures are synthetic.

import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

let existing = null;
const lookups = [];
const checkouts = [];
mock.module("@services/billing/stripe", () => ({
  getActiveSubscription: async (email, orgId) => {
    lookups.push({ email, orgId });
    return existing;
  },
  createCheckoutSession: async (...args) => {
    checkouts.push(args);
    return { id: "cs_test", url: "https://checkout.example.test/cs_test" };
  },
}));

mock.module("../app/api/billing/_lib.ts", () => ({
  guardBilling: async () => null,
  badRequest: (message) => Response.json({ error: message }, { status: 400 }),
  requireOrgBillingAccess: async () => ({ user: { email: "second-admin@example.test", token: "tok" } }),
}));

const { POST } = await import("../app/api/billing/checkout/route.ts");

function post(body) {
  return new Request("http://app.test/api/billing/checkout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  existing = null;
  lookups.length = 0;
  checkouts.length = 0;
});

describe("checkout for an org that already has a subscription", () => {
  test("is refused with 409 and starts no checkout", async () => {
    existing = { id: "sub_paid_by_first_admin", status: "active" };
    const res = await POST(post({ plan: "pro", billing: "monthly", orgId: 4242 }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("already has a subscription");
    expect(lookups).toEqual([{ email: "second-admin@example.test", orgId: "4242" }]);
    expect(checkouts).toHaveLength(0);
  });

  test("goes ahead when the org has none", async () => {
    const res = await POST(post({ plan: "pro", billing: "monthly", orgId: 4242 }));
    expect(res.status).toBe(200);
    expect(checkouts).toHaveLength(1);
  });
});
