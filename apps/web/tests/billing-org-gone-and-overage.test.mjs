// Two contracts with the backend that billing leans on:
//
// - The plan write tells "this org no longer exists" apart from every other
//   failure, so the webhook can ack events for deleted orgs instead of making
//   Stripe retry them for days. A bare 404 (a wrong API URL) is not that.
// - Active-user overage is billed once per org and month. One Stripe customer
//   can pay for several orgs, so an item billed for one org must not count as
//   billed for another.
//
// All fixtures are synthetic.

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));
mock.module("@services/billing/emails", () => ({
  sendPlanSwitchMail: async () => ({}),
  sendSubscriptionCanceledMail: async () => ({}),
}));

process.env.NEXT_PUBLIC_LEARNHOUSE_API_URL = "http://api.test/api/v1/";
process.env.STRIPE_SECRET_KEY = "sk_test_stub";
process.env.LEARNHOUSE_PLATFORM_API_KEY = "platform_test_key";

let invoiceItems = [];
const created = [];
const fakeStripe = {
  subscriptions: {
    retrieve: async () => ({
      id: "sub_test",
      metadata: { org_id: "2" },
      items: { data: [{ price: { recurring: { interval: "month", interval_count: 1 } } }] },
    }),
  },
  invoiceItems: {
    list: () => ({ autoPagingToArray: async () => invoiceItems }),
    create: async (params, opts) => {
      created.push({ params, opts });
      return { id: "ii_test" };
    },
  },
};
const stripeEntry = require.resolve("stripe");
require.cache[stripeEntry] = { id: stripeEntry, filename: stripeEntry, loaded: true, exports: () => fakeStripe };

const { updateOrganizationConfigInternally, OrgNotFoundError } = await import("../services/billing/orgPlan.ts");
const { billOverageForInvoice } = await import("../services/billing/activeUserBilling.ts");

let respond;
const realFetch = globalThis.fetch;
const realKey = process.env.CLOUD_INTERNAL_KEY;

beforeEach(() => {
  process.env.CLOUD_INTERNAL_KEY = "internal_test_key";
  invoiceItems = [];
  created.length = 0;
  respond = () => Response.json({ ok: true });
  globalThis.fetch = async (url, init) => respond(String(url), init);
});

afterEach(() => {
  globalThis.fetch = realFetch;
  if (realKey === undefined) delete process.env.CLOUD_INTERNAL_KEY;
  else process.env.CLOUD_INTERNAL_KEY = realKey;
});

describe("plan write for an org that no longer exists", () => {
  for (const detail of ["Organization not found", "Organization config not found"]) {
    test(`the API's "${detail}" becomes OrgNotFoundError`, async () => {
      respond = () => Response.json({ detail }, { status: 404 });
      const err = await updateOrganizationConfigInternally(4242, "free").catch((e) => e);
      expect(err).toBeInstanceOf(OrgNotFoundError);
      expect(err.code).toBe("org_not_found");
    });
  }

  test("a 404 that isn't the API's own answer stays a plain failure", async () => {
    respond = () => new Response("<html>Not Found</html>", { status: 404, statusText: "Not Found" });
    const err = await updateOrganizationConfigInternally(4242, "free").catch((e) => e);
    expect(err).not.toBeInstanceOf(OrgNotFoundError);
    expect(err.message).toContain("404");
  });

  test("a 404 with some other detail stays a plain failure", async () => {
    respond = () => Response.json({ detail: "Not Found" }, { status: 404 });
    const err = await updateOrganizationConfigInternally(4242, "free").catch((e) => e);
    expect(err).not.toBeInstanceOf(OrgNotFoundError);
  });
});

describe("active-user overage on a customer that pays for several orgs", () => {
  // Renewal on 2026-08-01 for org 2; July had overage.
  const invoice = {
    id: "in_test",
    billing_reason: "subscription_cycle",
    subscription: "sub_test",
    customer: "cus_shared",
    currency: "usd",
    created: Date.UTC(2026, 7, 1) / 1000,
  };

  beforeEach(() => {
    respond = (url) => {
      const m = url.match(/year=(\d+)&month=(\d+)/);
      const july = m && m[1] === "2026" && m[2] === "7";
      return Response.json({
        org_id: 2,
        plan: "pro",
        year: Number(m?.[1]),
        month: Number(m?.[2]),
        active_users: 12,
        plan_limit: 10,
        members_beyond_included: 2,
        overage_units: july ? 2 : 0,
        overage_usd: july ? 2 : 0,
      });
    };
  });

  test("a line billed for another org doesn't stop this org's", async () => {
    invoiceItems = [{ metadata: { type: "au_overage", au_period: "2026-07", org_id: "1" } }];
    await billOverageForInvoice(invoice);
    expect(created).toHaveLength(1);
    expect(created[0].params.metadata).toMatchObject({ org_id: "2", au_period: "2026-07" });
  });

  test("this org's own line is still not billed twice", async () => {
    invoiceItems = [{ metadata: { type: "au_overage", au_period: "2026-07", org_id: "2" } }];
    await billOverageForInvoice(invoice);
    expect(created).toHaveLength(0);
  });
});
