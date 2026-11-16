// The static billing catalog and the trial constants mirror the API, which
// owns them: plan limits in apps/api/src/security/features_utils/plans.py,
// the trial in apps/api/src/services/plans/trial.py. These fail on drift.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ALL_PLANS } from "../app/(hub)/_billing/plans.ts";

const API = join(import.meta.dir, "../../api/src");
const plansPy = readFileSync(join(API, "security/features_utils/plans.py"), "utf8");
const trialPy = readFileSync(join(API, "services/plans/trial.py"), "utf8");

function planBlock(plan) {
  const start = plansPy.indexOf(`    "${plan}": {\n        "features"`);
  expect(start).toBeGreaterThan(-1);
  return plansPy.slice(start, plansPy.indexOf('"cloud"', start));
}

function apiLimits(plan) {
  const m = planBlock(plan).match(/"members": \{"admin_limit": (\d+), "enabled": True, "limit": (\d+)\}/);
  const courses = planBlock(plan).match(/"courses": \{"enabled": True, "limit": (\d+)\}/);
  const ai = plansPy.match(new RegExp(`"${plan}": (-?\\d+),`, "g"));
  const credits = ai ? Number(ai[ai.length - 1].split(": ")[1].replace(",", "")) : undefined;
  return { members: Number(m[2]), admin_seats: Number(m[1]), courses: Number(courses[1]), ai_credits: credits };
}

const num = (label) => Number(label.replace(/[^\d]/g, ""));

describe("billing catalog fallback matches plans.py", () => {
  for (const plan of ALL_PLANS.filter((p) => p.id !== "enterprise")) {
    test(plan.id, () => {
      const limits = apiLimits(plan.id);
      for (const f of plan.features) {
        if (f.limitKey && !/^unlimited/i.test(f.label)) {
          const expected = limits[f.limitKey];
          expect({ plan: plan.id, key: f.limitKey, value: num(f.label) }).toEqual({ plan: plan.id, key: f.limitKey, value: expected });
        }
        if (f.badgeLimitKey === "ai_credits") {
          expect({ plan: plan.id, ai: num(f.badge) }).toEqual({ plan: plan.id, ai: limits.ai_credits });
        }
      }
    });
  }
});

describe("trial constants match the API", () => {
  const trialTs = readFileSync(join(import.meta.dir, "../services/plans/trial.ts"), "utf8");
  test("plan and length", () => {
    expect(trialTs).toContain(`TRIAL_PLAN = '${trialPy.match(/TRIAL_PLAN = "(\w+)"/)[1]}'`);
    expect(trialTs).toContain(`TRIAL_DAYS = ${trialPy.match(/TRIAL_DAYS = (\d+)/)[1]}`);
  });
});

describe("trial helpers", async () => {
  const { trialProgress } = await import("../services/plans/trial.ts");
  const { hasFeature, featureCounts } = await import("../services/orgs/planOverview.ts");
  test("progress through the trial", () => {
    const t = { started_at: "2026-11-01T00:00:00Z", ends_at: "2026-11-15T00:00:00Z" };
    expect(trialProgress(t, Date.parse("2026-11-08T00:00:00Z"))).toBe(50);
    expect(trialProgress(t, Date.parse("2026-12-01T00:00:00Z"))).toBe(100);
    expect(trialProgress(t, Date.parse("2026-10-01T00:00:00Z"))).toBe(0);
    expect(trialProgress({ started_at: "x", ends_at: "y" })).toBe(0);
  });
  test("features unlocked by the trial count as had", () => {
    expect(hasFeature({ state: "trial" })).toBe(true);
    expect(featureCounts([{ state: "trial" }, { state: "locked" }]).have).toBe(1);
  });
});
