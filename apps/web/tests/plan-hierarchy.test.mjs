// Business sits between Pro and Enterprise. SSO, LTI, SCORM and audit logs
// unlock on Business, and stay locked on the community edition.

import { describe, expect, mock, test } from "bun:test";

mock.module("@services/config/config", () => ({
  getDeploymentMode: () => "saas",
}));

const { PLAN_HIERARCHY, planMeetsRequirement } = await import("../services/plans/plans.ts");
const { FEATURE_METADATA } = await import("../services/features/featureMetadata.ts");

describe("plan hierarchy", () => {
  test("business is ranked between pro and enterprise", () => {
    expect(PLAN_HIERARCHY.slice(-3)).toEqual(["pro", "business", "enterprise"]);
    expect(planMeetsRequirement("business", "pro")).toBe(true);
    expect(planMeetsRequirement("business", "business")).toBe(true);
    expect(planMeetsRequirement("pro", "business")).toBe(false);
    expect(planMeetsRequirement("business", "enterprise")).toBe(false);
    expect(planMeetsRequirement("enterprise", "business")).toBe(true);
  });

  test("the community edition never meets business or enterprise", () => {
    expect(planMeetsRequirement("oss", "pro")).toBe(true);
    expect(planMeetsRequirement("oss", "business")).toBe(false);
    expect(planMeetsRequirement("oss", "enterprise")).toBe(false);
  });

  test("SSO, LTI, SCORM and audit logs upsell Business", () => {
    for (const key of ["sso", "lti", "scorm", "audit_logs"]) {
      expect(FEATURE_METADATA[key].upsellPlan).toBe("business");
    }
  });
});
