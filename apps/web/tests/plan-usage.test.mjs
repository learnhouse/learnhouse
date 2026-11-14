// Settings → Plan & usage: grouping the API's feature matrix by area, the
// counts behind the filter, meter warnings near a limit, POC progress and the
// status shown next to the plan name.

import { describe, expect, test } from "bun:test";
import {
  featureCounts,
  formatMoney,
  groupFeatures,
  hasFeature,
  meterLevel,
  meterPercent,
  planStatus,
  pocProgress,
} from "../services/orgs/planOverview.ts";

const f = (key, area, state) => ({
  key,
  area,
  state,
  enabled: state !== "locked" && state !== "edition",
  disabled_by: null,
  limit: 0,
  upgrade_plan: state === "locked" ? "pro" : null,
  toggle_tab: null,
});

const features = [
  f("courses", "content", "included"),
  f("boards", "content", "poc"),
  f("scorm", "content", "locked"),
  f("communities", "engagement", "included"),
  f("sso", "security", "locked"),
  f("lti", "integrations", "addon"),
  f("crm", "partners", "edition"),
];
const areas = ["content", "engagement", "ai", "integrations", "security"];

describe("groupFeatures", () => {
  test("follows the API's area order, drops empty areas, appends unknown ones", () => {
    const groups = groupFeatures(features, areas);
    expect(groups.map((g) => g.area)).toEqual(["content", "engagement", "integrations", "security", "partners"]);
    expect(groups[0].features.map((x) => x.key)).toEqual(["courses", "boards", "scorm"]);
  });

  test("'have' keeps included, POC and add-on features", () => {
    const groups = groupFeatures(features, areas, "have");
    expect(groups.flatMap((g) => g.features.map((x) => x.key))).toEqual(["courses", "boards", "communities", "lti"]);
    expect(groups.map((g) => g.area)).toEqual(["content", "engagement", "integrations"]);
  });

  test("'missing' keeps locked and edition features only", () => {
    const groups = groupFeatures(features, areas, "missing");
    expect(groups.flatMap((g) => g.features.map((x) => x.key))).toEqual(["scorm", "sso", "crm"]);
  });

  test("no areas given and no features", () => {
    expect(groupFeatures(features).map((g) => g.area)).toEqual(["content", "engagement", "security", "integrations", "partners"]);
    expect(groupFeatures([], areas)).toEqual([]);
  });
});

describe("featureCounts / hasFeature", () => {
  test("counts what the plan has, what it lacks and what the POC adds", () => {
    expect(featureCounts(features)).toEqual({ all: 7, have: 4, missing: 3, poc: 1 });
    expect(featureCounts([])).toEqual({ all: 0, have: 0, missing: 0, poc: 0 });
    expect(hasFeature({ state: "addon" })).toBe(true);
    expect(hasFeature({ state: "edition" })).toBe(false);
  });
});

describe("meters", () => {
  test("near at 80%, full at the limit, unlimited never fills", () => {
    expect(meterLevel(10, 100)).toBe("ok");
    expect(meterLevel(80, 100)).toBe("near");
    expect(meterLevel(99, 100)).toBe("near");
    expect(meterLevel(100, 100)).toBe("full");
    expect(meterLevel(140, 100)).toBe("full");
    expect(meterLevel(5, "unlimited")).toBe("unlimited");
    expect(meterLevel(5, 0)).toBe("unlimited");
    expect(meterLevel(5, null)).toBe("unlimited");
  });
  test("percent is clamped and rounded", () => {
    expect(meterPercent(1, 3)).toBe(33);
    expect(meterPercent(140, 100)).toBe(100);
    expect(meterPercent(-1, 100)).toBe(0);
    expect(meterPercent(5, "unlimited")).toBe(0);
  });
});

describe("pocProgress", () => {
  const start = Date.parse("2026-11-01T00:00:00Z");
  const poc = { started_at: "2026-11-01T00:00:00Z", ends_at: "2026-12-01T00:00:00Z" };
  test("share of the POC elapsed and whole days left", () => {
    expect(pocProgress(poc, start + 9 * 86_400_000)).toEqual({ pct: 30, daysLeft: 21 });
    expect(pocProgress(poc, start - 86_400_000)).toEqual({ pct: 0, daysLeft: 31 });
    expect(pocProgress(poc, start + 40 * 86_400_000)).toEqual({ pct: 100, daysLeft: 0 });
  });
  test("missing or inverted dates", () => {
    expect(pocProgress({ started_at: null, ends_at: null })).toEqual({ pct: 0, daysLeft: 0 });
    expect(pocProgress({ started_at: poc.ends_at, ends_at: poc.started_at })).toEqual({ pct: 0, daysLeft: 0 });
  });
});

describe("planStatus", () => {
  test("platform status wins over Stripe", () => {
    expect(planStatus({ status: "poc" }, { status: "past_due", cancelAtPeriodEnd: false })).toEqual({ key: "poc", tone: "info" });
    expect(planStatus({ status: "trial" })).toEqual({ key: "trial", tone: "info" });
    expect(planStatus({ status: "suspended" })).toEqual({ key: "suspended", tone: "danger" });
    expect(planStatus({ status: "community" })).toEqual({ key: "community", tone: "neutral" });
    expect(planStatus({ status: "licensed" })).toEqual({ key: "licensed", tone: "success" });
  });
  test("Stripe can say a payment is due, the plan cancels, or a Stripe trial", () => {
    expect(planStatus({ status: "active" }, { status: "unpaid", cancelAtPeriodEnd: false }).key).toBe("past_due");
    expect(planStatus({ status: "active" }, { status: "active", cancelAtPeriodEnd: true })).toEqual({ key: "canceling", tone: "warning" });
    expect(planStatus({ status: "active" }, { status: "trialing", cancelAtPeriodEnd: false }).key).toBe("trial");
    expect(planStatus({ status: "active" }, { status: "active", cancelAtPeriodEnd: false })).toEqual({ key: "active", tone: "success" });
    expect(planStatus({ status: "free" }, null)).toEqual({ key: "free", tone: "neutral" });
  });
});

describe("formatMoney", () => {
  test("minor units to a localized price", () => {
    expect(formatMoney(4900, "usd", "en-US")).toBe("$49.00");
    expect(formatMoney(null, "usd")).toBeNull();
    expect(formatMoney(100, "")).toBeNull();
    expect(formatMoney(100, "not-a-currency")).toBeNull();
  });
});
