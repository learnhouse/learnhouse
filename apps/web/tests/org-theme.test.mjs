import { describe, expect, test } from "bun:test";

import {
  DEFAULT_THEME_OPTIONS,
  DEFAULT_THEME_STATE,
  FONT_PAIRINGS,
  NEUTRAL_ACCENT,
  THEME_PRESETS,
  applyPreset,
  contrastLevel,
  contrastRatio,
  deriveAccentTokens,
  effectiveHeadingFont,
  ensureContrast,
  fontStack,
  matchFontPairing,
  mixHex,
  normalizeThemeOptions,
  orgThemeColors,
  readOrgTheme,
  readableTextOn,
  resolveAccent,
  resolveHeader,
  sanitizeFont,
  sanitizeHex,
  serializeThemeState,
  themeFontsHref,
  themeRootProps,
  themeStatesEqual,
} from "../lib/theme/orgTheme.ts";

const org = (general = {}, theme) => ({
  config: { config: { config_version: "2.0", customization: { general, ...(theme ? { theme } : {}) } } },
});
const state = (patch = {}, theme = {}) => ({
  ...DEFAULT_THEME_STATE,
  ...patch,
  theme: { ...DEFAULT_THEME_OPTIONS, ...theme },
});

describe("sanitizers", () => {
  test("hex colors are normalized or dropped", () => {
    expect(sanitizeHex("#ABC")).toBe("#aabbcc");
    expect(sanitizeHex(" 1d4ed8 ")).toBe("#1d4ed8");
    expect(sanitizeHex("red")).toBe("");
    expect(sanitizeHex("#fff;background:url(x)")).toBe("");
    expect(sanitizeHex(undefined)).toBe("");
    expect(sanitizeHex(12)).toBe("");
  });

  test("font names allow only Google-style family names", () => {
    expect(sanitizeFont("  Source   Sans 3 ")).toBe("Source Sans 3");
    expect(sanitizeFont("Inter'; color: red")).toBe("");
    expect(sanitizeFont("Inter&family=Evil")).toBe("");
    expect(sanitizeFont("x".repeat(65))).toBe("");
    expect(sanitizeFont(null)).toBe("");
  });

  test("theme options fall back to defaults for unknown values", () => {
    expect(normalizeThemeOptions(null)).toEqual(DEFAULT_THEME_OPTIONS);
    const out = normalizeThemeOptions({ radius: "pill", card_style: "border", accent_color: "javascript:x", extra: 1 });
    expect(out.radius).toBe("soft");
    expect(out.card_style).toBe("border");
    expect(out.accent_color).toBe("");
    expect("extra" in out).toBe(false);
  });
});

describe("reading and serializing", () => {
  test("reads v2 and v1 configs", () => {
    const v2 = readOrgTheme(org({ color: "#0369A1", font: "Inter" }, { radius: "round" }));
    expect(v2).toEqual(state({ color: "#0369a1", font: "Inter" }, { radius: "round" }));
    const v1 = readOrgTheme({ config: { config: { general: { color: "#111", theme: { density: "compact" } } } } });
    expect(v1.color).toBe("#111111");
    expect(v1.theme.density).toBe("compact");
    expect(readOrgTheme(undefined)).toEqual(DEFAULT_THEME_STATE);
  });

  test("serialization round-trips and compares by value", () => {
    const s = state({ color: "#ABC" }, { accent_mode: "custom", accent_color: "#0EA5E9" });
    const out = serializeThemeState(s);
    expect(out.color).toBe("#aabbcc");
    expect(out.theme.accent_color).toBe("#0ea5e9");
    expect(themeStatesEqual(s, out)).toBe(true);
    expect(themeStatesEqual(s, DEFAULT_THEME_STATE)).toBe(false);
  });
});

