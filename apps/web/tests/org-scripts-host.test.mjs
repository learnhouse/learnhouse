// orgScriptsAllowed: org scripts must never run on a host that shares the
// platform session cookie (a multi-tenant org subdomain), only on single-tenant
// installs and org custom domains. All hosts are synthetic.

import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

let requestHeaders = new Headers();
mock.module("next/headers", () => ({
  headers: async () => requestHeaders,
}));

const { orgScriptsAllowed, orgScriptsAllowedOnRequest } = await import("../lib/orgScripts.ts");

describe("orgScriptsAllowed", () => {
  test("single-tenant installs run scripts", () => {
    expect(orgScriptsAllowed(new Headers({ "x-lh-tenancy": "single" }))).toBe(true);
  });

  test("multi-tenant org subdomains never run scripts", () => {
    expect(orgScriptsAllowed(new Headers({ "x-lh-tenancy": "multi", "x-lh-org": "evil" }))).toBe(false);
  });

  test("multi-tenant custom domains run scripts", () => {
    expect(
      orgScriptsAllowed(new Headers({ "x-lh-tenancy": "multi", "x-lh-custom-domain": "learn.school.test" })),
    ).toBe(true);
  });

  test("missing or unknown tenancy fails closed", () => {
    expect(orgScriptsAllowed(new Headers())).toBe(false);
    expect(orgScriptsAllowed(new Headers({ "x-lh-custom-domain": "learn.school.test" }))).toBe(false);
    expect(orgScriptsAllowed(new Headers({ "x-lh-tenancy": "other" }))).toBe(false);
  });

  test("a guessed tenancy never runs scripts", () => {
    expect(
      orgScriptsAllowed(new Headers({ "x-lh-tenancy": "single", "x-lh-instance-fallback": "1" })),
    ).toBe(false);
    expect(
      orgScriptsAllowed(
        new Headers({ "x-lh-tenancy": "multi", "x-lh-custom-domain": "learn.school.test", "x-lh-instance-fallback": "1" }),
      ),
    ).toBe(false);
  });

  test("reads the current request's headers", async () => {
    requestHeaders = new Headers({ "x-lh-tenancy": "multi" });
    expect(await orgScriptsAllowedOnRequest()).toBe(false);
    requestHeaders = new Headers({ "x-lh-tenancy": "single" });
    expect(await orgScriptsAllowedOnRequest()).toBe(true);
  });
});
