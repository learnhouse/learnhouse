// The sidebar, the Features settings page and the home card all sort optional
// features into on / off / locked with this one rule.

import { describe, expect, test } from "bun:test";

import { getOptionalFeatureState } from "../services/features/optionalFeatures.ts";

describe("getOptionalFeatureState", () => {
  test("an enabled feature is on", () => {
    expect(getOptionalFeatureState({ enabled: true, available: true }).status).toBe("on");
  });

  test("a feature outside the plan is locked behind the plan that includes it", () => {
    const state = getOptionalFeatureState({
      enabled: false,
      available: false,
      required_plan: "personal",
      upgrade_plan: "pro",
    });
    expect(state.status).toBe("locked");
    expect(state.upgradePlan).toBe("pro");
  });

  test("falls back to the nominal tier when the API sends no upgrade plan", () => {
    const state = getOptionalFeatureState({ enabled: false, available: false, required_plan: "pro" });
    expect(state.upgradePlan).toBe("pro");
  });

  test("an available feature that is not enabled is off, with who turned it off", () => {
    const state = getOptionalFeatureState({ enabled: false, available: true, disabled_by: "org" });
    expect(state.status).toBe("off");
    expect(state.disabledBy).toBe("org");
  });

  test("a feature the API never resolved reads as off, not locked", () => {
    expect(getOptionalFeatureState(undefined).status).toBe("off");
  });
});
