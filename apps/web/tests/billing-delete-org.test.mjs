// Behaviour tests for deleting an organization through the billing route.
// Deleting a paying org used to leave its Stripe subscription running, so the
// customer kept being charged for an org that no longer existed. The route
// must cancel what is still billing, but only once the delete has gone through.
//
// All fixtures are synthetic.

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

let cookieToken = "tok_cookie";
mock.module("next/headers", () => ({
  cookies: async () => ({
    get: (name) => (name === "LH_access" && cookieToken ? { value: cookieToken } : undefined),
  }),
}));

let billingAvailable = true;
mock.module("@services/billing/guard", () => {
  class BillingUnavailableError extends Error {}
  return {
    BillingUnavailableError,
    assertSaaSBilling: async () => {
      if (!billingAvailable) throw new BillingUnavailableError();
    },
  };
});

process.env.NEXT_PUBLIC_LEARNHOUSE_API_URL = "http://api.test/api/v1/";

let orgSubscriptions = [];
let lookupError = null;
const lookups = [];
const cancelled = [];
let cancelFailures = [];
mock.module("@services/billing/stripe", () => ({
  listChargeableOrgSubscriptions: async (orgId, email) => {
    lookups.push({ orgId, email });
    if (lookupError) throw lookupError;
    return orgSubscriptions;
  },
  cancelSubscriptionsNow: async (subs) => {
    cancelled.push(...subs.map((s) => s.id));
    return {
      canceled: subs.map((s) => s.id).filter((id) => !cancelFailures.includes(id)),
      failed: cancelFailures.map((id) => ({ id, error: "test failure" })),
    };
  },
}));

const { POST } = await import("../app/api/billing/delete-org/route.ts");

// --- backend double ---------------------------------------------------------

const ADMIN_SESSION = {
  user: { id: 7, email: "admin@example.test", is_superadmin: false },
  roles: [{ org: { id: 4242 }, role: { rights: { organizations: { action_delete: true } } } }],
};

let sessionFor = {};
let deleteResponse = { status: 200, body: { detail: "Organization deleted" } };
const backendCalls = [];
const realFetch = globalThis.fetch;

beforeEach(() => {
  cookieToken = "tok_cookie";
  billingAvailable = true;
  orgSubscriptions = [{ id: "sub_plan" }, { id: "sub_pack" }];
  lookupError = null;
  lookups.length = 0;
  cancelled.length = 0;
  cancelFailures = [];
  sessionFor = { tok_cookie: ADMIN_SESSION, tok_header: ADMIN_SESSION };
  deleteResponse = { status: 200, body: { detail: "Organization deleted" } };
  backendCalls.length = 0;
  globalThis.fetch = async (url, init = {}) => {
    const auth = init.headers?.Authorization ?? "";
    const token = auth.replace("Bearer ", "");
    backendCalls.push({ url: String(url), method: init.method ?? "GET", token });
    if (String(url).endsWith("users/session")) {
      const session = sessionFor[token];
      return new Response(JSON.stringify(session ?? {}), { status: session ? 200 : 401 });
    }
    if (String(url).endsWith("orgs/4242") && init.method === "DELETE") {
      return new Response(JSON.stringify(deleteResponse.body), { status: deleteResponse.status });
    }
    return new Response("{}", { status: 404 });
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function request(body, headers = {}) {
  return new Request("http://app.test/api/billing/delete-org", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const deletes = () => backendCalls.filter((c) => c.method === "DELETE");

// --- tests ------------------------------------------------------------------

describe("POST /api/billing/delete-org", () => {
  test("deletes the org, then cancels every subscription still billing for it", async () => {
    const res = await POST(request({ orgId: 4242 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true, canceledSubscriptions: 2 });
    expect(deletes()).toEqual([{ url: "http://api.test/api/v1/orgs/4242", method: "DELETE", token: "tok_cookie" }]);
    expect(lookups).toEqual([{ orgId: "4242", email: "admin@example.test" }]);
    expect(cancelled).toEqual(["sub_plan", "sub_pack"]);
  });

  test("cancels nothing when the backend refuses the delete, and passes its error on", async () => {
    deleteResponse = { status: 403, body: { detail: "Only the owner can delete this organization" } };
    const res = await POST(request({ orgId: 4242 }));
    expect(res.status).toBe(403);
    expect((await res.json()).detail).toBe("Only the owner can delete this organization");
    expect(cancelled).toHaveLength(0);
  });

  test("deletes nothing when the subscription lookup fails", async () => {
    lookupError = new Error("stripe unavailable");
    const res = await POST(request({ orgId: 4242 }));
    expect(res.status).toBe(502);
    expect(deletes()).toHaveLength(0);
    expect(cancelled).toHaveLength(0);
  });

  test("still reports the delete when a cancellation fails", async () => {
    cancelFailures = ["sub_pack"];
    const errors = [];
    const realError = console.error;
    console.error = (...args) => errors.push(args);
    try {
      const res = await POST(request({ orgId: 4242 }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ deleted: true, canceledSubscriptions: 1 });
    } finally {
      console.error = realError;
    }
    expect(JSON.stringify(errors)).toContain("sub_pack");
  });

  test("refuses a caller who can't manage the org, before touching anything", async () => {
    sessionFor.tok_cookie = { user: { id: 8, email: "member@example.test" }, roles: [{ org: { id: 4242 }, role: { rights: {} } }] };
    const res = await POST(request({ orgId: 4242 }));
    expect(res.status).toBe(403);
    expect(lookups).toHaveLength(0);
    expect(deletes()).toHaveLength(0);
  });

  test("accepts a bearer token when there is no session cookie (custom domains)", async () => {
    cookieToken = null;
    const res = await POST(request({ orgId: 4242 }, { Authorization: "Bearer tok_header" }));
    expect(res.status).toBe(200);
    expect(deletes()[0].token).toBe("tok_header");
  });

  test("refuses an impersonation token sent as the bearer fallback", async () => {
    cookieToken = null;
    sessionFor.tok_imp = { ...ADMIN_SESSION, impersonation: { target_user_id: 7 } };
    const res = await POST(request({ orgId: 4242 }, { Authorization: "Bearer tok_imp" }));
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("IMPERSONATION_DENIED");
    expect(lookups).toHaveLength(0);
    expect(deletes()).toHaveLength(0);
  });

  test("rejects a missing or non-numeric org id", async () => {
    expect((await POST(request({}))).status).toBe(400);
    expect((await POST(request({ orgId: "4242 OR 1" }))).status).toBe(400);
    expect((await POST(request("not json"))).status).toBe(400);
    expect(deletes()).toHaveLength(0);
  });

  test("doesn't exist where SaaS billing is off, so the client deletes through the backend", async () => {
    billingAvailable = false;
    const res = await POST(request({ orgId: 4242 }));
    expect(res.status).toBe(404);
    expect(deletes()).toHaveLength(0);
  });
});
