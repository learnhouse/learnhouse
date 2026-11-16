import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { cssColor, cssLength, cssUrl, declarations, nodeCss, treeCss, docCss, themeVars, themeFontsUrl, readableOn, fontStack, gridCols } from "../components/LandingPages/model/style.ts";
import { asDoc, emptyDoc, DEFAULT_THEME } from "../components/LandingPages/model/types.ts";
import {
  newId, reid, findNode, locate, pathTo, walk, countNodes, updateNode, setProps, setStyle, withStyle, removeNode, insertNode,
  moveNode, duplicateNode, canContain, asSection, makeSymbol, detachSymbol, pruneSymbols, isInside,
} from "../components/LandingPages/model/tree.ts";
import { diffDocs, isEmptyDiff, labelOf } from "../components/LandingPages/model/diff.ts";
import { initialState, reducer } from "../components/LandingPages/builder/store.ts";

function sampleDoc() {
  const doc = emptyDoc();
  doc.root = [
    { id: "s1", type: "section", props: {}, children: [
      { id: "c1", type: "container", props: {}, children: [
        { id: "h1", type: "heading", props: { text: "Hello", level: 1 } },
        { id: "t1", type: "text", props: { text: "World" } },
      ] },
    ] },
    { id: "s2", type: "section", props: {}, children: [] },
  ];
  doc.symbols = { symA: { name: "Card", node: { id: "sa", type: "container", props: {}, children: [{ id: "sat", type: "text", props: { text: "S" } }] } } };
  return doc;
}

describe("style values are re-checked before reaching CSS", () => {
  test("lengths", () => {
    expect(cssLength(24)).toBe("24px");
    expect(cssLength("2rem")).toBe("2rem");
    expect(cssLength("auto")).toBeNull();
    expect(cssLength("auto", true)).toBe("auto");
    expect(cssLength("1px;color:red")).toBeNull();
    expect(cssLength(Infinity)).toBeNull();
    expect(cssLength("calc(1px+2px)")).toBeNull();
  });
  test("colors and tokens", () => {
    expect(cssColor("#fff")).toBe("#fff");
    expect(cssColor("rgba(0, 0, 0, 0.5)")).toBe("rgba(0, 0, 0, 0.5)");
    expect(cssColor("$primary")).toBe("var(--lhp-primary)");
    expect(cssColor("$evil")).toBeNull();
    expect(cssColor("red;background:url(x)")).toBeNull();
    expect(cssColor("expression(alert(1))")).toBeNull();
  });
  test("urls", () => {
    expect(cssUrl("/a.png")).toBe('url("/a.png")');
    expect(cssUrl("https://x.y/a.png")).toBe('url("https://x.y/a.png")');
    expect(cssUrl("javascript:alert(1)")).toBeNull();
    expect(cssUrl('https://x.y/a.png")')).toBeNull();
    expect(cssUrl("//evil.com/x.png")).toBeNull();
  });
  test("declarations drop anything not allowlisted", () => {
    const d = declarations({ paddingLeft: 10, marginRight: "auto", color: "$text", position: "fixed", display: "flex", fontWeight: "900", textAlign: "evil", gridColumns: 3, borderWidth: 1, aspectRatio: "16/9", boxShadow: "lg", fontFamily: "heading", backgroundGradient: { from: "#000", to: "$primary", angle: 45 }, backgroundImage: "/i.png" });
    const css = d.join(";");
    expect(css).toContain("padding-inline-start:10px");
    expect(css).toContain("margin-inline-end:auto");
    expect(css).toContain("color:var(--lhp-text)");
    expect(css).not.toContain("position");
    expect(css).not.toContain("evil");
    expect(css).toContain("grid-template-columns:repeat(3,minmax(0,1fr))");
    expect(css).toContain("border-style:solid");
    expect(css).toContain("aspect-ratio:16 / 9");
    expect(css).toContain('background-image:linear-gradient(45deg,#000,var(--lhp-primary)),url("/i.png")');
    expect(declarations({ maxWidth: "content" })).toEqual(["max-width:var(--lhp-width)"]);
    expect(declarations({ backgroundImage: "/x.png" }).join(";")).toContain("background-size:cover");
    expect(declarations({ fontFamily: "Playfair Display" })[0]).toContain("Georgia");
    expect(declarations({ fontFamily: "Bad; x" })).toEqual([]);
    expect(declarations(undefined)).toEqual([]);
  });
});

