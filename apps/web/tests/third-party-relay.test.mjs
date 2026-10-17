// The PostHog (/ingest) and Sentry (/monitoring) relays are external rewrites:
// whatever request headers reach them are forwarded to the third party. The
// proxy strips the session cookies and Authorization first.

import { describe, expect, test } from "bun:test";
import { NextResponse } from "next/server";

import { isThirdPartyRelayPath, withoutCredentialHeaders } from "../lib/thirdPartyRelay.ts";

describe("isThirdPartyRelayPath", () => {
  test("matches the relay prefixes", () => {
    for (const p of ["/ingest", "/ingest/e/", "/ingest/static/array.js", "/monitoring", "/monitoring/"]) {
      expect(isThirdPartyRelayPath(p)).toBe(true);
    }
  });

  test("leaves look-alike app paths alone", () => {
    for (const p of ["/ingestion", "/monitoring-dashboard", "/course/ingest", "/"]) {
      expect(isThirdPartyRelayPath(p)).toBe(false);
    }
  });
});

describe("withoutCredentialHeaders", () => {
  const incoming = new Headers({
    cookie: "LH_access=a; LH_refresh=r; ph_test=1",
    authorization: "Bearer token",
    "content-type": "text/plain",
    "user-agent": "test-agent",
  });

  test("drops cookie and authorization, keeps the rest", () => {
    const out = withoutCredentialHeaders(incoming);
    expect(out.has("cookie")).toBe(false);
    expect(out.has("authorization")).toBe(false);
    expect(out.get("content-type")).toBe("text/plain");
    expect(out.get("user-agent")).toBe("test-agent");
    // The original request headers are untouched.
    expect(incoming.has("cookie")).toBe(true);
  });

  test("the proxy response tells Next to drop them before the rewrite", () => {
    const res = NextResponse.next({ request: { headers: withoutCredentialHeaders(incoming) } });
    const kept = res.headers.get("x-middleware-override-headers").split(",");
    expect(kept).not.toContain("cookie");
    expect(kept).not.toContain("authorization");
    expect(kept).toContain("content-type");
  });
});
