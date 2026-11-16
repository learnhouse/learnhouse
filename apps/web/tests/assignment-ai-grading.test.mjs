import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { aiGradingEnabled, aiGradingModeOf } from "../lib/assignments/aiGrading.ts";

describe("aiGradingModeOf", () => {
  test("reads the stored mode and defaults to SUGGEST", () => {
    expect(aiGradingModeOf({ ai_grading_mode: "AUTO" })).toBe("AUTO");
    expect(aiGradingModeOf({ ai_grading_mode: "OFF" })).toBe("OFF");
    expect(aiGradingModeOf({ ai_grading_mode: "SUGGEST" })).toBe("SUGGEST");
    expect(aiGradingModeOf({})).toBe("SUGGEST");
    expect(aiGradingModeOf(null)).toBe("SUGGEST");
    expect(aiGradingModeOf({ ai_grading_mode: "weird" })).toBe("SUGGEST");
  });
});

describe("aiGradingEnabled", () => {
  test("off, formative and missing assignments get no AI grading", () => {
    expect(aiGradingEnabled({ ai_grading_mode: "SUGGEST" })).toBe(true);
    expect(aiGradingEnabled({ ai_grading_mode: "AUTO" })).toBe(true);
    expect(aiGradingEnabled({ ai_grading_mode: "OFF" })).toBe(false);
    expect(aiGradingEnabled({ ai_grading_mode: "AUTO", ungraded: true })).toBe(false);
    expect(aiGradingEnabled(undefined)).toBe(false);
  });
});

describe("AI grading strings", () => {
  const en = JSON.parse(readFileSync(new URL("../locales/en.json", import.meta.url), "utf8"));
  const lookup = (key) => key.split(".").reduce((node, part) => (node == null ? undefined : node[part]), en);
  const files = [
    "../app/orgs/[orgslug]/dash/assignments/[assignmentuuid]/_components/AIGrading.tsx",
    "../app/orgs/[orgslug]/dash/assignments/[assignmentuuid]/subpages/AssignmentGeneralSubPage.tsx",
  ];

  test("every AI grading key used in the UI exists in en.json", () => {
    const keys = new Set();
    for (const file of files) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      for (const match of source.matchAll(/t\('((?:dashboard\.assignments\.(?:ai_grading|general\.ai_grading)|assignments\.ai_graded)[^'`$]*)'/g)) {
        keys.add(match[1]);
      }
    }
    expect(keys.size).toBeGreaterThan(30);
    const missing = [...keys].filter((key) => typeof lookup(key) !== "string");
    expect(missing).toEqual([]);
    for (const level of ["high", "medium", "low"]) {
      expect(typeof lookup(`dashboard.assignments.ai_grading.panel.confidence.${level}`)).toBe("string");
    }
  });
});
