// getCustomDomainOrgId: which org (if any) owns the custom domain a request is
// served on. The signup gateway uses it to scope its Turnstile skip to that one
// org. All hosts are synthetic.

import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

let host = null;
mock.module("next/headers", () => ({
  headers: async () => new Headers(host ? { host } : {}),
  cookies: async () => ({ get: () => undefined }),
}));

mock.module("@services/config/config", () => ({
  getServerAPIUrl: () => "http://api.test/api/v1/",
}));

let resolveResponse = null;
const resolveCalls = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  resolveCalls.push(String(url));
  return resolveResponse ? resolveResponse() : new Response("not found", { status: 404 });
};
afterAll(() => {
  globalThis.fetch = realFetch;
});

const { getCustomDomainOrgId, isCustomDomainRequest } = await import("../lib/saas.ts");

beforeEach(() => {
  host = null;
  resolveResponse = null;
  resolveCalls.length = 0;
  process.env.NEXT_PUBLIC_LEARNHOUSE_DOMAIN = "platform.test";
});

describe("getCustomDomainOrgId", () => {
  test("a registered custom domain resolves to its org id", async () => {
    host = "learn.school.test";
    resolveResponse = () => Response.json({ org_id: 42, org_slug: "school", org_uuid: "org_x" });
    expect(await getCustomDomainOrgId()).toBe(42);
    expect(await isCustomDomainRequest()).toBe(true);
    expect(resolveCalls[0]).toBe("http://api.test/api/v1/orgs/resolve/domain/learn.school.test");
  });

  test("an unregistered host is not a custom domain", async () => {
    host = "unknown.test";
    expect(await getCustomDomainOrgId()).toBeNull();
    expect(await isCustomDomainRequest()).toBe(false);
  });

  test("platform apex and subdomains never reach the backend", async () => {
    for (const h of ["platform.test", "org.platform.test", "localhost", "127.0.0.1"]) {
      host = h;
      expect(await getCustomDomainOrgId()).toBeNull();
    }
    expect(resolveCalls).toHaveLength(0);
  });

  test("a 200 without a numeric org id is not trusted", async () => {
    host = "learn.school.test";
    resolveResponse = () => Response.json({ org_id: "42" });
    expect(await getCustomDomainOrgId()).toBeNull();
  });
});
