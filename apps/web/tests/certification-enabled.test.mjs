import { describe, expect, test } from "bun:test";

import {
  getCourseCertificationStatus,
} from "../lib/certifications/enabled.ts";

describe("getCourseCertificationStatus", () => {
  test("reports enabled when the course has a certification row", () => {
    expect(
      getCourseCertificationStatus({
        success: true,
        status: 200,
        data: [{ certification_uuid: "certification_1", config: {} }],
      })
    ).toBe("enabled");
  });

  test("reports disabled when the course has no certification row", () => {
    expect(
      getCourseCertificationStatus({ success: true, status: 200, data: [] })
    ).toBe("disabled");
  });

  test("reports unknown when the request failed", () => {
    expect(
      getCourseCertificationStatus({
        success: false,
        status: 403,
        data: { detail: "Forbidden" },
      })
    ).toBe("unknown");
  });

  test("reports unknown when a 200 carries something other than a list", () => {
    expect(
      getCourseCertificationStatus({ success: true, status: 200, data: null })
    ).toBe("unknown");
  });

  test("reports unknown when there is no answer yet", () => {
    expect(getCourseCertificationStatus(undefined)).toBe("unknown");
    expect(getCourseCertificationStatus(null)).toBe("unknown");
  });
});
