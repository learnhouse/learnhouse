// Editor Plus block upgrades (EDITOR_PLUS_SPEC.md, section D): code block line
// options, inline math, text alignment, button styles and the button group,
// toggle and callout looks, image frames. Checked against the real node
// definitions and against fixtures holding both new and old content.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";

const domWindow = new Window({ url: "http://localhost/" });
for (const key of [
  "document", "navigator", "HTMLElement", "Element", "Node", "Text", "DocumentFragment", "MutationObserver", "Range",
  "Selection", "DOMParser", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "CustomEvent", "Event",
  "KeyboardEvent", "MouseEvent", "InputEvent", "NodeFilter", "DOMException", "localStorage", "sessionStorage",
]) {
  if (domWindow[key] !== undefined && globalThis[key] === undefined) globalThis[key] = domWindow[key];
}
globalThis.window ??= domWindow;

const { Editor, getSchema } = await import("@tiptap/core");
const { default: StarterKit } = await import("@tiptap/starter-kit");
const React = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const A = await import("../components/Objects/Editor/Blocks/schema/blockAttrs.ts");
const C = await import("../components/Objects/Editor/Blocks/extensions/codeBlockModel.ts");
const U = await import("../components/Objects/Editor/Extensions/Plus/upgrades/upgradesModel.ts");
const B = await import("../components/Objects/Editor/Extensions/Buttons/buttonStyles.ts");
const T = await import("../components/Objects/Editor/Extensions/Callout/calloutStyles.ts");
const Q = await import("../components/Objects/Editor/Extensions/Quiz/quizModel.ts");
const { createUpgradeNodes } = await import("../components/Objects/Editor/Extensions/Plus/upgrades/upgradeNodes.ts");
const { upgradesSlashItems } = await import("../components/Objects/Editor/Extensions/Plus/upgrades/slashItems.tsx");
const Blocks = await import("../components/Objects/Editor/Blocks/extensions");
const { StaticCodeBlock } = await import("../components/Objects/Editor/Blocks/extensions/CodeBlockStatic.tsx");
const { toggleFrameClass } = await import("../components/Objects/Editor/Blocks/extensions/ToggleBlock.tsx");
const { lowlight } = await import("../components/Objects/Editor/editorLowlight.ts");
const ext = (path) => import(`../components/Objects/Editor/Extensions/${path}`).then((m) => m.default);
const [Callout, ImageBlock, QuizBlock, Buttons] = await Promise.all(["Callout/Callout", "Image/ImageBlock", "Quiz/QuizBlock", "Buttons/Buttons"].map(ext));

const extensions = [
  StarterKit.configure({ codeBlock: false, link: false, undoRedo: false }),
  Blocks.LHCodeBlock.configure({ lowlight }),
  Blocks.ToggleBlock,
  Callout,
  ImageBlock,
  QuizBlock,
  Buttons,
  ...createUpgradeNodes({ mode: "editor" }),
];
const schema = getSchema(extensions);
const fixtures = JSON.parse(readFileSync(new URL("./fixtures/editor-blocks/block-upgrades.json", import.meta.url), "utf8"));
const byName = Object.fromEntries(fixtures.map((f) => [f.name, f.content]));

const walk = (node, fn, path = "doc") => {
  fn(node, path);
  (node.content || []).forEach((c, i) => walk(c, fn, `${path}/${c.type}[${i}]`));
};
const nodesOf = (doc, type) => {
  const out = [];
  walk(doc, (n) => n.type === type && out.push(n));
  return out;
};

function makeEditor(content) {
  return new Editor({ element: document.createElement("div"), extensions, content });
}

// ─── code block ────────────────────────────────────────────────────────────

