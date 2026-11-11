// Multi tenancy outside SaaS (self-hosted Enterprise): the (hub) pages such as
// /new don't exist, so a signed-in visitor on the apex /signup goes to /home.

import { afterAll, describe, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";

mock.module("./services/config/config", () => ({ getAPIUrl: () => "http://api.test/" }));
mock.module("@services/config/config", () => ({ getAPIUrl: () => "http://api.test/" }));
mock.module("@ee/services/tenancy/resolveMulti.middleware", () => ({
  resolveMultiFromRequest: async () => ({ slug: "default", source: "default" }),
  isCustomDomain: () => false,
  extractOrgSubdomain: () => null,
}));

const realFetch = globalThis.fetch;
globalThis.fetch = async () =>
  new Response(
    JSON.stringify({
      tenancy: "multi",
      mode: "ee",
      default_org_slug: "default",
      frontend_domain: "corp.test",
      top_domain: "corp.test",
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
afterAll(() => {
  globalThis.fetch = realFetch;
});

const { default: proxy } = await import("../proxy.ts");

describe("enterprise multi tenancy", () => {
  test("signed-in /signup on the apex goes to the org picker", async () => {
    const res = await proxy(
      new NextRequest("https://corp.test/signup", { headers: { host: "corp.test", cookie: "LH_session=1" } }),
    );
    expect(res.headers.get("location")).toBe("https://corp.test/home");
  });
});