describe("color derivation", () => {
  test("contrast ratio matches WCAG reference values", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
    expect(contrastLevel("#767676", "#ffffff").level).toBe("AA");
    expect(contrastLevel("#ffff00", "#ffffff").level).toBe("fail");
  });

  test("readable text picks white on dark and dark on light", () => {
    expect(readableTextOn("#1d4ed8")).toBe("#ffffff");
    expect(readableTextOn("#fde047")).toBe("#111111");
  });

  test("mix goes from a to b", () => {
    expect(mixHex("#000000", "#ffffff", 0)).toBe("#000000");
    expect(mixHex("#000000", "#ffffff", 1)).toBe("#ffffff");
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#808080");
  });

  test("ink color always reaches AA on white", () => {
    for (const hex of ["#fde047", "#22d3ee", "#a3e635", "#ffffff", "#1d4ed8"]) {
      expect(contrastRatio(ensureContrast(hex), "#ffffff")).toBeGreaterThanOrEqual(4.5);
    }
  });

  test("accent tokens: contrast-checked text, shades, soft tint", () => {
    const blue = deriveAccentTokens("#1d4ed8");
    expect(blue.contrast).toBe("#ffffff");
    expect(blue.light).toBe(false);
    expect(contrastRatio(blue.hover, "#ffffff")).toBeGreaterThan(contrastRatio("#1d4ed8", "#ffffff"));
    expect(contrastRatio(blue.soft, "#ffffff")).toBeLessThan(1.3);
    expect(blue.ring).toBe("rgba(29, 78, 216, 0.35)");

    const yellow = deriveAccentTokens("#fde047");
    expect(yellow.contrast).toBe("#111111");
    expect(yellow.light).toBe(true);
    expect(contrastRatio(yellow.ink, "#ffffff")).toBeGreaterThanOrEqual(4.5);

    // Near-black accents lighten on hover instead of vanishing.
    const black = deriveAccentTokens("#000000");
    expect(black.hover).not.toBe("#000000");
    expect(deriveAccentTokens("nope").accent).toBe(NEUTRAL_ACCENT);
  });
});

describe("resolution", () => {
  test("accent: neutral, brand-following, custom", () => {
    expect(resolveAccent(state({ color: "#be123c" }))).toBeNull();
    expect(resolveAccent(state({ color: "#be123c" }, { accent_mode: "brand" }))).toBe("#be123c");
    expect(resolveAccent(state({}, { accent_mode: "brand" }))).toBeNull();
    expect(resolveAccent(state({}, { accent_mode: "custom", accent_color: "#0ea5e9" }))).toBe("#0ea5e9");
    expect(resolveAccent(state({}, { accent_mode: "custom" }))).toBeNull();
  });

  test("header: brand without color is the default white bar", () => {
    expect(resolveHeader(state())).toEqual({ color: "", glass: false });
    expect(resolveHeader(state({ color: "#0369a1" }))).toEqual({ color: "#0369a1", glass: false });
    expect(resolveHeader(state({ color: "#0369a1" }, { header_style: "white" }))).toEqual({ color: "", glass: false });
    expect(resolveHeader(state({}, { header_style: "dark" })).color).toBe("#111111");
    expect(resolveHeader(state({}, { header_style: "glass" }))).toEqual({ color: "", glass: true });
  });

  test("fonts: one stylesheet for the pair, none for the default face", () => {
    expect(themeFontsHref(DEFAULT_THEME_STATE)).toBeNull();
    expect(themeFontsHref(state({ font: "Wix Madefor Text" }))).toBeNull();
    expect(themeFontsHref(state({ font: "Inter" }))).toBe(
      "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap",
    );
    expect(themeFontsHref(state({ font: "IBM Plex Sans" }, { heading_font: "Space Grotesk" }))).toBe(
      "https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap",
    );
    // Same heading and body font loads once.
    expect(effectiveHeadingFont(state({ font: "Inter" }, { heading_font: "Inter" }))).toBe("");
    expect(fontStack("")).toContain("var(--font-default)");
    expect(fontStack("Inter")).toStartWith("'Inter'");
  });
});