describe("node CSS", () => {
  test("responsive overrides use container queries; hover only allows safe keys", () => {
    const css = nodeCss({ id: "n1", type: "text", props: {}, style: { base: { fontSize: 40 }, tablet: { fontSize: 32 }, mobile: { fontSize: 24 }, hover: { color: "#f00", width: 300 } } });
    expect(css).toContain(".lhp-n1{font-size:40px}");
    expect(css).toContain("@container lhp (max-width: 1023px){.lhp-n1{font-size:32px}}");
    expect(css).toContain("@container lhp (max-width: 639px){.lhp-n1{font-size:24px}}");
    expect(css).toContain(".lhp-n1:hover{color:#f00}");
    expect(css).not.toContain("width:300px");
  });
  test("hidden per breakpoint: gone on the site, faded on the canvas", () => {
    const node = { id: "n2", type: "text", props: {}, hidden: { mobile: true, desktop: true } };
    expect(nodeCss(node)).toContain("display:none !important");
    expect(nodeCss(node, { canvas: true })).toContain("opacity:.35");
    expect(nodeCss(node)).toContain("min-width: 1024px");
  });
  test("overlay and bad ids", () => {
    expect(nodeCss({ id: "o", type: "section", props: {}, style: { base: { overlayColor: "#000", overlayOpacity: 50 } } })).toContain("opacity:0.5");
    expect(nodeCss({ id: "bad id}{", type: "text", props: {} })).toBe("");
    expect(treeCss(sampleDoc().root)).toContain("");
    expect(docCss(sampleDoc())).toBe("");
  });
});

test("card grids never have more columns than items", () => {
  expect(gridCols(4, 3)).toBe(3);
  expect(gridCols(3, 6)).toBe(3);
  expect(gridCols(undefined, 2)).toBe(2);
  expect(gridCols(undefined, 0, 4)).toBe(4);
  expect(gridCols(12, 20)).toBe(6);
  expect(gridCols("x", 1)).toBe(1);
  // No lonely last card: 4 in a row, 4+3, 2+2 when four columns are already the max asked.
  expect(gridCols(3, 4)).toBe(4);
  expect(gridCols(3, 7)).toBe(4);
  expect(gridCols(6, 7)).toBe(5);
  expect(gridCols(2, 3)).toBe(3);
  expect(gridCols(4, 5)).toBe(5);
  expect(gridCols(3, 5)).toBe(3);
});

