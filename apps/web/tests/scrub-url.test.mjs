import { describe, expect, test } from "bun:test";

import { scrubUrl } from "../services/utils/ts/scrubUrl.ts";

// LTI hand-off codes and picker contexts are short-lived bearer tokens: they
// must never reach analytics or error reports.
describe("scrubUrl", () => {
  test("redacts LTI hand-off codes and picker contexts", () => {
    const out = scrubUrl("https://acme.learnhouse.app/lti/select?ctx=abc123&mode=bind");
    expect(out).not.toContain("abc123");
    expect(out).toContain("mode=bind");
    expect(scrubUrl("https://acme.learnhouse.app/lti/launch?code=secret")).not.toContain("secret");
  });
});