describe("theme root props", () => {
  test("the default theme sets no attributes and no background (pre-theme look)", () => {
    const { style, attrs } = themeRootProps(DEFAULT_THEME_STATE);
    expect(attrs).toEqual({});
    expect(style.backgroundColor).toBeUndefined();
    expect(style.fontFamily).toBeUndefined();
    expect(style["--lh-accent"]).toBe(NEUTRAL_ACCENT);
  });

  test("a brand color alone keeps the old 5% tint and no accent attribute", () => {
    const { style, attrs } = themeRootProps(state({ color: "#0369a1" }));
    expect(style.backgroundColor).toBe("rgba(3, 105, 161, 0.05)");
    expect(attrs["data-lh-accent"]).toBeUndefined();
    expect(style["--lh-brand"]).toBe("#0369a1");
  });

  test("non-default options emit attributes and tokens", () => {
    const { style, attrs } = themeRootProps(
      state(
        { color: "#7c3aed", font: "Manrope" },
        {
          accent_mode: "brand",
          radius: "round",
          button_style: "soft",
          card_style: "border",
          density: "compact",
          background: "pattern",
          heading_font: "Sora",
        },
      ),
    );
    expect(attrs).toEqual({
      "data-lh-accent": "dark",
      "data-lh-btn": "soft",
      "data-lh-card": "border",
      "data-lh-density": "compact",
      "data-lh-radius": "round",
      "data-lh-heading": "",
      "data-lh-bg": "pattern",
    });
    expect(style["--lh-radius-btn"]).toBe("9999px");
    expect(style["--lh-font-heading"]).toStartWith("'Sora'");
    expect(style.fontFamily).toStartWith("'Manrope'");
    expect(style.backgroundImage).toContain("radial-gradient");
  });

  test("a light accent is flagged so button text turns dark", () => {
    const { attrs, style } = themeRootProps(state({}, { accent_mode: "custom", accent_color: "#fde047" }));
    expect(attrs["data-lh-accent"]).toBe("light");
    expect(style["--lh-accent-contrast"]).toBe("#111111");
  });

  test("plain background drops the tint", () => {
    expect(themeRootProps(state({ color: "#0369a1" }, { background: "plain" })).style.backgroundColor).toBeUndefined();
  });
});

describe("presets and pairings", () => {
  test("every preset is valid and survives serialization", () => {
    for (const preset of THEME_PRESETS) {
      const s = applyPreset(preset.key);
      expect(s.theme.preset).toBe(preset.key);
      expect(serializeThemeState(s)).toEqual(s);
    }
    expect(applyPreset("classic")).toEqual(state({}, { preset: "classic" }));
    expect(applyPreset("nope").theme.preset).toBe("classic");
  });

  test("pairings use valid font names and match back", () => {
    for (const p of FONT_PAIRINGS) {
      expect(sanitizeFont(p.heading)).toBe(p.heading);
      expect(sanitizeFont(p.body)).toBe(p.body);
    }
    expect(matchFontPairing(state({ font: "IBM Plex Sans" }, { heading_font: "Space Grotesk" })).key).toBe("technical");
    expect(matchFontPairing(state({ font: "Inter" })).key).toBe("modern");
    expect(matchFontPairing(DEFAULT_THEME_STATE).key).toBe("default");
    expect(matchFontPairing(state({ font: "Karla" }))).toBeNull();
  });

  test("OG helper always returns usable colors", () => {
    expect(orgThemeColors(undefined)).toMatchObject({ brand: NEUTRAL_ACCENT, brandText: "#ffffff" });
    const c = orgThemeColors(org({ color: "#fde047" }, { accent_mode: "custom", accent_color: "#1d4ed8", heading_font: "Sora" }));
    expect(c).toMatchObject({ brand: "#fde047", brandText: "#111111", accent: "#1d4ed8", accentText: "#ffffff", headingFont: "Sora" });
  });
});