describe("code block: highlighted lines", () => {
  test('"2,4-6" reads as lines 2, 4, 5 and 6', () => {
    expect([...C.parseHighlightLines("2,4-6")]).toEqual([2, 4, 5, 6]);
    expect([...C.parseHighlightLines(" 1 , 3 – 4 ")].sort((a, b) => a - b)).toEqual([1, 3, 4]);
    expect([...C.parseHighlightLines("6-4")]).toEqual([4, 5, 6]);
    expect([...C.parseHighlightLines("3;7")]).toEqual([3, 7]);
    expect([...C.parseHighlightLines(5)]).toEqual([5]);
  });

  test("junk, zero and negatives are skipped; nothing becomes an empty set", () => {
    expect(C.parseHighlightLines("abc,0,-3,2x").size).toBe(0);
    expect(C.parseHighlightLines(null).size).toBe(0);
    expect(C.parseHighlightLines(undefined).size).toBe(0);
    expect(C.parseHighlightLines("").size).toBe(0);
    expect(C.parseHighlightLines({}).size).toBe(0);
    expect([...C.parseHighlightLines("0-2")]).toEqual([1, 2]);
  });

  test("ranges are capped by the code length and by a maximum span", () => {
    expect([...C.parseHighlightLines("2-100", 4)]).toEqual([2, 3, 4]);
    expect(C.parseHighlightLines("1-99999999").size).toBe(C.MAX_HIGHLIGHT_SPAN);
  });

  test("stored form is sorted and merged", () => {
    expect(C.formatHighlightLines([6, 4, 5, 2, 2])).toBe("2,4-6");
    expect(C.formatHighlightLines([1, 2, 3, 10])).toBe("1-3,10");
    expect(C.formatHighlightLines([])).toBeNull();
    expect(C.normalizeHighlightLines("4-6, 2, 5")).toBe("2,4-6");
    expect(C.normalizeHighlightLines("nope")).toBeNull();
  });
});

describe("code block: line markup", () => {
  test("no options means no per-line markup and no <pre> attributes (old blocks unchanged)", () => {
    expect(C.codeLines("a\nb", { language: "js" })).toEqual([]);
    expect(C.codePreAttrs({ language: "js", filename: null }, "a\nb")).toEqual({});
    expect(C.codePreAttrs({ showLineNumbers: false, highlightLines: null, wrap: false }, "a")).toEqual({});
  });

  test("lines carry their number, offset and highlight", () => {
    expect(C.codeLines("ab\n\ncd", { showLineNumbers: true, highlightLines: "3" })).toEqual([
      { n: 1, offset: 0, highlighted: false },
      { n: 2, offset: 3, highlighted: false },
      { n: 3, offset: 4, highlighted: true },
    ]);
    // Highlight alone still needs the line markers.
    expect(C.codeLines("x", { highlightLines: "1" })).toEqual([{ n: 1, offset: 0, highlighted: true }]);
  });

  test("<pre> attributes drive the CSS", () => {
    const text = Array.from({ length: 120 }, (_, i) => `line ${i}`).join("\n");
    expect(C.codePreAttrs({ showLineNumbers: true, highlightLines: "5-3", wrap: true }, text)).toEqual({
      "data-line-numbers": "true",
      style: "--lh-code-gutter:3ch",
      "data-highlight-lines": "3-5",
      "data-wrap": "true",
    });
    expect(C.gutterDigits(0)).toBe(2);
    expect(C.gutterDigits(9)).toBe(2);
    expect(C.gutterDigits(1000)).toBe(4);
  });

  test("a highlighted tree splits into lines without losing text or classes", () => {
    const tree = lowlight.highlight("javascript", "const a = 1\n/* two\nlines */\nlet b");
    const lines = C.hastToLines(tree, "");
    expect(lines.length).toBe(4);
    expect(lines.map((l) => l.map((t) => t.text).join(""))).toEqual(["const a = 1", "/* two", "lines */", "let b"]);
    expect(lines[0][0]).toEqual({ text: "const", classes: ["hljs-keyword"] });
    // A comment spanning two lines keeps its class on both halves.
    expect(lines[1][0].classes).toContain("hljs-comment");
    expect(lines[2][0].classes).toContain("hljs-comment");
    expect(C.hastToLines(null, "a\nb")).toEqual([[{ text: "a", classes: [] }], [{ text: "b", classes: [] }]]);
  });

  test("the renderHTML keeps the options on <pre> for copy/paste and exports", () => {
    const editor = makeEditor({ type: "doc", content: byName["every-block-upgrade"].content.filter((n) => n.type === "codeBlock") });
    const html = editor.getHTML();
    expect(html).toContain('data-line-numbers="true"');
    expect(html).toContain('data-highlight-lines="2,4-5"');
    expect(html).toContain('data-wrap="true"');
    expect(html).toContain('data-filename="physics.py"');
    const again = makeEditor(html);
    expect(again.getJSON().content.map((n) => n.attrs)).toEqual(editor.getJSON().content.map((n) => n.attrs));
    editor.destroy();
    again.destroy();
  });

  test("old code blocks give exactly the old HTML", () => {
    const editor = makeEditor({ type: "doc", content: [{ type: "codeBlock", attrs: { language: "javascript" }, content: [{ type: "text", text: "x" }] }] });
    expect(editor.getHTML()).toBe('<pre><code class="language-javascript">x</code></pre>');
    editor.destroy();
  });
});