describe("theme", () => {
  test("brand colors read the org theme; custom ones get a readable contrast", () => {
    const vars = themeVars(DEFAULT_THEME);
    expect(vars["--lhp-primary"]).toContain("--lh-brand");
    expect(vars["--lhp-width"]).toBe("1200px");
    const dark = themeVars({ ...DEFAULT_THEME, colors: { ...DEFAULT_THEME.colors, primary: "#111111" }, buttonStyle: "pill" });
    expect(dark["--lhp-on-primary"]).toBe("#ffffff");
    expect(dark["--lhp-radius-btn"]).toBe("999px");
    expect(readableOn("#ffffff")).toBe("#111111");
    expect(readableOn("#4f46e5")).toBe("#ffffff");
    expect(readableOn("#fde68a")).toBe("#111111");
    expect(readableOn("#38bdf8")).toBe("#111111");
    expect(readableOn("#0ea5e9")).toBe("#111111");
    expect(readableOn("#2563eb")).toBe("#ffffff");
    expect(readableOn("#fff8")).toBe("#111111");
    expect(readableOn("#11223380")).toBe("#ffffff");
    expect(readableOn("nope")).toBe("#ffffff");
    expect(fontStack("brand", "--x")).toBe("var(--x, inherit)");
    const page = (theme, root = []) => ({ theme, root, symbols: {} });
    expect(themeFontsUrl(page(DEFAULT_THEME))).toBeNull();
    expect(themeFontsUrl(page({ ...DEFAULT_THEME, fonts: { heading: "DM Sans", body: "DM Sans" } }))).toContain("family=DM+Sans");
    // System faces download nothing; an element's own font is loaded too.
    expect(themeFontsUrl(page({ ...DEFAULT_THEME, fonts: { heading: "System Serif", body: "brand" } }))).toBeNull();
    const withEl = themeFontsUrl(page(DEFAULT_THEME, [{ id: "a", type: "section", children: [{ id: "b", type: "heading", style: { mobile: { fontFamily: "Fraunces" }, base: { fontFamily: "heading" } } }] }]));
    expect(withEl).toContain("family=Fraunces") && expect(withEl).not.toContain("heading");
    expect(fontStack("System Mono", "--x")).toContain("ui-monospace");
    expect(fontStack("Instrument Serif", "--x")).toBe('"Instrument Serif", Georgia, serif');
    expect(fontStack("JetBrains Mono", "--x")).toContain("monospace");
    expect(fontStack("bad;font", "--x")).toBe("inherit");
  });
  test("asDoc tolerates anything", () => {
    expect(asDoc(null).root).toEqual([]);
    expect(asDoc({ root: [{ type: "text" }, null, 5], theme: { radius: "sm" } }).root.length).toBe(1);
    expect(asDoc({ theme: { radius: "sm" } }).theme.colors.primary).toBe("brand");
  });
});

describe("tree edits", () => {
  test("find, locate, path, walk", () => {
    const doc = sampleDoc();
    expect(findNode(doc, "t1").props.text).toBe("World");
    expect(findNode(doc, "sat").type).toBe("text");
    expect(locate(doc, "t1")).toEqual({ parentId: "c1", index: 1, symbolId: undefined });
    expect(locate(doc, "sa").symbolId).toBe("symA");
    expect(locate(doc, "zz")).toBeNull();
    expect(pathTo(doc, "t1").map((n) => n.id)).toEqual(["s1", "c1"]);
    expect(pathTo(doc, "sat").map((n) => n.id)).toEqual(["sa"]);
    expect(countNodes(doc)).toBe(7);
    expect(isInside(doc, "t1", "s1")).toBe(true);
  });
  test("updates are immutable and keep untouched branches", () => {
    const doc = sampleDoc();
    const next = setProps(doc, "t1", { text: "Changed" });
    expect(findNode(doc, "t1").props.text).toBe("World");
    expect(findNode(next, "t1").props.text).toBe("Changed");
    expect(next.root[1]).toBe(doc.root[1]);
    expect(updateNode(doc, "zz", (n) => n)).toBe(doc);
    const styled = setStyle(doc, "t1", "mobile", "fontSize", 20);
    expect(findNode(styled, "t1").style).toEqual({ mobile: { fontSize: 20 } });
    expect(findNode(setStyle(styled, "t1", "mobile", "fontSize", undefined), "t1").style).toBeUndefined();
    expect(withStyle({ base: { color: "#000" } }, "base", { color: "" })).toBeUndefined();
    const sym = setProps(doc, "sat", { text: "All copies" });
    expect(sym.symbols.symA.node.children[0].props.text).toBe("All copies");
  });
  test("insert, remove, move, duplicate", () => {
    const doc = sampleDoc();
    const ins = insertNode(doc, { id: "n", type: "button", props: {} }, "c1", 0);
    expect(findNode(ins, "c1").children[0].id).toBe("n");
    expect(insertNode(doc, { id: "s3", type: "section", props: {} }, null, 0).root[0].id).toBe("s3");
    expect(findNode(removeNode(doc, "h1"), "h1")).toBeNull();
    const moved = moveNode(doc, "s1", null, 2);
    expect(moved.root.map((n) => n.id)).toEqual(["s2", "s1"]);
    expect(moveNode(doc, "s1", "t1", 0)).toBe(doc);
    expect(moveNode(doc, "zz", null, 0)).toBe(doc);
    const into = moveNode(doc, "h1", "s2", 0);
    expect(findNode(into, "s2").children[0].id).toBe("h1");
    const dup = duplicateNode(doc, "h1");
    expect(findNode(dup.doc, "c1").children[1].id).toBe(dup.id);
    expect(duplicateNode(doc, "sa").id).toBeNull();
  });
  test("containment rules and wrapping", () => {
    expect(canContain(null, { type: "section" })).toBe(true);
    expect(canContain(null, { type: "text" })).toBe(false);
    expect(canContain({ type: "container" }, { type: "text" })).toBe(true);
    expect(canContain({ type: "text" }, { type: "text" })).toBe(false);
    expect(canContain({ type: "container" }, { type: "section" })).toBe(false);
    const wrapped = asSection({ id: "x", type: "text", props: {} });
    expect(wrapped.type).toBe("section");
    expect(wrapped.children[0].children[0].id).toBe("x");
    expect(asSection({ id: "s", type: "section", props: {} }).id).toBe("s");
  });
  test("symbols: make, detach, prune", () => {
    const doc = sampleDoc();
    const made = makeSymbol(doc, "c1", "Hero card");
    expect(made.symbolId).toBeTruthy();
    expect(findNode(made.doc, "s1").children[0].type).toBe("symbol");
    expect(made.doc.symbols[made.symbolId].node.id).toBe("c1");
    expect(makeSymbol(doc, "sat", "x").symbolId).toBeNull();
    const inst = findNode(made.doc, "s1").children[0];
    const detached = detachSymbol(made.doc, inst.id);
    expect(findNode(detached, "s1").children[0].type).toBe("container");
    const pruned = pruneSymbols(detached);
    expect(Object.keys(pruned.symbols)).toEqual([]);
    expect(pruneSymbols(made.doc)).not.toBe(made.doc);
    expect(detachSymbol(doc, "t1")).toBe(doc);
  });
  test("ids", () => {
    expect(newId()).toMatch(/^n_[a-z0-9]{8}$/);
    const copy = reid({ id: "a", type: "container", props: {}, anchor: "x", children: [{ id: "b", type: "text", props: {} }] });
    expect(copy.id).not.toBe("a");
    expect(copy.anchor).toBeUndefined();
    expect(copy.children[0].id).not.toBe("b");
    const ids = [];
    walk(sampleDoc(), (n) => ids.push(n.id));
    expect(ids).toContain("sat");
  });
});

