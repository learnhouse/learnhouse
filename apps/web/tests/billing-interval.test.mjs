import { describe, expect, test } from "bun:test";

import {
  billingIntervalLabel,
  billingIntervalName,
  billingIntervalSuffix,
  normalizeBillingInterval,
} from "../lib/payments/billingInterval.ts";

describe("billing interval helpers", () => {
  test("offers without a stored period are monthly", () => {
    expect(normalizeBillingInterval(undefined)).toBe("month");
    expect(normalizeBillingInterval(null)).toBe("month");
    expect(normalizeBillingInterval("")).toBe("month");
    expect(normalizeBillingInterval("week")).toBe("month");
  });

  test("yearly is recognised", () => {
    expect(normalizeBillingInterval("year")).toBe("year");
    expect(billingIntervalLabel("year")).toBe("per year");
    expect(billingIntervalSuffix("year")).toBe("/ year");
    expect(billingIntervalName("year")).toBe("Yearly");
  });

  test("monthly labels", () => {
    expect(billingIntervalLabel("month")).toBe("per month");
    expect(billingIntervalSuffix(undefined)).toBe("/ month");
    expect(billingIntervalName("month")).toBe("Monthly");
  });
});