describe("code block: static (learner) rendering", () => {
  const render = (json) => renderToStaticMarkup(React.createElement(StaticCodeBlock, { node: schema.nodeFromJSON(json) }));

  test("an old block renders the same <pre><code> plus the copy button", () => {
    const html = render({ type: "codeBlock", attrs: { language: "javascript" }, content: [{ type: "text", text: "const a = 1" }] });
    expect(html).toContain('<pre><code class="language-javascript"><span class="hljs-keyword">const</span> a = <span class="hljs-number">1</span></code></pre>');
    expect(html).not.toContain("lh-code-line-start");
    expect(html).toContain("<button");
  });

  test("line numbers and highlighted lines use the same marker as the editor widget", () => {
    const html = render({ type: "codeBlock", attrs: { language: "python", filename: "a.py", showLineNumbers: true, highlightLines: "2" }, content: [{ type: "text", text: "a = 1\nb = 2" }] });
    expect(html).toContain('data-line-numbers="true"');
    expect(html).toContain("--lh-code-gutter:2ch");
    expect(html).toContain('data-highlight-lines="2"');
    expect(html).toContain('<span class="lh-code-line-start" aria-hidden="true" data-ln="1"></span>');
    expect(html).toContain('<span class="lh-code-line-start" aria-hidden="true" data-ln="2" data-hl="true"></span>');
    expect(html).toContain("a.py");
    // The text itself is untouched (numbers come from CSS, so copy stays clean).
    const text = html.replace(/<[^>]+>/g, "").replace(/Copy|editor\.[\w.]+/g, "");
    expect(text).toContain("a = 1\nb = 2");
  });
});

describe("code block: editor decorations", () => {
  const markers = (editor) => {
    const plugin = editor.state.plugins.find((pl) => pl.key.startsWith("lhCodeLines"));
    return plugin.getState(editor.state).find().map((d) => d.type.toDOM(editor.view, () => d.from));
  };

  test("one marker widget per line, only when an option is on", () => {
    const content = { type: "doc", content: [
      { type: "codeBlock", attrs: { language: "js", showLineNumbers: true, highlightLines: "2" }, content: [{ type: "text", text: "a\nb\nc" }] },
      { type: "codeBlock", attrs: { language: "js" }, content: [{ type: "text", text: "plain\ncode" }] },
    ] };
    const editor = makeEditor(content);
    const els = markers(editor);
    expect(els.length).toBe(3);
    expect(els.map((m) => m.className)).toEqual(["lh-code-line-start", "lh-code-line-start", "lh-code-line-start"]);
    expect(els.map((m) => m.getAttribute("data-ln"))).toEqual(["1", "2", "3"]);
    expect(els.map((m) => m.getAttribute("data-hl"))).toEqual([null, "true", null]);
    expect(els[0].getAttribute("aria-hidden")).toBe("true");
    // Turning the options off removes the markers.
    editor.commands.command(({ tr }) => {
      tr.setNodeMarkup(0, undefined, { ...editor.state.doc.child(0).attrs, showLineNumbers: false, highlightLines: null });
      return true;
    });
    expect(markers(editor).length).toBe(0);
    editor.destroy();
  });
});

