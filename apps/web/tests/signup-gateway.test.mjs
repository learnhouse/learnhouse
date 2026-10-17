// Behaviour tests for the signup gateway (app/api/signup).
//
// Covers the two anti-abuse gaps: the backend's per-IP signup limit only works
// if the caller's IP is relayed, and the custom-domain Turnstile skip must only
// cover signups into the org that owns that domain. All fixtures are synthetic.

import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

let customDomainOrgId = null;
const turnstileCalls = [];

mock.module("@lib/saas", () => ({
  isSaaSMode: async () => true,
  getCustomDomainOrgId: async () => customDomainOrgId,
  isCustomDomainRequest: async () => customDomainOrgId !== null,
}));

mock.module("@lib/turnstile", () => ({
  verifyTurnstile: async (token) => {
    turnstileCalls.push(token);
    return token ? { ok: true } : { ok: false, reason: "missing_token" };
  },
  clientIpFromHeaders: () => undefined,
}));

mock.module("@services/config/config", () => ({
  getServerAPIUrl: () => "http://api.test/api/v1/",
}));

mock.module("@services/emails/disposableEmail", () => ({
  validateSignupEmail: async () => ({ ok: true }),
}));

mock.module("@services/emails/loops", () => ({
  addContactWithLoops: async () => ({}),
  sendLoopsEvent: async () => ({}),
  LOOPS_SIGNED_USERS_GROUP: "test",
}));

const backendCalls = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  backendCalls.push({ url: String(url), init });
  return new Response(JSON.stringify({ id: 1 }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};
afterAll(() => {
  globalThis.fetch = realFetch;
});

const { POST } = await import("../app/api/signup/route.ts");

function signup(body, headers = {}) {
  return POST(
    new Request("https://example.test/api/signup", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({
        email: "new.user@example.test",
        password: "a-long-test-password",
        username: "newuser",
        ...body,
      }),
    }),
  );
}

beforeEach(() => {
  customDomainOrgId = null;
  turnstileCalls.length = 0;
  backendCalls.length = 0;
});

describe("client IP relay", () => {
  test("forwards X-Forwarded-For and X-Real-IP to the backend", async () => {
    const res = await signup(
      { turnstileToken: "tok" },
      { "x-forwarded-for": "203.0.113.7, 10.0.0.2", "x-real-ip": "203.0.113.7" },
    );
    expect(res.status).toBe(200);
    expect(backendCalls).toHaveLength(1);
    const sent = new Headers(backendCalls[0].init.headers);
    expect(sent.get("x-forwarded-for")).toBe("203.0.113.7, 10.0.0.2");
    expect(sent.get("x-real-ip")).toBe("203.0.113.7");
    expect(sent.get("content-type")).toBe("application/json");
  });

  test("sends no IP headers the caller didn't have", async () => {
    await signup({ turnstileToken: "tok" });
    const sent = new Headers(backendCalls[0].init.headers);
    expect(sent.has("x-forwarded-for")).toBe(false);
    expect(sent.has("x-real-ip")).toBe(false);
  });
});

describe("Turnstile on custom domains", () => {
  test("platform host: a missing token is rejected", async () => {
    const res = await signup({ org_id: 7 });
    expect(res.status).toBe(403);
    expect(backendCalls).toHaveLength(0);
  });

  test("custom domain: signing up into the domain's own org skips the challenge", async () => {
    customDomainOrgId = 7;
    const res = await signup({ org_id: 7 });
    expect(res.status).toBe(200);
    expect(turnstileCalls).toHaveLength(0);
    expect(backendCalls[0].url).toBe("http://api.test/api/v1/users/7");
  });

  test("custom domain: an org-less signup still needs the challenge", async () => {
    customDomainOrgId = 7;
    const res = await signup({});
    expect(res.status).toBe(403);
    expect(backendCalls).toHaveLength(0);
  });

  test("custom domain: a signup into a different org still needs the challenge", async () => {
    customDomainOrgId = 7;
    const res = await signup({ org_id: "8" });
    expect(res.status).toBe(403);
    expect(backendCalls).toHaveLength(0);
  });
});
