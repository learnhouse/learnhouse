// A plan refusal from the API opens the upgrade modal (handlePlanLimit), not
// an error toast: usage limits, disabled features, and the plan checks that
// answer "X requires a Pro plan or higher".

import { describe, expect, test } from "bun:test";

const { isPlanLimitError } = await import("../services/utils/ts/errorMessage.ts");

describe("isPlanLimitError", () => {
  test("usage limits and disabled features", () => {
    expect(isPlanLimitError("Usage Limit has been reached for Courses")).toBe(true);
    expect(isPlanLimitError("SSO is not enabled for this organization")).toBe(true);
    expect(isPlanLimitError("Live sessions are not enabled for this organization")).toBe(true);
    expect(isPlanLimitError({ code: "ACCOUNT_TOO_NEW" })).toBe(true);
  });

  test("plan refusals that name a plan", () => {
    for (const detail of [
      "User Groups requires a Standard plan or higher. Your organization is currently on the Free plan.",
      "Student audit & analytics requires a Pro plan or higher.",
      "Advanced analytics requires an Enterprise plan or higher.",
      "Newsletter requires the Standard plan.",
      "LTI requires a Business or Enterprise plan.",
      "Versioning requires pro plan or higher. Current plan: free",
      "Extra pages need the Standard plan or higher.",
    ]) {
      expect(isPlanLimitError(detail)).toBe(true);
    }
  });

  test("other refusals stay errors", () => {
    expect(isPlanLimitError("You are not an admin of this organization")).toBe(false);
    expect(isPlanLimitError("Your plan was changed to Pro.")).toBe(false);
    expect(isPlanLimitError("Course not found")).toBe(false);
    expect(isPlanLimitError(undefined)).toBe(false);
    expect(isPlanLimitError([{ msg: "field required" }])).toBe(false);
  });
});
