// The platform console's AI costs chart draws every day of the window, with
// zeros where nothing was charged (the API only returns days with usage).

import { describe, expect, test } from "bun:test";
import { fillDays } from "../components/Admin/AICosts/aiCostsDays.ts";

const row = (date, credits) => ({ date, requests: 1, credits, value_usd: credits / 100, cost_usd: 0.001, margin_multiple: 3, gross_margin_pct: 66, below_floor: false });

describe("fillDays", () => {
  test("fills the gaps between from and to", () => {
    const out = fillDays("2026-11-01T10:00:00+00:00", "2026-11-05T09:00:00+00:00", [row("2026-11-02", 3), row("2026-11-05", 6)]);
    expect(out.map((d) => d.date)).toEqual(["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"]);
    expect(out.map((d) => d.credits)).toEqual([0, 3, 0, 0, 6]);
    expect(out[0].margin_multiple).toBeNull();
  });

  test("returns the rows as they are without a window", () => {
    const rows = [row("2026-11-02", 3)];
    expect(fillDays(undefined, undefined, rows)).toBe(rows);
  });
});
