// Contract tests for the internal plan write.
//
// These exist because this exact contract was silently reverted once: the web
// side read a single env name and fell back to an empty key, while the API
// validates a different name and fails closed on an empty one. Every plan write
// then 403'd, and nothing in CI noticed. If a future change narrows the env
// names or restores the silent "" fallback, these fail.

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

// `server-only` is a Next build-time alias rather than an installed package, so
// it has to be stubbed before importing any module that declares it.
mock.module("server-only", () => ({}));

const { updateOrganizationConfigInternally } = await import("../services/billing/orgPlan.ts");

const ORG_ID = 4242; // synthetic — never a real org
const BOTH_NAMES = ["CLOUD_INTERNAL_KEY", "LEARNHOUSE_CLOUD_INTERNAL_KEY"];

let calls;
let originalFetch;
let originalEnv;

beforeEach(() => {
  calls = [];
  originalEnv = {};
  for (const name of BOTH_NAMES) originalEnv[name] = process.env[name];
  originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const name of BOTH_NAMES) {
    if (originalEnv[name] === undefined) delete process.env[name];
    else process.env[name] = originalEnv[name];
  }
});

function setKeys({ cloud, prefixed }) {
  if (cloud === undefined) delete process.env.CLOUD_INTERNAL_KEY;
  else process.env.CLOUD_INTERNAL_KEY = cloud;
  if (prefixed === undefined) delete process.env.LEARNHOUSE_CLOUD_INTERNAL_KEY;
  else process.env.LEARNHOUSE_CLOUD_INTERNAL_KEY = prefixed;
}

describe("updateOrganizationConfigInternally — internal key resolution", () => {
  test("sends the key when only CLOUD_INTERNAL_KEY is set", async () => {
    setKeys({ cloud: "key-unprefixed" });
    await updateOrganizationConfigInternally(ORG_ID, "pro");
    expect(calls).toHaveLength(1);
    expect(calls[0].init.headers["X-Internal-Key"]).toBe("key-unprefixed");
  });

  test("sends the key when only LEARNHOUSE_CLOUD_INTERNAL_KEY is set", async () => {
    setKeys({ prefixed: "key-prefixed" });
    await updateOrganizationConfigInternally(ORG_ID, "pro");
    expect(calls).toHaveLength(1);
    expect(calls[0].init.headers["X-Internal-Key"]).toBe("key-prefixed");
  });

  test("prefers the unprefixed name the API itself validates", async () => {
    setKeys({ cloud: "key-unprefixed", prefixed: "key-prefixed" });
    await updateOrganizationConfigInternally(ORG_ID, "pro");
    expect(calls[0].init.headers["X-Internal-Key"]).toBe("key-unprefixed");
  });

  test("throws before calling the API when neither name is set", async () => {
    setKeys({});
    await expect(updateOrganizationConfigInternally(ORG_ID, "pro")).rejects.toThrow(
      /internal key unset/i,
    );
    // The point of failing loud: no request is made, so the failure cannot be
    // mistaken for the API rejecting a wrong key.
    expect(calls).toHaveLength(0);
  });

  test("an empty-string key is treated as unset, never sent", async () => {
    setKeys({ cloud: "", prefixed: "" });
    await expect(updateOrganizationConfigInternally(ORG_ID, "pro")).rejects.toThrow(
      /internal key unset/i,
    );
    expect(calls).toHaveLength(0);
  });

  test("sends the plan to the cloud_internal endpoint and bounds the call", async () => {
    setKeys({ cloud: "key-unprefixed" });
    await updateOrganizationConfigInternally(ORG_ID, "standard");
    const { url, init } = calls[0];
    expect(String(url)).toContain("cloud_internal/update_org_plan");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toEqual({ org_id: ORG_ID, plan: "standard" });
    // Unbounded, this runs inside the Stripe webhook and can hold the delivery
    // open until Stripe times out.
    expect(init.signal).toBeDefined();
  });

  test("a non-2xx response throws rather than reporting success", async () => {
    setKeys({ cloud: "key-unprefixed" });
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ detail: "Invalid internal API key" }), { status: 403 });
    await expect(updateOrganizationConfigInternally(ORG_ID, "pro")).rejects.toThrow(/403/);
  });
});
