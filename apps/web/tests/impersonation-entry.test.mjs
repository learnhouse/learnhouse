import { describe, expect, test } from "bun:test";

const { autoEntryMode } = await import("../lib/auth/impersonationEntry.ts");

const at = (slug, path = "/", platform = false) => ({ slug, path, platform });
const staff = (extra = {}) => ({
  status: "authenticated",
  data: { user: { is_superadmin: true }, roles: [], impersonation: null, ...extra },
});
const impersonating = (slug) => ({
  status: "authenticated",
  data: { user: { is_superadmin: false }, roles: [{ org: { slug } }], impersonation: { org: { slug } } },
});

describe("impersonation auto entry", () => {
  test("staff opening an org they are not in enter as its owner", () => {
    expect(autoEntryMode(staff(), at("acme", "/courses"))).toBe("enter");
  });

  test("staff who belong to the org are themselves", () => {
    expect(autoEntryMode(staff({ roles: [{ org: { slug: "acme" } }] }), at("acme"))).toBeNull();
  });

  test("opening another org while impersonating switches to it", () => {
    expect(autoEntryMode(impersonating("acme"), at("globex", "/dash"))).toBe("switch");
  });

  test("the impersonated org itself is left alone", () => {
    expect(autoEntryMode(impersonating("acme"), at("acme", "/dash"))).toBeNull();
  });

  test("a preview with no org on the session does not switch", () => {
    const session = { status: "authenticated", data: { user: {}, impersonation: { org: { slug: null } } } };
    expect(autoEntryMode(session, at("globex"))).toBeNull();
  });

  test("never on the console, auth pages or without an org", () => {
    expect(autoEntryMode(impersonating("acme"), at("globex", "/", true))).toBeNull();
    expect(autoEntryMode(impersonating("acme"), at("globex", "/login"))).toBeNull();
    expect(autoEntryMode(staff(), at("acme", "/admin/organizations"))).toBeNull();
    expect(autoEntryMode(staff(), at(null))).toBeNull();
    expect(autoEntryMode(staff(), null)).toBeNull();
  });

  test("signed-out visitors and regular members never trigger it", () => {
    expect(autoEntryMode({ status: "unauthenticated" }, at("acme"))).toBeNull();
    expect(autoEntryMode(null, at("acme"))).toBeNull();
    const member = { status: "authenticated", data: { user: { is_superadmin: false }, roles: [], impersonation: null } };
    expect(autoEntryMode(member, at("acme"))).toBeNull();
  });
});
