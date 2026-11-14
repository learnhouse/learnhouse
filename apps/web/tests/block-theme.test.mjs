import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  parseColor,
  contrastRatio,
  classifyHost,
  resolveBlockTheme,
  buildThemeVars,
  normalizeRequest,
  composite,
  toOklch,
  injectDocumentTheme,
} from "../components/Objects/Activities/BlockTheme/blockTheme.ts";
import { sizeFor } from "../components/Objects/Activities/BlockTheme/BlockThemeScope.tsx";

const hex = (s) => parseColor(s);
const HOSTS = {
  white: "#ffffff",
  reading: "#f7f7f6",
  ink: "#0b0b0f",
  charcoal: "#1f1f22",
  zinc950: "#09090b",
  deepBlue: "#1e3a8a",
  violet: "#6d28d9",
  teal: "#0f766e",
  pastel: "#fef3c7",
  mint: "#d1fae5",
};

describe("parseColor", () => {
  test("reads the syntaxes getComputedStyle returns", () => {
    expect(hex("#fff")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(hex("rgb(30, 58, 138)")).toEqual({ r: 30, g: 58, b: 138, a: 1 });
    expect(hex("rgba(0, 0, 0, 0.5)").a).toBe(0.5);
    expect(hex("rgb(0 0 0 / 0.25)").a).toBe(0.25);
    expect(hex("transparent").a).toBe(0);
    const zinc = hex("oklch(21% 0.006 285.885)");
    expect(Math.round(zinc.r)).toBe(24);
    expect(Math.round(zinc.b)).toBe(27);
    expect(hex("color(srgb 1 0 0)")).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(hex("hsl(0 0% 100%)").r).toBeCloseTo(255);
    expect(hex("nonsense")).toBeNull();
    expect(hex("#12")).toBeNull();
  });

  test("composites translucent layers like the browser", () => {
    const c = composite(hex("rgb(0 0 0 / 0.5)"), hex("#ffffff"));
    expect(Math.round(c.r)).toBe(128);
    expect(c.a).toBe(1);
  });
});

describe("classifyHost", () => {
  test("white and the reading canvas keep the original light look", () => {
    expect(classifyHost(hex(HOSTS.white)).mode).toBe("light");
    expect(classifyHost(hex(HOSTS.reading)).mode).toBe("light");
    // a faint brand tint stays light too
    expect(classifyHost(hex("#eef2ff")).mode).toBe("light");
  });

  test("neutral dark hosts are dark", () => {
    for (const k of ["ink", "charcoal", "zinc950"]) {
      expect(classifyHost(hex(HOSTS[k]))).toEqual({ mode: "dark", tone: "dark" });
    }
  });

  test("coloured hosts are tinted, with the tone the host can carry", () => {
    expect(classifyHost(hex(HOSTS.deepBlue))).toEqual({ mode: "tinted", tone: "dark" });
    expect(classifyHost(hex(HOSTS.violet))).toEqual({ mode: "tinted", tone: "dark" });
    expect(classifyHost(hex(HOSTS.pastel))).toEqual({ mode: "tinted", tone: "light" });
    expect(classifyHost(hex(HOSTS.mint))).toEqual({ mode: "tinted", tone: "light" });
  });
});

describe("resolveBlockTheme", () => {
  test("light mode sets no variables at all", () => {
    expect(resolveBlockTheme(hex(HOSTS.white)).vars).toEqual({});
    expect(resolveBlockTheme(hex(HOSTS.ink), "light")).toMatchObject({ mode: "light", vars: {} });
  });

  test("an explicit dark request on a light host uses the app's charcoal", () => {
    const r = resolveBlockTheme(hex(HOSTS.white), "dark");
    expect(r.mode).toBe("dark");
    expect(r.host).toBe("#18181b");
    expect(r.painted).toBe(true);
    expect(r.vars["--lhb-surface"]).toBeDefined();
  });

  test("an explicit dark request on a dark host derives from that host", () => {
    expect(resolveBlockTheme(hex(HOSTS.charcoal), "dark").host).toBe(HOSTS.charcoal);
  });

  test("a forced mode that doesn't match the page paints its own panel", () => {
    expect(resolveBlockTheme(hex(HOSTS.white), "dark").painted).toBe(true);
    expect(resolveBlockTheme(hex(HOSTS.ink), "dark").painted).toBe(false);
    const light = resolveBlockTheme(hex(HOSTS.ink), "light");
    expect(light).toMatchObject({ painted: true, host: "#ffffff" });
    expect(resolveBlockTheme(hex(HOSTS.ink)).painted).toBe(false);
  });

  test("no host colour falls back to white", () => {
    expect(resolveBlockTheme(null).mode).toBe("light");
  });

  test("mid-tone hosts are flagged for the extra contrast rules", () => {
    expect(resolveBlockTheme(hex(HOSTS.teal)).headroom).toBe("low");
    expect(resolveBlockTheme(hex(HOSTS.ink)).headroom).toBeNull();
  });

  test("normalizeRequest accepts only auto, light and dark", () => {
    expect(normalizeRequest("DARK ")).toBe("dark");
    expect(normalizeRequest("light")).toBe("light");
    expect(normalizeRequest("sepia")).toBe("auto");
    expect(normalizeRequest(undefined)).toBe("auto");
  });
});

describe("buildThemeVars: WCAG AA on every host", () => {
  for (const [name, color] of Object.entries(HOSTS)) {
    const host = hex(color);
    const { mode, tone } = classifyHost(host);
    if (mode === "light") continue;
    test(`${name} (${mode}/${tone})`, () => {
      const v = buildThemeVars(host, tone);
      const fills = [color, v["--lhb-surface"], v["--lhb-raised"], v["--lhb-raised-2"], v["--lhb-n50"], v["--lhb-n100"]].map(hex);
      // Titles and body aim for 7:1 (AAA); mid-tone hosts can't reach it even
      // with pure white, so they are held to AA like everything else.
      const titleMin = resolveBlockTheme(host).headroom === "low" ? 4.5 : 7;
      for (const step of ["--lhb-text", "--lhb-n900", "--lhb-n800"]) {
        for (const f of fills) expect(contrastRatio(hex(v[step]), f)).toBeGreaterThanOrEqual(titleMin);
      }
      for (const step of ["--lhb-muted", "--lhb-text-2", "--lhb-faint", "--lhb-n400", "--lhb-n500", "--lhb-n600", "--lhb-n700"]) {
        for (const f of fills) expect(contrastRatio(hex(v[step]), f)).toBeGreaterThanOrEqual(4.5);
      }
    });
  }

  test("dark surfaces lift off the host instead of matching it", () => {
    for (const c of [HOSTS.ink, HOSTS.charcoal]) {
      const v = buildThemeVars(hex(c), "dark");
      expect(contrastRatio(hex(v["--lhb-surface"]), hex(c))).toBeGreaterThanOrEqual(1.12);
      expect(v["--lhb-surface"]).not.toBe(c);
    }
  });

  test("tinted surfaces keep the host's hue", () => {
    const v = buildThemeVars(hex(HOSTS.deepBlue), "dark");
    const h = toOklch(hex(v["--lhb-surface"])).h;
    expect(Math.abs(h - toOklch(hex(HOSTS.deepBlue)).h)).toBeLessThan(15);
    const p = buildThemeVars(hex(HOSTS.pastel), "light");
    expect(toOklch(hex(p["--lhb-surface"])).l).toBeGreaterThan(toOklch(hex(HOSTS.pastel)).l);
  });
});

describe("sizeFor", () => {
  test("buckets the scope width", () => {
    expect(sizeFor(320)).toBe("xs");
    expect(sizeFor(430)).toBe("xs");
    expect(sizeFor(600)).toBe("sm");
    expect(sizeFor(768)).toBe("md");
    expect(sizeFor(1200)).toBe("lg");
  });
});

describe("block-theme.css", () => {
  const css = readFileSync(new URL("../styles/block-theme.css", import.meta.url), "utf8");
  const globals = readFileSync(new URL("../styles/globals.css", import.meta.url), "utf8");

  test("is imported once from globals.css", () => {
    expect(globals.match(/@import "\.\/block-theme\.css";/g)?.length).toBe(1);
  });

  test("only dark and tinted scopes change anything (light keeps the original look)", () => {
    // every colour rule is gated by a tone attribute, a size attribute or keep/panel markers
    const selectors = [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{/g)].map((m) => m[1].trim()).filter((s) => s && !s.startsWith("@"));
    // split a selector list on top-level commas only (not inside :is(...))
    const parts = (sel) => {
      const out = []; let depth = 0; let cur = "";
      for (const ch of sel) {
        if (ch === "(") depth++;
        if (ch === ")") depth--;
        if (ch === "," && depth === 0) { out.push(cur); cur = ""; } else cur += ch;
      }
      return [...out, cur];
    };
    for (const s of selectors) {
      for (const part of parts(s)) {
        expect(part).toMatch(/data-lh-bt(-tone|-size|-headroom)?=|data-lh-bt-tone\]|\[data-lh-bt='dark'\]|data-lh-bt-painted\]/);
      }
    }
  });

  test("the neutral palette is remapped for every family the blocks use", () => {
    for (const fam of ["gray", "neutral", "zinc", "slate", "stone"]) {
      for (const step of [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]) {
        expect(css).toContain(`--color-${fam}-${step}: var(--lhb-n${step});`);
      }
    }
  });
});

