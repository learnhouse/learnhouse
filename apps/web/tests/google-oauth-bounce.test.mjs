import { describe, expect, test } from "bun:test";

import { oauthBounceCheckUrl, platformOrgSlug } from "../lib/auth/oauthBounce.ts";

const API = "https://api.platform.test/api/v1/";

describe("platformOrgSlug", () => {
  test("returns the label of a direct org subdomain", () => {
    expect(platformOrgSlug("acme.platform.test", "platform.test")).toBe("acme");
    expect(platformOrgSlug("Acme.Platform.Test", "platform.test")).toBe("acme");
    expect(platformOrgSlug("acme.lvh.me:3020", "lvh.me:3020")).toBe("acme");
  });

  test("rejects the apex, deeper hosts, other ports and other domains", () => {
    expect(platformOrgSlug("platform.test", "platform.test")).toBeNull();
    expect(platformOrgSlug("a.b.platform.test", "platform.test")).toBeNull();
    expect(platformOrgSlug("acme.lvh.me:9999", "lvh.me:3020")).toBeNull();
    expect(platformOrgSlug("acme.platform.test.evil.test", "platform.test")).toBeNull();
    expect(platformOrgSlug("-x.platform.test", "platform.test")).toBeNull();
    expect(platformOrgSlug("acme.platform.test", "")).toBeNull();
  });
});

describe("oauthBounceCheckUrl", () => {
  test("a platform subdomain must belong to an existing org", () => {
    expect(oauthBounceCheckUrl(new URL("https://acme.platform.test"), "platform.test", API)).toBe(
      `${API}orgs/slug/acme`,
    );
  });

  test("any other host must be a verified custom domain still pointing at us", () => {
    expect(oauthBounceCheckUrl(new URL("https://learn.example.com"), "platform.test", API)).toBe(
      `${API}orgs/resolve/domain/learn.example.com?for_auth=1`,
    );
    // A deeper platform host is not an org subdomain, so it goes through the
    // custom-domain check (which never lists platform hosts) and fails there.
    expect(oauthBounceCheckUrl(new URL("https://docs.x.platform.test"), "platform.test", API)).toBe(
      `${API}orgs/resolve/domain/docs.x.platform.test?for_auth=1`,
    );
  });
});
