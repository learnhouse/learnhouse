// Org settings v2: Overview is the first tab, old URLs (usage, plan, features)
// redirect with their query, and General's one-page form model: reading the
// org, inline validation, the first invalid section and what a save sends.

import { describe, expect, test } from "bun:test";
import {
  DEFAULT_SETTINGS_TAB,
  RENAMED_IN_SETTINGS,
  isMovedSubpage,
  renamedSettingsUrl,
} from "../app/orgs/[orgslug]/dash/org/settings/settingsTabs.ts";
import {
  FEATURE_GROUPS,
  SECTIONS,
  diffGeneral,
  firstInvalidSection,
  readGeneral,
  sectionDirty,
  validateGeneral,
} from "../components/Dashboard/Pages/Org/OrgEditGeneral/generalModel.ts";
import { OPTIONAL_FEATURES, FEATURES_SETTINGS_HREF } from "../services/features/optionalFeatures.ts";

describe("settings tabs", () => {
  test("Overview is the default tab", () => {
    expect(DEFAULT_SETTINGS_TAB).toBe("overview");
  });

  test("old tabs redirect, keeping the query; Features lands on General#features", () => {
    expect(renamedSettingsUrl("usage", "?section=features")).toBe("/dash/org/settings/overview?section=features");
    expect(renamedSettingsUrl("plan", "", "#x")).toBe("/dash/org/settings/overview#x");
    expect(renamedSettingsUrl("plan-usage")).toBe("/dash/org/settings/overview");
    expect(renamedSettingsUrl("features", "?a=1", "#old")).toBe("/dash/org/settings/general?a=1#features");
    expect(renamedSettingsUrl("general")).toBeNull();
    expect(renamedSettingsUrl("overview")).toBeNull();
  });

  test("renamed tabs count as moved (the layout skips its header for them)", () => {
    for (const key of Object.keys(RENAMED_IN_SETTINGS)) expect(isMovedSubpage(key)).toBe(true);
    expect(isMovedSubpage("overview")).toBe(false);
    expect(isMovedSubpage("general")).toBe(false);
  });

  test("the shared Features link points at General's section", () => {
    expect(FEATURES_SETTINGS_HREF).toBe("/dash/org/settings/general#features");
  });
});

const rf = (over = {}) =>
  Object.fromEntries(
    OPTIONAL_FEATURES.map((f) => [f.key, { enabled: true, available: true, limit: 0, required_plan: null, disabled_by: null, upgrade_plan: null, ...(over[f.key] || {}) }])
  );

const org = (configOver = {}, orgOver = {}) => ({
  name: "Acme",
  description: "We teach",
  about: "",
  label: "tech",
  email: "hi@acme.test",
  socials: { twitter: "acme" },
  links: {},
  config: {
    config: {
      customization: { general: { footer_text: "© Acme", email_sender_name: "Acme team", default_language: "fr" } },
      resolved_features: rf(),
      ...configOver,
    },
  },
  ...orgOver,
});

describe("General form model", () => {
  test("every optional feature is in exactly one group", () => {
    const grouped = FEATURE_GROUPS.flatMap((g) => g.features);
    expect(new Set(grouped).size).toBe(grouped.length);
    expect([...grouped].sort()).toEqual(OPTIONAL_FEATURES.map((f) => f.key).sort());
    expect(SECTIONS).toEqual(["organization", "contact", "language", "features", "footer"]);
  });

  test("reads profile, contact, language, footer, features and live editing", () => {
    const d = readGeneral(
      org({
        resolved_features: rf({
          boards: { enabled: false, available: false, upgrade_plan: "pro" },
          podcasts: { enabled: false, disabled_by: "org" },
          payments: { enabled: false, disabled_by: "platform" },
        }),
        features: { collaboration: { live_editing: false } },
      })
    );
    expect(d.email).toBe("hi@acme.test");
    expect(d.defaultLanguage).toBe("fr");
    expect(d.footerText).toBe("© Acme");
    expect(d.emailSenderName).toBe("Acme team");
    // Locked and platform-blocked features have no switch in the draft.
    expect("boards" in d.features).toBe(false);
    expect("payments" in d.features).toBe(false);
    expect(d.features.podcasts).toBe(false);
    expect(d.features.paths).toBe(true);
    expect(d.liveEditing).toBe(false);
  });

  test("defaults for an empty org", () => {
    const d = readGeneral({});
    expect(d.defaultLanguage).toBe("en");
    expect(d.liveEditing).toBe(true);
    expect(d.socials).toEqual({});
    expect(Object.keys(d.features)).toHaveLength(OPTIONAL_FEATURES.length);
  });

  test("inline validation and the first invalid section", () => {
    const ok = readGeneral(org());
    expect(validateGeneral(ok)).toEqual({});
    expect(firstInvalidSection({})).toBeNull();
    const bad = { ...ok, name: " ", description: "x".repeat(101), about: "y".repeat(401), label: "", email: "nope" };
    const errors = validateGeneral(bad);
    expect(errors).toEqual({
      name: "name_required",
      description: "short_description_max",
      about: "about_max",
      label: "label_required",
      email: "email_invalid",
    });
    expect(firstInvalidSection(errors)).toBe("organization");
    expect(firstInvalidSection({ email: "email_invalid" })).toBe("contact");
    expect(validateGeneral({ ...ok, name: "n".repeat(61), description: "" })).toEqual({
      name: "name_max",
      description: "short_description_required",
    });
    expect(validateGeneral({ ...ok, email: "" })).toEqual({});
  });

  test("dirty sections and what a save sends", () => {
    const saved = readGeneral(org());
    const draft = {
      ...saved,
      email: " new@acme.test ",
      footerText: "Bye",
      features: { ...saved.features, podcasts: false },
      liveEditing: false,
    };
    expect(SECTIONS.filter((s) => sectionDirty(s, draft, saved))).toEqual(["contact", "features", "footer"]);
    const diff = diffGeneral(draft, saved);
    expect(diff).toEqual({
      profile: true,
      footer: true,
      senderName: false,
      language: false,
      features: [{ key: "podcasts", enabled: false }],
      liveEditing: true,
    });
    expect(diffGeneral(saved, saved)).toEqual({
      profile: false,
      footer: false,
      senderName: false,
      language: false,
      features: [],
      liveEditing: false,
    });
  });
});
