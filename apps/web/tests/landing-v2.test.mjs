import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { gradientCss, declarations, pageBackground, pageScheme, themeVars } from "../components/LandingPages/model/style.ts";
import { DEFAULT_DARK_COLORS, DEFAULT_THEME, asDoc, emptyDoc } from "../components/LandingPages/model/types.ts";
import { filterTemplates, galleryTemplates } from "../components/LandingPages/gallery/filter.ts";
import {
  DEFAULT_THEME_OPTIONS, DEFAULT_THEME_STATE, FONT_PAIRINGS, NEUTRAL_PAGE, THEME_PRESETS, applyPreset, normalizeThemeOptions, themeRootProps,
} from "../lib/theme/orgTheme.ts";
import { extractLogoPalette, usableBrandColor } from "../lib/theme/logoPalette.ts";

const state = (theme = {}, extra = {}) => ({ ...DEFAULT_THEME_STATE, ...extra, theme: { ...DEFAULT_THEME_OPTIONS, ...theme } });

describe("landing document: radial gradients and dark palette", () => {
  test("radial gradient css", () => {
    expect(gradientCss("#000", "#fff", null, 90)).toBe("linear-gradient(90deg,#000,#fff)");
    expect(gradientCss("#000", "#fff", "#888", 90, "radial")).toContain("radial-gradient(120% 90% at 50% 0%,#000,#888,#fff 70%)");
    const decls = declarations({ backgroundGradient: { from: "$primary", to: "#000000", type: "radial" } });
    expect(decls[0]).toContain("radial-gradient");
  });

  test("dark palette swaps surfaces only in dark", () => {
    const theme = { ...DEFAULT_THEME, dark: { ...DEFAULT_DARK_COLORS, primary: "#ff00aa" } };
    expect(themeVars(theme)["--lhp-background"]).toBe("#ffffff");
    const dark = themeVars(theme, true);
    expect(dark["--lhp-background"]).toBe(DEFAULT_DARK_COLORS.background);
    expect(dark["--lhp-primary"]).toBe("#ff00aa");
    // No dark palette: the page keeps its design.
    expect(themeVars(DEFAULT_THEME, true)["--lhp-background"]).toBe("#ffffff");
    expect(pageScheme({ page: {}, theme }, true)).toBe("dark");
    expect(pageScheme({ page: {}, theme }, false)).toBe("light");
    expect(pageBackground({ background: "#123456" }, true).backgroundColor).toBe("var(--lhp-background)");
    expect(pageBackground({ background: "#123456" }, false).backgroundColor).toBe("#123456");
  });

  test("brand tokens follow the org theme", () => {
    const vars = themeVars({ ...DEFAULT_THEME, colors: { ...DEFAULT_THEME.colors, secondary: "brand", accent: "brand" } });
    expect(vars["--lhp-secondary"]).toContain("--lh-secondary");
    expect(vars["--lhp-accent"]).toContain("--lh-accent");
  });

  test("asDoc keeps social image and noindex", () => {
    const doc = asDoc({ ...emptyDoc(), page: { image: "/og.png", noindex: true } });
    expect(doc.page.image).toBe("/og.png");
    expect(doc.page.noindex).toBe(true);
  });
});

describe("template gallery filters", () => {
  const list = [
    { id: "academy", name: "Meridian", description: "Editorial", category: "academy", scheme: "light", tags: ["serif"] },
    { id: "bootcamp", name: "Forge", description: "Dark", category: "bootcamp", scheme: "dark", tags: ["bold"] },
    { id: "creator", name: "Old", description: "", legacy: true },
  ];
  test("legacy hidden, filters combine", () => {
    expect(galleryTemplates(list).map((t) => t.id)).toEqual(["academy", "bootcamp"]);
    expect(filterTemplates(list, { category: "bootcamp" }).map((t) => t.id)).toEqual(["bootcamp"]);
    expect(filterTemplates(list, { scheme: "dark" }).map((t) => t.id)).toEqual(["bootcamp"]);
    expect(filterTemplates(list, { scheme: "light", category: "all" }).map((t) => t.id)).toEqual(["academy", "creator"]);
    expect(filterTemplates(list, { query: "serif" }).map((t) => t.id)).toEqual(["academy"]);
    expect(filterTemplates(list, { query: "forja" }, (t) => (t.id === "bootcamp" ? "Forja" : t.name)).map((t) => t.id)).toEqual(["bootcamp"]);
  });
});

