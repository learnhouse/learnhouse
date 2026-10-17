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

  test("labels go through the translator when one is given", () => {
    const en = JSON.parse(require("fs").readFileSync(new URL("../locales/en.json", import.meta.url), "utf8"));
    const ar = JSON.parse(require("fs").readFileSync(new URL("../locales/ar.json", import.meta.url), "utf8"));
    const translator = (dict) => (key, { defaultValue }) =>
      key.split(".").reduce((node, part) => node?.[part], dict) ?? defaultValue;

    expect(billingIntervalLabel("year", translator(en))).toBe("per year");
    expect(billingIntervalSuffix("month", translator(en))).toBe("/ month");
    expect(billingIntervalLabel("year", translator(ar))).toBe("في السنة");
    expect(billingIntervalSuffix("year", translator(ar))).toBe("/ سنة");
    // Locales that lag behind fall back to English.
    expect(billingIntervalLabel("month", translator({}))).toBe("per month");
  });
});
