// Pro and above (and every EE install) must never show LearnHouse marks to an
// org's learners. OSS keeps the mark regardless of the plan value it reports.

import { describe, expect, test } from "bun:test";

const { isWhiteLabelPlan } = await import("../services/plans/plans.ts");

describe("isWhiteLabelPlan", () => {
  test("hides branding for pro and enterprise on SaaS", () => {
    expect(isWhiteLabelPlan("pro", "saas")).toBe(true);
    expect(isWhiteLabelPlan("enterprise", "saas")).toBe(true);
  });

  test("keeps branding below pro on SaaS", () => {
    for (const plan of ["free", "personal", "personal-family", "standard"]) {
      expect(isWhiteLabelPlan(plan, "saas")).toBe(false);
    }
  });

  test("always white-label on EE", () => {
    expect(isWhiteLabelPlan("enterprise", "ee")).toBe(true);
    expect(isWhiteLabelPlan("free", "ee")).toBe(true);
  });

  test("never white-label on OSS", () => {
    expect(isWhiteLabelPlan("oss", "oss")).toBe(false);
  });
});
