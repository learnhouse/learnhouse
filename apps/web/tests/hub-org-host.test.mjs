// The platform hub (/home, /new, /billing, ...) belongs to the apex. A member
// who signed up on a school's own host must land on that school, never on the
// LearnHouse workspace picker. All fixtures are synthetic.

import { afterAll, describe, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";

mock.module("./services/config/config", () => ({ getAPIUrl: () => "http://api.test/" }));
mock.module("@services/config/config", () => ({ getAPIUrl: () => "http://api.test/" }));

// Host → tenant, the way the EE resolver answers for these fixtures.
mock.module("@ee/services/tenancy/resolveMulti.middleware", () => ({
  resolveMultiFromRequest: async (req) => {
    const host = req.headers.get("host");
    if (host === "learn.acme.test") return { slug: "acme", source: "custom-domain", customDomain: host };
    if (host === "acme.platform.test") return { slug: "acme", source: "subdomain" };
    return { slug: "default", source: "default" };
  },
  isCustomDomain: (host) => host === "learn.acme.test",
  extractOrgSubdomain: (host) => (host === "acme.platform.test" ? "acme" : null),
}));

const realFetch = globalThis.fetch;
globalThis.fetch = async () =>
  new Response(
    JSON.stringify({
      tenancy: "multi",
      mode: "saas",
      default_org_slug: "default",
      frontend_domain: "platform.test",
      top_domain: "platform.test",
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
afterAll(() => {
  globalThis.fetch = realFetch;
});

const { default: proxy } = await import("../proxy.ts");

function get(host, path, cookies = "") {
  return proxy(
    new NextRequest(`https://${host}${path}`, {
      headers: { host, ...(cookies ? { cookie: cookies } : {}) },
    }),
  );
}

const location = (res) => res.headers.get("location");
const rewrite = (res) => res.headers.get("x-middleware-rewrite");

describe("hub on an org host", () => {
  test("/home on a school subdomain is the school's home page", async () => {
    const res = await get("acme.platform.test", "/home");
    expect(res.status).toBe(307);
    expect(location(res)).toBe("https://acme.platform.test/");
  });

  test("/home/ with a trailing slash is the school's home page too", async () => {
    expect(location(await get("acme.platform.test", "/home/"))).toBe("https://acme.platform.test/");
  });

  test("/home on a custom domain is the school's home page", async () => {
    const res = await get("learn.acme.test", "/home?welcome=1");
    expect(location(res)).toBe("https://learn.acme.test/?welcome=1");
  });

  test("other hub pages on a school subdomain move to the apex (same session)", async () => {
    expect(location(await get("acme.platform.test", "/new"))).toBe("https://platform.test/new");
    expect(location(await get("acme.platform.test", "/billing?org=acme"))).toBe(
      "https://platform.test/billing?org=acme",
    );
    expect(location(await get("acme.platform.test", "/organizations"))).toBe(
      "https://platform.test/organizations",
    );
  });

  test("on a custom domain they keep rendering there: its cookies don't reach the apex", async () => {
    const res = await get("learn.acme.test", "/billing?org=acme");
    expect(location(res)).toBeNull();
    expect(new URL(rewrite(res)).pathname).toBe("/billing");
  });

  test("/account stays an org-scoped page on a custom domain", async () => {
    const res = await get("learn.acme.test", "/account/general");
    expect(new URL(rewrite(res)).pathname).toBe("/orgs/acme/account/general");
  });

  test("/account stays an org-scoped page on the org host", async () => {
    const res = await get("acme.platform.test", "/account/general");
    expect(location(res)).toBeNull();
    expect(new URL(rewrite(res)).pathname).toBe("/orgs/acme/account/general");
  });
});

describe("hub on the apex", () => {
  test("/home renders the hub", async () => {
    const res = await get("platform.test", "/home");
    expect(location(res)).toBeNull();
    expect(new URL(rewrite(res)).pathname).toBe("/home");
  });

  test("/new renders the hub", async () => {
    const res = await get("platform.test", "/new");
    expect(new URL(rewrite(res)).pathname).toBe("/new");
  });
});

describe("signed-in visitor on /signup", () => {
  const session = "LH_session=1";

  test("on the apex goes to create an organization", async () => {
    const res = await get("platform.test", "/signup", session);
    expect(location(res)).toBe("https://platform.test/new");
  });

  test("on a school host stays on the join screen", async () => {
    const res = await get("acme.platform.test", "/signup", session);
    expect(location(res)).toBeNull();
    expect(new URL(rewrite(res)).pathname).toBe("/auth/signup");
  });

  test("on the apex with an invite code stays on the join screen", async () => {
    const res = await get("platform.test", "/signup?inviteCode=abc", session);
    expect(location(res)).toBeNull();
  });
});
