// Org scripts must not run where the session cookie is shared across orgs.

import { describe, expect, test } from "bun:test";

import { orgScriptsAllowedOn } from "../components/OrgScripts/orgScriptsAllowed";

const platform = ["learnhouse.io", "learnhouse.io"];

describe("orgScriptsAllowedOn", () => {
  test("single-org installs keep their scripts", () => {
    expect(orgScriptsAllowedOn("learn.acme.com", "single", platform)).toBe(true);
    expect(orgScriptsAllowedOn("localhost", "single", ["localhost"])).toBe(true);
  });

  test("shared org subdomains and the platform host are refused", () => {
    expect(orgScriptsAllowedOn("acme.learnhouse.io", "multi", platform)).toBe(false);
    expect(orgScriptsAllowedOn("learnhouse.io", "multi", platform)).toBe(false);
    expect(orgScriptsAllowedOn("ACME.LearnHouse.io", "multi", platform)).toBe(false);
  });

  test("an org's own custom domain keeps its scripts", () => {
    expect(orgScriptsAllowedOn("academy.acme.com", "multi", platform)).toBe(true);
  });

  test("an unknown tenancy is treated as shared", () => {
    expect(orgScriptsAllowedOn("acme.learnhouse.io", undefined, platform)).toBe(false);
    expect(orgScriptsAllowedOn("localhost", undefined, ["localhost"])).toBe(false);
  });
});