describe("diff (publish dialog, Atlas review)", () => {
  test("added, removed, changed, moved and theme", () => {
    const a = sampleDoc();
    let b = setProps(a, "h1", { text: "New" });
    b = removeNode(b, "t1");
    b = insertNode(b, { id: "btn", type: "button", props: { label: "Go" } }, "c1");
    b = moveNode(b, "s2", null, 0);
    b = { ...b, theme: { ...b.theme, radius: "none" } };
    const d = diffDocs(a, b);
    const kinds = Object.fromEntries(d.changes.map((c) => [c.id, c.kind]));
    expect(kinds).toEqual({ h1: "changed", btn: "added", t1: "removed", s1: "moved", s2: "moved" });
    expect(d.changes.find((c) => c.id === "h1").parts).toEqual(["content"]);
    expect(d.theme).toBe(true);
    expect(d.ids.has("btn")).toBe(true);
    expect(isEmptyDiff(diffDocs(a, a))).toBe(true);
    expect(diffDocs(null, a).changes.map((c) => c.id)).toEqual(["s1", "s2", "sa"]);
    expect(labelOf({ id: "x", type: "divider", props: {} })).toBe("divider");
    const moved = diffDocs(a, moveNode(a, "t1", "s2", 0));
    expect(moved.changes[0].kind).toBe("moved");
  });
});