describe("injectDocumentTheme (magic blocks)", () => {
  const dark = { scheme: "dark", mode: "dark", vars: { "--lh-surface": "#1a1a1d", "--lh-text": "#e8e8e9" } };
  test("marks <html> and adds the variables in <head>", () => {
    const out = injectDocumentTheme("<!DOCTYPE html><html lang='en'><head><title>x</title></head><body>hi</body></html>", dark);
    expect(out).toContain('<html data-lh-theme="dark" data-lh-mode="dark" lang=\'en\'>');
    expect(out).toMatch(/<head><style data-lh-theme>:root\{--lh-surface:#1a1a1d;--lh-text:#e8e8e9;color-scheme:dark\}<\/style><title>/);
    expect(out.startsWith("<!DOCTYPE html>")).toBe(true);
  });
  test("adds <head> when the document has none, and wraps fragments", () => {
    expect(injectDocumentTheme("<html><body>x</body></html>", dark)).toContain('<html data-lh-theme="dark" data-lh-mode="dark"><head><style data-lh-theme>');
    const frag = injectDocumentTheme("<!doctype html><body>x</body>", dark);
    expect(frag.startsWith('<!doctype html><html data-lh-theme="dark"')).toBe(true);
    expect(injectDocumentTheme("<p>x</p>", dark)).toMatch(/^<html data-lh-theme="dark"[^>]*><head><style/);
  });
  test("variable values can't break out of the style tag", () => {
    const out = injectDocumentTheme("<html></html>", { scheme: "light", mode: "light", vars: { "--lh-text": "red;}</style><script>x</script>" } });
    expect(out).not.toContain("<script>");
  });
});
