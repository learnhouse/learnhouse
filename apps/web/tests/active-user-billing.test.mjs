import { describe, expect, test } from "bun:test";

import {
  completeMonthsBefore,
  intervalMonths,
  invoiceSubscriptionId,
  monthStartUnix,
  periodKey,
} from "../services/billing/activeUserBillingUtils.ts";

describe("completeMonthsBefore", () => {
  test("returns the prior months oldest first, never the current one", () => {
    expect(completeMonthsBefore(new Date("2026-08-15T00:00:00Z"), 3)).toEqual([
      { year: 2026, month: 5 },
      { year: 2026, month: 6 },
      { year: 2026, month: 7 },
    ]);
  });

  test("crosses the year boundary", () => {
    expect(completeMonthsBefore(new Date("2026-02-01T00:00:00Z"), 3)).toEqual([
      { year: 2025, month: 11 },
      { year: 2025, month: 12 },
      { year: 2026, month: 1 },
    ]);
  });

  test("an annual lookback covers the full preceding year", () => {
    const periods = completeMonthsBefore(new Date("2027-08-01T00:00:00Z"), 14);
    expect(periods).toHaveLength(14);
    expect(periods[0]).toEqual({ year: 2026, month: 6 });
    expect(periods[13]).toEqual({ year: 2027, month: 7 });
    // Every month of the elapsed subscription year is reconciled.
    for (let month = 8; month <= 12; month++) {
      expect(periods).toContainEqual({ year: 2026, month });
    }
    for (let month = 1; month <= 7; month++) {
      expect(periods).toContainEqual({ year: 2027, month });
    }
  });

  test("uses UTC, not the runner's local timezone", () => {
    // 23:30 UTC on the last day of July is still July everywhere east of UTC.
    expect(completeMonthsBefore(new Date("2026-07-31T23:30:00Z"), 1)).toEqual([
      { year: 2026, month: 6 },
    ]);
  });
});

describe("intervalMonths", () => {
  const sub = (interval, interval_count) => ({
    items: { data: [{ price: { recurring: { interval, interval_count } } }] },
  });

  test("monthly bills one month per invoice", () => {
    expect(intervalMonths(sub("month", 1))).toBe(1);
  });

  test("annual has to reconcile twelve", () => {
    expect(intervalMonths(sub("year", 1))).toBe(12);
  });

  test("multi-interval prices multiply out", () => {
    expect(intervalMonths(sub("month", 3))).toBe(3);
    expect(intervalMonths(sub("year", 2))).toBe(24);
  });

  test("sub-monthly intervals and unknown shapes fall back to one month", () => {
    expect(intervalMonths(sub("week", 1))).toBe(1);
    expect(intervalMonths(sub("day", 1))).toBe(1);
    expect(intervalMonths({})).toBe(1);
    expect(intervalMonths(undefined)).toBe(1);
  });
});

describe("invoiceSubscriptionId", () => {
  test("reads the pre-Basil top-level field", () => {
    expect(invoiceSubscriptionId({ subscription: "sub_123" })).toBe("sub_123");
  });

  test("reads the Basil parent.subscription_details shape", () => {
    expect(
      invoiceSubscriptionId({
        parent: { subscription_details: { subscription: "sub_456" } },
      }),
    ).toBe("sub_456");
  });

  test("unwraps an expanded subscription object", () => {
    expect(invoiceSubscriptionId({ subscription: { id: "sub_789" } })).toBe("sub_789");
  });

  test("returns undefined for a one-off invoice", () => {
    expect(invoiceSubscriptionId({ customer: "cus_1" })).toBeUndefined();
    expect(invoiceSubscriptionId(undefined)).toBeUndefined();
  });
});

describe("periodKey / monthStartUnix", () => {
  test("pads the month so periods sort and match exactly", () => {
    expect(periodKey(2026, 7)).toBe("2026-07");
    expect(periodKey(2026, 12)).toBe("2026-12");
  });

  test("month start is the first UTC second of that month", () => {
    expect(monthStartUnix(2026, 7)).toBe(Date.parse("2026-07-01T00:00:00Z") / 1000);
    expect(monthStartUnix(2026, 1)).toBe(Date.parse("2026-01-01T00:00:00Z") / 1000);
  });
});
