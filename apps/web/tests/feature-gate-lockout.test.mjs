// Behaviour tests for the feature-gate reason resolver, plus a static guard on
// the one surface that hosts the toggle for the feature it is gated by.
//
// A gate that hides the switch controlling its own feature is a one-way door:
// turning the feature off replaces the page with the disabled card, and the
// switch that would turn it back on never mounts again. On self-hosted there is
// no other way out, so the escape hatch below is load-bearing.

import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

import { resolveGateReason } from "../lib/features/gateReason.ts";

describe("resolveGateReason: admin-disabled features", () => {
  test("blocks with the disabled reason by default", () => {
    const result = resolveGateReason({
      resolved: { enabled: false },
      catalogPlan: "standard",
      currentPlan: "pro",
      orgLoaded: true,
    });

    expect(result.reason).toBe("disabled");
    expect(result.enabled).toBe(false);
    expect(result.meetsPlan).toBe(true);
    expect(result.loading).toBe(false);
  });

  test("lets a host surface through when it opts in", () => {
    const result = resolveGateReason({
      resolved: { enabled: false },
      catalogPlan: "standard",
      currentPlan: "pro",
      orgLoaded: true,
      allowWhenDisabled: true,
    });

    expect(result.reason).toBeUndefined();
    // The hatch suppresses the gate, not the truth: the host still needs to
    // know the feature is off so it can say so above the switch.
    expect(result.enabled).toBe(false);
  });

  test("lets a self-hosted org back in", () => {
    // OSS meets every requirement short of enterprise, so 'disabled' is the
    // only reason that can ever lock these deployments out.
    const result = resolveGateReason({
      resolved: { enabled: false },
      catalogPlan: "standard",
      currentPlan: "oss",
      orgLoaded: true,
      allowWhenDisabled: true,
    });

    expect(result.reason).toBeUndefined();
  });
});

describe("resolveGateReason: the escape hatch is not a paywall bypass", () => {
  test("still demands an upgrade when the plan is too low", () => {
    const result = resolveGateReason({
      resolved: { enabled: true, required_plan: "standard" },
      catalogPlan: "standard",
      currentPlan: "free",
      orgLoaded: true,
      allowWhenDisabled: true,
    });

    expect(result.reason).toBe("plan");
    expect(result.meetsPlan).toBe(false);
    expect(result.requiredPlan).toBe("standard");
  });

  test("prefers the plan reason when the feature is both locked and off", () => {
    const result = resolveGateReason({
      resolved: { enabled: false, required_plan: "pro" },
      catalogPlan: "standard",
      currentPlan: "personal",
      orgLoaded: true,
      allowWhenDisabled: true,
    });

    expect(result.reason).toBe("plan");
  });
});

describe("resolveGateReason: granted features", () => {
  test("returns no reason when the plan is met and the feature is on", () => {
    const result = resolveGateReason({
      resolved: { enabled: true, required_plan: "standard" },
      catalogPlan: "standard",
      currentPlan: "pro",
      orgLoaded: true,
    });

    expect(result.reason).toBeUndefined();
    expect(result.enabled).toBe(true);
    expect(result.meetsPlan).toBe(true);
  });

  test("treats a feature the backend never resolved as enabled", () => {
    const result = resolveGateReason({
      resolved: undefined,
      catalogPlan: "free",
      currentPlan: "free",
      orgLoaded: true,
    });

    expect(result.enabled).toBe(true);
    expect(result.requiredPlan).toBeNull();
    expect(result.reason).toBeUndefined();
  });
});

describe("resolveGateReason: the catalog fallback", () => {
  test("holds off while the org has not loaded", () => {
    // resolved_features arrives with the org. Falling back to the catalog tier
    // before then shows an upgrade card to orgs that are entitled to the
    // feature, and fires the upsell analytics event for a card nobody meant to
    // show.
    const result = resolveGateReason({
      resolved: undefined,
      catalogPlan: "standard",
      currentPlan: "free",
      orgLoaded: false,
    });

    expect(result.loading).toBe(true);
    expect(result.requiredPlan).toBeNull();
    expect(result.reason).toBeUndefined();
  });

  test("gates by the catalog tier once the org has loaded without the feature", () => {
    const result = resolveGateReason({
      resolved: undefined,
      catalogPlan: "standard",
      currentPlan: "free",
      orgLoaded: true,
    });

    expect(result.loading).toBe(false);
    expect(result.requiredPlan).toBe("standard");
    expect(result.reason).toBe("plan");
  });

  test("ignores catalog tiers that gate nothing", () => {
    for (const catalogPlan of ["free", "oss", null, undefined]) {
      const result = resolveGateReason({
        catalogPlan,
        currentPlan: "free",
        orgLoaded: true,
      });

      expect(result.requiredPlan).toBeNull();
      expect(result.meetsPlan).toBe(true);
    }
  });

  test("defers to the backend's required plan over the catalog", () => {
    const result = resolveGateReason({
      resolved: { enabled: true, required_plan: "personal" },
      catalogPlan: "enterprise",
      currentPlan: "personal",
      orgLoaded: true,
    });

    expect(result.requiredPlan).toBe("personal");
    expect(result.reason).toBeUndefined();
  });
});