describe("builder history", () => {
  test("commit, coalesce, undo, redo", () => {
    const d0 = emptyDoc();
    let s = initialState(d0);
    const d1 = { ...d0, page: { title: "a" } };
    const d2 = { ...d0, page: { title: "ab" } };
    s = reducer(s, { type: "commit", doc: d1, key: "k" });
    s = reducer(s, { type: "commit", doc: d2, key: "k" });
    expect(s.past.length).toBe(1);
    s = reducer(s, { type: "undo" });
    expect(s.doc).toBe(d0);
    s = reducer(s, { type: "redo" });
    expect(s.doc).toBe(d2);
    expect(reducer(s, { type: "redo" })).toBe(s);
    s = reducer(s, { type: "select", id: "x" });
    expect(s.selectedId).toBe("x");
    s = reducer(s, { type: "breakpoint", value: "mobile" });
    expect(s.breakpoint).toBe("mobile");
    s = reducer(s, { type: "reset", doc: d0, keepHistory: true });
    expect(s.doc).toBe(d0);
    expect(reducer(initialState(d0), { type: "undo" }).doc).toBe(d0);
  });
});

test("the icon set matches the API's", () => {
  const py = readFileSync(new URL("../../api/src/services/landing/schema.py", import.meta.url), "utf8");
  const block = py.slice(py.indexOf("ICONS = ("), py.indexOf(")\nIconName"));
  const apiIcons = [...block.matchAll(/"([A-Za-z]+)"/g)].map((m) => m[1]).sort();
  const ts = readFileSync(new URL("../components/LandingPages/render/icons.tsx", import.meta.url), "utf8");
  const line = ts.split("\n").find((l) => l.startsWith("export const LANDING_ICONS"));
  const webIcons = [...line.matchAll(/([A-Za-z]+)(?::\s*[A-Za-z]+)?[,\s}]/g)].map((m) => m[1]).filter((n) => !["export", "const", "LANDING_ICONS", "Record", "string", "Icon"].includes(n)).sort();
  expect(webIcons).toEqual(apiIcons);
});

test("the font list matches the API's", async () => {
  const { ALL_FONTS, googleFontsUrl, FONT_PAIRINGS } = await import("../components/LandingPages/model/fonts.ts");
  const py = readFileSync(new URL("../../api/src/services/landing/schema.py", import.meta.url), "utf8");
  const block = py.slice(py.indexOf("FONTS = ("), py.indexOf(")\nFontName"));
  const apiFonts = [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();
  expect([...ALL_FONTS].sort()).toEqual(apiFonts);
  for (const p of FONT_PAIRINGS) expect(ALL_FONTS.includes(p.heading) && ALL_FONTS.includes(p.body)).toBe(true);
  // Previews download only the letters asked for, never weights.
  const url = googleFontsUrl(["Inter", "System Sans", "Lora"], { text: "Ab" });
  expect(url).toBe("https://fonts.googleapis.com/css2?family=Inter&family=Lora&text=Ab&display=swap");
  expect(googleFontsUrl(["System Sans", "brand", ""])).toBeNull();
});

test("page backgrounds and color scheme", async () => {
  const { pageBackground, pageScheme } = await import("../components/LandingPages/model/style.ts");
  expect(pageBackground(undefined)).toEqual({ backgroundColor: "var(--lhp-background)" });
  expect(pageBackground({ background: "transparent", backgroundGradient: { from: "#000000", to: "#ffffff", angle: 90 } }).backgroundImage).toBe("linear-gradient(90deg,#000000,#ffffff)");
  const img = pageBackground({ backgroundImage: "https://x.io/a.png", backgroundGradient: { from: "#000", to: "#fff", via: "#f00" } });
  expect(img.backgroundImage).toBe('linear-gradient(180deg,#000,#f00,#fff),url("https://x.io/a.png")');
  expect(img.backgroundSize).toBe("cover");
  expect(pageBackground({ backgroundImage: "javascript:x" }).backgroundImage).toBeUndefined();
  expect(pageScheme({ page: {}, theme: { colors: { background: "#ffffff" } } })).toBe("light");
  expect(pageScheme({ page: {}, theme: { colors: { background: "#0b1120" } } })).toBe("dark");
  expect(pageScheme({ page: { background: "#111111" }, theme: { colors: { background: "#ffffff" } } })).toBe("dark");
  expect(pageScheme({ page: { background: "transparent" }, theme: { colors: { background: "brand" } } })).toBe("light");
});
