// Single tenancy (the usual self-host) serves one org at `/`; the hub routing
// added for multi tenancy must not change anything here. Synthetic fixtures.

import { afterAll, describe, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";

mock.module("./services/config/config", () => ({ getAPIUrl: () => "http://api.test/" }));
mock.module("@services/config/config", () => ({ getAPIUrl: () => "http://api.test/" }));

const realFetch = globalThis.fetch;
globalThis.fetch = async () =>
  new Response(
    JSON.stringify({
      tenancy: "single",
      mode: "oss",
      default_org_slug: "default",
      frontend_domain: "school.test",
      top_domain: "school.test",
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
afterAll(() => {
  globalThis.fetch = realFetch;
});

const { default: proxy } = await import("../proxy.ts");

const get = (path, cookies = "") =>
  proxy(
    new NextRequest(`https://school.test${path}`, {
      headers: { host: "school.test", ...(cookies ? { cookie: cookies } : {}) },
    }),
  );
const location = (res) => res.headers.get("location");
const rewrite = (res) => res.headers.get("x-middleware-rewrite");

describe("single tenancy", () => {
  test("/home goes to the org at /", async () => {
    expect(location(await get("/home?x=1"))).toBe("https://school.test/?x=1");
  });

  test("other hub paths stay with the org, as before", async () => {
    for (const p of ["/new", "/billing", "/organizations", "/subscriptions"]) {
      const res = await get(p);
      expect(location(res)).toBeNull();
      expect(new URL(rewrite(res)).pathname).toBe(`/orgs/default${p}`);
    }
  });

  test("/account is the org's account page", async () => {
    const res = await get("/account/general");
    expect(new URL(rewrite(res)).pathname).toBe("/orgs/default/account/general");
  });

  test("a signed-in visitor on /signup stays on the join screen", async () => {
    const res = await get("/signup", "LH_session=1");
    expect(location(res)).toBeNull();
    expect(new URL(rewrite(res)).pathname).toBe("/auth/signup");
  });

  test("a signed-in visitor on /login goes to the org", async () => {
    expect(location(await get("/login", "LH_session=1"))).toBe("https://school.test/");
  });
});