describe("resolveGateReason: the backend's availability answer", () => {
  test("locks a feature the plan does not include even when the nominal tier is met", () => {
    // Boards sit in Personal but not in Standard. Comparing tiers says a
    // Standard org meets "personal", which used to show the feature as turned
    // off instead of locked behind Pro.
    const result = resolveGateReason({
      resolved: { enabled: false, available: false, required_plan: "personal", upgrade_plan: "pro" },
      catalogPlan: "standard",
      currentPlan: "standard",
      orgLoaded: true,
    });

    expect(result.reason).toBe("plan");
    expect(result.meetsPlan).toBe(false);
    expect(result.requiredPlan).toBe("pro");
    expect(result.disabledBy).toBeUndefined();
  });

  test("reports who turned an available feature off", () => {
    const result = resolveGateReason({
      resolved: { enabled: false, available: true, required_plan: "standard", disabled_by: "org" },
      catalogPlan: "standard",
      currentPlan: "standard",
      orgLoaded: true,
    });

    expect(result.reason).toBe("disabled");
    expect(result.meetsPlan).toBe(true);
    expect(result.disabledBy).toBe("org");
  });

  test("an available feature is granted whatever the tier comparison says", () => {
    // Comp-granted through an override: available on a plan below the tier.
    const result = resolveGateReason({
      resolved: { enabled: true, available: true, required_plan: "pro" },
      catalogPlan: "pro",
      currentPlan: "free",
      orgLoaded: true,
    });

    expect(result.reason).toBeUndefined();
    expect(result.meetsPlan).toBe(true);
  });
});

describe("Organization AI settings page", () => {
  const webRoot = path.resolve(import.meta.dirname, "..");
  const src = fs.readFileSync(
    path.join(webRoot, "components/Dashboard/Pages/Org/OrgEditAI/OrgEditAI.tsx"),
    "utf8"
  );

  // Attribute order and line breaks are free to change; the prop is not.
  const gates = [...src.matchAll(/<FeatureGate\b([^>]*)>/g)].map((m) => m[1]);
  const aiGates = gates.filter((attrs) => /feature=\{?\s*['"]ai['"]\s*\}?/.test(attrs));

  test("the page still hosts the AI toggle", () => {
    // Keeps the guard below honest: if the switch ever moves off this page the
    // gate assertion would pass vacuously.
    expect(src).toContain("ai.enable_ai");
  });

  test("any gate on the ai feature opts out of the disabled branch", () => {
    for (const attrs of aiGates) {
      expect(attrs).toMatch(/\ballowWhenDisabled\b/);
      expect(attrs).not.toMatch(/allowWhenDisabled=\{\s*false\s*\}/);
    }
  });
});

describe("FeatureGate", () => {
  const webRoot = path.resolve(import.meta.dirname, "..");
  const src = fs.readFileSync(
    path.join(webRoot, "components/Dashboard/Shared/FeatureGate/FeatureGate.tsx"),
    "utf8"
  );

  test("declares the opt-out prop", () => {
    expect(src).toMatch(/allowWhenDisabled\??\s*:\s*boolean/);
  });

  // The resolver tests above cannot see this wiring. If the gate stopped
  // handing the prop to the hook, every opted-in page would lock its admins
  // out again while the rest of the suite stayed green.
  test("forwards the opt-out into the resolved-feature hook", () => {
    const call = src.match(/useResolvedFeature\(([^)]*)\)/);
    expect(call).not.toBeNull();
    expect(call[1]).toMatch(/\ballowWhenDisabled\b/);
  });
});