describe("theme studio options", () => {
  test("defaults add nothing to the page", () => {
    const { attrs } = themeRootProps(DEFAULT_THEME_STATE);
    expect(Object.keys(attrs)).toEqual([]);
  });

  test("each option becomes an attribute or token", () => {
    const { attrs, style } = themeRootProps(state({
      secondary_color: "#ffaa00", neutral: "warm", type_scale: "large", heading_weight: "600", button_shape: "pill", elevation: "lifted",
      link_style: "underline", header_layout: "centered", footer_style: "bar", image_style: "framed", dark_accent: "#ff7a45", radius: "none",
    }, { color: "#1f4d3a" }));
    expect(style["--lh-secondary"]).toBe("#ffaa00");
    expect(attrs["data-lh-neutral"]).toBe("warm");
    expect(style["--lh-hairline"]).toBe(NEUTRAL_PAGE.warm.hairline);
    expect(attrs["data-lh-type"]).toBe("large");
    expect(style["--lh-heading-weight"]).toBe("600");
    expect(attrs["data-lh-btn-shape"]).toBe("pill");
    expect(style["--lh-radius-btn"]).toBe("9999px");
    expect(style["--lh-radius-card"]).toBe("0px");
    expect(attrs["data-lh-elevation"]).toBe("lifted");
    expect(attrs["data-lh-link"]).toBe("underline");
    expect(attrs["data-lh-header"]).toBe("centered");
    expect(attrs["data-lh-footer"]).toBe("bar");
    expect(attrs["data-lh-img"]).toBe("framed");
    expect(attrs["data-lh-dark-accent"]).toBe("");
    expect(style["--lh-dark-accent"]).toBe("#ff7a45");
  });

  test("backgrounds: grid, glow, warm plain", () => {
    expect(themeRootProps(state({ background: "grid" })).attrs["data-lh-bg"]).toBe("grid");
    const glow = themeRootProps(state({ background: "gradient", secondary_color: "#00aaff" }, { color: "#ff0000" }));
    expect(glow.style.backgroundImage).toContain("radial-gradient");
    expect(themeRootProps(state({ background: "plain", neutral: "cool" })).style.backgroundColor).toBe(NEUTRAL_PAGE.cool.page);
  });

  test("forced light keeps a solid light base and the user-content marker", () => {
    const tinted = themeRootProps(state({ public_scheme: "light" }, { color: "#336699" }));
    expect(tinted.attrs["data-lh-scheme"]).toBe("light");
    expect(tinted.attrs["data-lh-user-content"]).toBe("");
    expect(tinted.style.backgroundColor).toBe("#ffffff");
    expect(tinted.style.backgroundImage).toContain("rgba(51, 102, 153, 0.05)");
    expect(themeRootProps(state({ public_scheme: "light", background: "plain", neutral: "warm" })).style.backgroundColor).toBe(NEUTRAL_PAGE.warm.page);
  });

  test("normalize drops junk and keeps new values", () => {
    const t = normalizeThemeOptions({ neutral: "purple", type_scale: "large", secondary_color: "red", dark_accent: "#abc", background: "grid" });
    expect(t.neutral).toBe("neutral");
    expect(t.type_scale).toBe("large");
    expect(t.secondary_color).toBe("");
    expect(t.dark_accent).toBe("#aabbcc");
    expect(t.background).toBe("grid");
  });

  test("16 presets, each a full look", () => {
    expect(THEME_PRESETS.length).toBe(16);
    for (const p of THEME_PRESETS) expect(applyPreset(p.key).theme.preset).toBe(p.key);
    expect(FONT_PAIRINGS.length).toBeGreaterThanOrEqual(16);
  });

  test("web presets match the API's (agents apply the same looks)", () => {
    const py = readFileSync(new URL("../../api/src/services/orgs/theme.py", import.meta.url), "utf8");
    for (const p of THEME_PRESETS) {
      const block = py.split("\n").find((l) => l.trim().startsWith(`"${p.key}": {`));
      expect(block, p.key).toBeTruthy();
      expect(block).toContain(`"color": "${p.color}"`);
      expect(block).toContain(`"font": "${p.font}"`);
      for (const [k, v] of Object.entries(p.theme)) {
        if (v === DEFAULT_THEME_OPTIONS[k]) continue;
        expect(block, `${p.key}.${k}`).toContain(`"${k}": "${v}"`);
      }
    }
  });
});

describe("import from logo", () => {
  const px = (colors) => {
    const out = [];
    for (const [r, g, b, a, n] of colors) for (let i = 0; i < n; i++) out.push(r, g, b, a);
    return out;
  };
  test("picks the brand color, ignores background and outlines", () => {
    const pal = extractLogoPalette(px([[255, 255, 255, 255, 500], [0, 0, 0, 255, 100], [20, 80, 200, 255, 120], [240, 140, 30, 255, 60], [30, 30, 30, 0, 300]]));
    expect(pal.primary).toBe("#1450c8");
    expect(pal.secondary).toBe("#f08c1e");
    expect(pal.swatches.length).toBe(2);
  });
  test("black and white logos give nothing", () => {
    expect(extractLogoPalette(px([[255, 255, 255, 255, 50], [10, 10, 10, 255, 50]])).primary).toBe("");
  });
  test("very light brand colors are deepened for buttons", () => {
    expect(usableBrandColor("")).toBe("");
    expect(usableBrandColor("#ffe066")).not.toBe("#ffe066");
    expect(usableBrandColor("#1450c8")).toBe("#1450c8");
  });
});