// ─── inline math ───────────────────────────────────────────────────────────

describe("inline math: $…$ input", () => {
  test("formulas match", () => {
    expect(U.matchInlineMath("so $x^2$")).toEqual({ latex: "x^2", lead: " ", length: 5 });
    expect(U.matchInlineMath("$\\frac{a}{b}$")?.latex).toBe("\\frac{a}{b}");
    expect(U.matchInlineMath("($a+b$")?.latex).toBe("a+b");
    expect(U.matchInlineMath("$x$")?.latex).toBe("x");
    expect(U.matchInlineMath("speed $v = 3t$")?.latex).toBe("v = 3t");
  });

  test("prices and other dollars stay text", () => {
    for (const text of [
      "$5 and $", // "$5 and $10": the inside ends with a space
      "costs $5 and $10$", // the last pair is only digits
      "$12$",
      "$1,000.50$",
      "US$5 x$", // opening $ right after a letter
      "$ x$", // space after the opening $
      "$x $", // space before the closing $
      "$$x$",
      "\\$x$",
      "a$b$",
    ]) {
      expect([text, U.matchInlineMath(text)]).toEqual([text, null]);
    }
  });

  test("typing the closing $ turns the text into an inline formula", () => {
    const editor = makeEditor("<p>Energy is $E=mc^2</p>");
    const end = editor.state.doc.content.size - 1;
    editor.commands.setTextSelection(end);
    const handled = editor.view.someProp("handleTextInput", (f) => f(editor.view, end, end, "$"));
    expect(handled).toBe(true);
    const para = editor.getJSON().content[0];
    expect(para.content).toEqual([{ type: "text", text: "Energy is " }, { type: "inlineMath", attrs: { latex: "E=mc^2" } }]);
    editor.destroy();
  });

  test("typing a price does not", () => {
    const editor = makeEditor("<p>It costs $5 and $10</p>");
    const end = editor.state.doc.content.size - 1;
    editor.commands.setTextSelection(end);
    const handled = editor.view.someProp("handleTextInput", (f) => f(editor.view, end, end, "$"));
    expect(!!handled).toBe(false);
    editor.destroy();
  });

  test("HTML keeps the LaTeX readable and parses back; plain text gets $…$", () => {
    const editor = makeEditor({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Area " }, { type: "inlineMath", attrs: { latex: "\\pi r^2" } }] }] });
    const html = editor.getHTML();
    expect(html).toBe('<p>Area <span data-latex="\\pi r^2" data-type="inline-math">\\pi r^2</span></p>');
    expect(editor.getText()).toBe("Area $\\pi r^2$");
    const again = makeEditor(html);
    expect(again.getJSON()).toEqual(editor.getJSON());
    expect(again.commands.insertInlineMath("  ")).toBe(false);
    editor.destroy();
    again.destroy();
  });

  test("a selection becomes LaTeX without its dollars", () => {
    expect(U.latexFromSelection("  $x^2$ ")).toBe("x^2");
    expect(U.latexFromSelection("a+b")).toBe("a+b");
    expect(U.latexFromSelection("$$")).toBe("");
    expect(U.latexFromSelection("x".repeat(2000)).length).toBe(1000);
  });
});

// ─── text alignment ────────────────────────────────────────────────────────

describe("text alignment", () => {
  test("null writes no style or attribute, so stored HTML is unchanged", () => {
    const editor = makeEditor("<h2>Title</h2><p>Body</p>");
    expect(editor.getHTML()).toBe("<h2>Title</h2><p>Body</p>");
    expect(editor.getJSON().content.map((n) => n.attrs.textAlign)).toEqual([null, null]);
    editor.destroy();
  });

  test("set, read back and cleared", () => {
    const editor = makeEditor("<p>Body</p>");
    editor.commands.setTextSelection(2);
    expect(editor.commands.setTextAlign("center")).toBe(true);
    expect(editor.getHTML()).toBe('<p style="text-align: center;">Body</p>');
    expect(editor.commands.setTextAlign("end")).toBe(true);
    expect(editor.getJSON().content[0].attrs.textAlign).toBe("end");
    // left/right are not stored values (start/end follow the writing direction).
    expect(editor.commands.setTextAlign("left")).toBe(false);
    editor.commands.unsetTextAlign();
    expect(editor.getHTML()).toBe("<p>Body</p>");
    editor.destroy();
  });

  test("pasted left/right become start/end; unknown values are dropped", () => {
    const editor = makeEditor('<p style="text-align: right">R</p><p style="text-align: left">L</p><p style="text-align: justify">J</p><p style="text-align: -webkit-center">W</p>');
    expect(editor.getJSON().content.map((n) => n.attrs.textAlign)).toEqual(["end", "start", "justify", null]);
    editor.destroy();
    expect(A.readTextAlign("CENTER")).toBe("center");
    expect(A.readTextAlign(undefined)).toBeNull();
  });
});

// ─── buttons ───────────────────────────────────────────────────────────────

const OLD_COLOR = {
  sky: "bg-sky-500 hover:bg-sky-600", green: "bg-green-500 hover:bg-green-600", yellow: "bg-yellow-500 hover:bg-yellow-600",
  red: "bg-red-500 hover:bg-red-600", purple: "bg-purple-500 hover:bg-purple-600", teal: "bg-teal-500 hover:bg-teal-600",
  amber: "bg-amber-500 hover:bg-amber-600", indigo: "bg-indigo-500 hover:bg-indigo-600", neutral: "bg-neutral-500 hover:bg-neutral-600",
  blue: "bg-blue-500 hover:bg-blue-600",
};
const classSet = (s) => new Set(s.split(/\s+/).filter(Boolean));

describe("button variants and sizes", () => {
  test("a button without variant/size is the old solid medium button, for every color", () => {
    for (const color of [...B.BUTTON_COLORS, "unknown", undefined]) {
      const face = B.buttonFaceClasses(color, A.buttonVariantOf({}), A.buttonSizeOf({}));
      // The old learner button: py-2 px-4 rounded-xl text-white + getButtonColor(color).
      expect(classSet(face)).toEqual(classSet(`py-2 px-4 rounded-xl text-white ${OLD_COLOR[color] ?? OLD_COLOR.blue}`));
      expect(B.solidColorClasses(color)).toBe(OLD_COLOR[color] ?? OLD_COLOR.blue);
    }
  });

  test("variants and sizes resolve, unknown values fall back", () => {
    expect(A.buttonVariantOf({ variant: "outline" })).toBe("outline");
    expect(A.buttonVariantOf({ variant: "neon" })).toBe("solid");
    expect(A.buttonSizeOf({ size: "lg" })).toBe("lg");
    expect(A.buttonSizeOf({ size: 3 })).toBe("md");
    const all = new Set();
    for (const v of A.BUTTON_VARIANTS) for (const s of A.BUTTON_SIZES) all.add(B.buttonFaceClasses("teal", v, s));
    expect(all.size).toBe(A.BUTTON_VARIANTS.length * A.BUTTON_SIZES.length);
    expect(B.buttonFaceClasses("red", "outline", "md")).toContain("ring-red-500");
    expect(B.buttonFaceClasses("red", "soft", "sm")).toContain("bg-red-100");
    expect(B.buttonFaceClasses("red", "link", "lg")).toContain("hover:underline");
    expect(B.buttonFaceClasses("red", "link", "lg")).not.toContain("text-white");
  });

  test("default attrs write nothing to HTML", () => {
    expect(A.BUTTON_EXTRA_ATTRS.variant.renderHTML({ variant: null })).toEqual({});
    expect(A.BUTTON_EXTRA_ATTRS.size.renderHTML({ size: "bogus" })).toEqual({});
    expect(A.BUTTON_EXTRA_ATTRS.variant.renderHTML({ variant: "soft" })).toEqual({ "data-variant": "soft" });
  });
});

describe("button group", () => {
  test("holds buttons only, keeps them in HTML for older clients", () => {
    expect(schema.nodes.buttonGroup.spec.content).toBe("button+");
    const editor = makeEditor({ type: "doc", content: nodesOf(byName["every-block-upgrade"], "buttonGroup") });
    const html = editor.getHTML();
    expect(html.startsWith('<div data-alignment="center" data-type="button-group"><button-block')).toBe(true);
    expect((html.match(/<button-block/g) || []).length).toBe(3);
    const again = makeEditor(html);
    expect(again.getJSON()).toEqual(editor.getJSON());
    editor.destroy();
    again.destroy();
  });

  test("an empty group is not valid content", () => {
    expect(() => schema.nodeFromJSON({ type: "buttonGroup", content: [] }).check()).toThrow();
  });

  test("alignment and the starter", () => {
    expect(U.buttonGroupAlignmentOf({ alignment: "right" })).toBe("right");
    expect(U.buttonGroupAlignmentOf({ alignment: "middle" })).toBe("left");
    expect(U.buttonGroupJustify("center")).toBe("center");
    expect(U.buttonGroupJustify("right")).toBe("flex-end");
    expect(U.buttonGroupJustify("left")).toBe("flex-start");
    const starter = U.starterButtonGroup({ primary: "Go", secondary: "More" });
    expect(() => schema.nodeFromJSON(starter).check()).not.toThrow();
    expect(starter.content.map((b) => b.content[0].text)).toEqual(["Go", "More"]);
    expect(U.newGroupButton("").content).toEqual([]);
  });

  test("slash items for the button group and inline math", () => {
    expect(upgradesSlashItems.map((i) => i.id)).toEqual(["buttonGroup", "inlineMath"]);
    for (const item of upgradesSlashItems) {
      expect(item.titleKey.startsWith("editor.slash_menu.items.")).toBe(true);
      expect(item.descriptionKey.startsWith("editor.slash_menu.items.")).toBe(true);
    }
  });
});

// ─── toggle, callout, image ────────────────────────────────────────────────

describe("toggle variants", () => {
  test("null is the original toggle", () => {
    expect(A.toggleVariantOf({})).toBe("default");
    expect(A.toggleIconOf({ icon: "arrow" })).toBe("chevron");
    expect(toggleFrameClass("default", true)).toBe("bg-neutral-50/70 ring-1 ring-inset ring-black/[0.05]");
    expect(toggleFrameClass("default", false)).toBe("bg-neutral-50 ring-1 ring-inset ring-black/[0.04]");
    expect(toggleFrameClass("bordered", false)).not.toBe(toggleFrameClass("filled", false));
  });

  test("toggleBlock keeps its name, content and old attrs (the accordion builds on it)", () => {
    expect(schema.nodes.toggleBlock.spec.content).toBe("block+");
    expect(Object.keys(schema.nodes.toggleBlock.spec.attrs).sort()).toEqual(["defaultOpen", "icon", "summary", "variant"]);
    const editor = makeEditor({ type: "doc", content: nodesOf(byName["old-data-untouched"], "toggleBlock") });
    expect(editor.getHTML()).toBe('<div data-summary="Old toggle" data-open="true" data-type="toggle-block"><p>Inside.</p></div>');
    editor.destroy();
  });
});

describe("callout upgrades", () => {
  test("tones and types", () => {
    expect(T.calloutToneOf("teal")).toBe("teal");
    expect(T.calloutToneOf("chartreuse")).toBeNull();
    expect(T.calloutToneOf(undefined)).toBeNull();
    expect(T.CALLOUT_TYPE_IDS.slice(0, 5)).toEqual([...T.LEGACY_CALLOUT_TYPES]);
    for (const tone of Object.values(T.CALLOUT_TONES)) expect(Object.keys(tone).sort()).toEqual(["bg", "iconColor", "ring", "swatch", "text"]);
  });

  test("every value the editor can write to `type` is a legacy type (older renderers crash on others)", () => {
    for (const style of T.CALLOUT_TYPE_IDS) {
      const attrs = T.calloutAttrsFor(style);
      expect([style, T.LEGACY_CALLOUT_TYPES.includes(attrs.type)]).toEqual([style, true]);
      // …and new code still shows the picked look.
      expect(T.calloutStyleOf(attrs)).toBe(style);
    }
    expect(T.calloutAttrsFor("note")).toEqual({ type: "info", kind: "note" });
    expect(T.calloutAttrsFor("question")).toEqual({ type: "info", kind: "question" });
    expect(T.calloutAttrsFor("example")).toEqual({ type: "tip", kind: "example" });
    expect(T.calloutAttrsFor("quote")).toEqual({ type: "info", kind: "quote" });
    expect(T.calloutAttrsFor("warning")).toEqual({ type: "warning", kind: null });
    expect(T.calloutAttrsFor("bogus")).toEqual({ type: "info", kind: null });
    // The component writes through calloutAttrsFor only.
    const src = readFileSync(new URL("../components/Objects/Editor/Extensions/Callout/CalloutComponent.tsx", import.meta.url), "utf8");
    expect(src).not.toMatch(/updateAttributes\(\{\s*type:/);
    expect(src.match(/calloutAttrsFor\(newType\)/g)?.length).toBe(2);
  });

  test("kind is read first, then type; unknown values fall back to info", () => {
    expect(T.calloutStyleOf({ type: "tip", kind: "example" })).toBe("example");
    expect(T.calloutStyleOf({ type: "warning", kind: null })).toBe("warning");
    expect(T.calloutStyleOf({ type: "warning", kind: "neon" })).toBe("warning");
    expect(T.calloutStyleOf({ type: "quote" })).toBe("quote");
    expect(T.calloutStyleOf({ type: "neon" })).toBe("info");
    expect(T.calloutStyleOf(undefined)).toBe("info");
    expect(A.CALLOUT_EXTRA_ATTRS.kind.renderHTML({ kind: null })).toEqual({});
    expect(A.CALLOUT_EXTRA_ATTRS.kind.renderHTML({ kind: "quote" })).toEqual({ "data-kind": "quote" });
  });

  test("fixtures never store a new kind in `type`", () => {
    for (const f of fixtures) for (const n of nodesOf(f.content, "callout")) expect(T.LEGACY_CALLOUT_TYPES).toContain(n.attrs.type);
  });

  test("new attrs on other blocks are separate attrs older renderers ignore", () => {
    // Button variant/size, image frame, toggle variant/icon and the code options are
    // new attrs, never new values of an attr an older renderer switches on.
    for (const k of ["variant", "size"]) expect(k in A.BUTTON_EXTRA_ATTRS).toBe(true);
    expect(schema.nodes.button.spec.attrs.color.default).toBe("blue");
    expect(schema.nodes.button.spec.attrs.alignment.default).toBe("left");
    expect("frame" in A.IMAGE_EXTRA_ATTRS).toBe(true);
    expect(schema.nodes.blockImage.spec.attrs.alignment.default).toBe("center");
  });

  test("old callouts write the same HTML; defaults emit no attributes", () => {
    const editor = makeEditor({ type: "doc", content: nodesOf(byName["old-data-untouched"], "callout") });
    expect(editor.getHTML()).toBe(
      '<callout data-callout-type="warning" data-dismissible="true"><p>An old callout.</p></callout><callout data-callout-type="tip" data-icon="rocket"><p>An old callout with an icon.</p></callout>',
    );
    editor.destroy();
  });

  test("new attrs survive HTML", () => {
    const editor = makeEditor({ type: "doc", content: nodesOf(byName["every-block-upgrade"], "callout") });
    const again = makeEditor(editor.getHTML());
    expect(again.getJSON()).toEqual(editor.getJSON());
    expect(editor.getHTML()).toContain('data-collapsible="true" data-default-open="false"');
    editor.destroy();
    again.destroy();
  });
});

describe("image frame", () => {
  test("none is the old image; every frame has classes", () => {
    expect(A.imageFrameOf({})).toBe("none");
    expect(A.imageFrameOf({ frame: "neon" })).toBe("none");
    expect(A.imageFrameClasses("none")).toEqual({ box: "", img: "rounded-lg max-md:rounded-xl" });
    for (const f of A.IMAGE_FRAMES.slice(1)) expect(A.imageFrameClasses(f)).not.toEqual(A.imageFrameClasses("none"));
    expect(A.IMAGE_EXTRA_ATTRS.frame.renderHTML({ frame: null })).toEqual({});
    expect(A.resolveImageView({ frame: "polaroid" }).frame).toBe("polaroid");
  });
});

// ─── fixtures through the real schema ──────────────────────────────────────

describe("block upgrade fixtures", () => {
  for (const fixture of fixtures) {
    test(`${fixture.name} loads through the real schema without losing anything`, () => {
      const doc = schema.nodeFromJSON(fixture.content);
      expect(() => doc.check()).not.toThrow();
      const out = doc.toJSON();
      const before = [];
      const after = [];
      walk(fixture.content, (n, p) => before.push([p, n]));
      walk(out, (n, p) => after.push([p, n]));
      expect(after.map(([p]) => p)).toEqual(before.map(([p]) => p));
      after.forEach(([p, n], i) => {
        for (const [k, v] of Object.entries(before[i][1].attrs || {})) expect([p, k, n.attrs?.[k]]).toEqual([p, k, v]);
        // Attrs the stored node didn't have sit at their "as before" defaults.
        for (const [k, v] of Object.entries(A.NEW_ATTR_DEFAULTS[n.type] || {})) {
          if (!(k in (before[i][1].attrs || {}))) expect([p, k, n.attrs?.[k]]).toEqual([p, k, v]);
        }
      });
      expect(schema.nodeFromJSON(out).toJSON()).toEqual(out);
    });
  }

  test("the old-data fixture keeps every block at its old look", () => {
    const doc = schema.nodeFromJSON(byName["old-data-untouched"]).toJSON();
    for (const n of nodesOf(doc, "paragraph")) expect(n.attrs.textAlign).toBeNull();
    for (const n of nodesOf(doc, "callout")) expect(n.attrs).toMatchObject({ title: "", collapsible: false, tone: null });
    for (const n of nodesOf(doc, "codeBlock")) expect(C.codePreAttrs(n.attrs, "")).toEqual({});
    for (const n of nodesOf(doc, "toggleBlock")) expect([A.toggleVariantOf(n.attrs), A.toggleIconOf(n.attrs)]).toEqual(["default", "chevron"]);
    for (const n of nodesOf(doc, "button")) expect([A.buttonVariantOf(n.attrs), A.buttonSizeOf(n.attrs)]).toEqual(["solid", "md"]);
    for (const n of nodesOf(doc, "blockImage")) expect(A.resolveImageView(n.attrs).frame).toBe("none");
    const [quiz] = nodesOf(doc, "blockQuiz");
    const qs = Q.normalizeQuestions(quiz.attrs.questions);
    expect(qs.map((q) => Q.questionKind(q))).toEqual(["multiple_choice", "multiple_choice"]);
    expect(Q.responseTypeOf(qs[0])).toBe("multiple");
    expect(Q.normalizeSettings(quiz.attrs.settings)).toEqual(Q.DEFAULT_QUIZ_SETTINGS);
  });

  test("the new quiz types in the fixture grade as authored", () => {
    const [quiz] = nodesOf(byName["every-block-upgrade"], "blockQuiz");
    const qs = Q.normalizeQuestions(quiz.attrs.questions);
    const settings = Q.normalizeSettings(quiz.attrs.settings);
    expect(settings).toMatchObject({ passMark: 75, showExplanations: false });
    expect(qs.map((q) => Q.questionKind(q))).toEqual(["multiple_choice", "true_false", "short_answer", "short_answer", "numeric"]);
    const sel = { q1: ["a2"], q2: ["f2"], q3: [" Newton "], q4: ["isaac newton"], q5: ["9,8"] };
    expect(Q.gradeQuiz(qs, sel, settings.passMark)).toMatchObject({ correct: 5, graded: 5, percent: 100, passed: true });
    expect(Q.gradeQuiz(qs, { ...sel, q5: ["10"], q3: ["kg"] }, settings.passMark)).toMatchObject({ correct: 3, percent: 60, passed: false });
  });
});
