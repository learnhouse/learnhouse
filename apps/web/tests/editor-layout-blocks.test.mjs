// Editor Plus layout blocks (EDITOR_PLUS_SPEC.md, section B): tabs, columns,
// accordion, timeline, table of contents, key takeaways and the checklist.
// Stored documents round-trip through JSON and HTML, renderHTML is readable
// without JS, StaticCanva renders the no-JS form on the server and the
// interactive one in the browser, and the editor-side helpers keep the
// documents valid.
import { afterEach, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { Window } from "happy-dom";

const domWindow = new Window({ url: "http://localhost/" });
for (const key of [
  "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLButtonElement", "Element", "Node", "Text", "DocumentFragment",
  "MutationObserver", "Range", "Selection", "DOMParser", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame",
  "CustomEvent", "Event", "KeyboardEvent", "MouseEvent", "InputEvent", "FocusEvent", "NodeFilter", "DOMException",
  "localStorage", "sessionStorage",
]) {
  if (domWindow[key] !== undefined && globalThis[key] === undefined) globalThis[key] = domWindow[key];
}
globalThis.window ??= domWindow;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
document.documentElement.lang = "en";

const React = (await import("react")).default;
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { renderToStaticMarkup } = await import("react-dom/server");
const { Editor, getSchema, getHTMLFromFragment, getExtensionField } = await import("@tiptap/core");
const { default: StarterKit } = await import("@tiptap/starter-kit");
const { DOMParser: PMDOMParser } = await import("@tiptap/pm/model");
const { renderToHTMLString } = await import("@tiptap/static-renderer/pm/html-string");
const { renderToReactElement } = await import("@tiptap/static-renderer/pm/react");
const Blocks = await import("../components/Objects/Editor/Blocks/extensions");
const { default: Callout } = await import("../components/Objects/Editor/Extensions/Callout/Callout");
const { default: StaticCanva } = await import("../components/Objects/Activities/StaticCanva/StaticCanva.tsx");
const { getNodeViewComponent } = await import("../components/Objects/Editor/core/nodeView.ts");

const LAYOUT = "../components/Objects/Editor/Extensions/Plus/layout/";
const M = await import(`${LAYOUT}layoutModel.ts`);
const { createLayoutNodes, layoutBlockIdsKey } = await import(`${LAYOUT}layoutNodes.ts`);
const { checklistStore, isTicked } = await import(`${LAYOUT}checklistStore.ts`);
const { hydrateTableOfContents, headingsFromDom } = await import(`${LAYOUT}tocDom.ts`);
const S = await import(`${LAYOUT}shared.tsx`);
const { layoutExtensions, layoutSlashItems, layoutLabels } = await import(`${LAYOUT}index.ts`);

const fixtures = JSON.parse(readFileSync(new URL("./fixtures/editor-blocks/layout-blocks.json", import.meta.url), "utf8"));
const EVERY = fixtures.find((f) => f.name === "every-layout-block").content;
const DEFAULTS = fixtures.find((f) => f.name === "defaults-and-nesting").content;

const base = StarterKit.configure({ codeBlock: false, undoRedo: false });
const extensions = (mode = "learner") => [base, Blocks.ToggleBlock, Callout, ...createLayoutNodes({ mode, activityId: "act_1" })];
const schema = getSchema(extensions());

const p = (text) => (text ? { type: "paragraph", content: [{ type: "text", text }] } : { type: "paragraph" });
const doc = (...content) => ({ type: "doc", content });
const html = (json) => getHTMLFromFragment(schema.nodeFromJSON(json).content, schema);
const parseHTML = (markup) => {
  const el = document.createElement("div");
  el.innerHTML = markup;
  return PMDOMParser.fromSchema(schema).parse(el).toJSON();
};
const LAYOUT_NODES = ["tabs", "tabItem", "columns", "column", "accordion", "timeline", "timelineItem", "tableOfContents", "keyTakeaways", "taskList", "taskItem"];

describe("schema and round trips", () => {
  test("every fixture loads, checks and holds every layout node", () => {
    const seen = new Set();
    for (const f of fixtures) {
      const node = schema.nodeFromJSON(f.content);
      expect(() => node.check()).not.toThrow();
      node.descendants((n) => void seen.add(n.type.name));
    }
    for (const name of LAYOUT_NODES) expect([name, seen.has(name)]).toEqual([name, true]);
  });

  test("JSON round trip keeps every stored attr and is stable", () => {
    for (const f of fixtures) {
      const once = schema.nodeFromJSON(f.content).toJSON();
      expect(once).toMatchObject(f.content);
      expect(schema.nodeFromJSON(once).toJSON()).toEqual(once);
    }
  });

  test("defaults fill in for nodes saved without attrs", () => {
    const out = schema.nodeFromJSON(DEFAULTS).toJSON().content;
    expect(out[0].attrs).toEqual({ blockId: null, variant: "line" });
    expect(out[0].content[0].attrs).toEqual({ title: "", icon: null });
    expect(out[0].content[0].content[0].attrs).toEqual({ layout: "1-1", gap: "md", stackOnMobile: true, verticalAlign: "top" });
    expect(out[1].attrs).toEqual({ single: true, variant: "default" });
    expect(out[2].attrs).toEqual({ title: "", maxLevel: 3, numbered: false });
    expect(out[3].attrs).toEqual({ title: "", tone: "amber", icon: null });
    expect(out[4].attrs).toEqual({ blockId: null, learnerCanCheck: false });
    expect(out[4].content[0].attrs).toEqual({ checked: false });
  });

  test("HTML written by the nodes parses back to the same document", () => {
    for (const f of fixtures) {
      expect(parseHTML(html(f.content))).toEqual(schema.nodeFromJSON(f.content).toJSON());
    }
  });

  test("content rules: 2–8 tabs, 2–4 columns, toggles only in an accordion", () => {
    const tab = { type: "tabItem", content: [p("x")] };
    const col = { type: "column", content: [p("x")] };
    const bad = [
      { type: "tabs", content: [tab] },
      { type: "tabs", content: Array(9).fill(tab) },
      { type: "columns", content: [col] },
      { type: "columns", content: Array(5).fill(col) },
      { type: "accordion", content: [p("x")] },
      { type: "timeline", content: [] },
    ];
    for (const node of bad) expect(() => schema.nodeFromJSON(doc(node)).check()).toThrow();
    expect(() => schema.nodeFromJSON(doc({ type: "tabs", content: Array(8).fill(tab) })).check()).not.toThrow();
    expect(() => schema.nodeFromJSON(doc({ type: "columns", content: Array(4).fill(col) })).check()).not.toThrow();
  });

  test("the editor, preview and learner schemas are the same", () => {
    const spec = (s) => Object.fromEntries(LAYOUT_NODES.map((n) => [n, [s.nodes[n].spec.content ?? null, Object.keys(s.nodes[n].spec.attrs ?? {})]]));
    expect(spec(getSchema(extensions("editor")))).toEqual(spec(schema));
    expect(spec(getSchema(extensions("preview")))).toEqual(spec(schema));
    expect(spec(getSchema([base, Blocks.ToggleBlock, ...layoutExtensions({ mode: "learner", activity: { activity_uuid: "a" } })]))).toEqual(spec(schema));
  });
});

describe("renderHTML is readable without JS (exports, @tiptap/static-renderer)", () => {
  const out = renderToHTMLString({ content: EVERY, extensions: extensions() });

  test("tabs become titled sections, untitled ones get a generic title", () => {
    expect(out).toContain('<div data-block-id="tabs_1" data-variant="pills" data-type="tabs" class="lh-tabs-static">');
    expect(out).toContain('<section data-title="Overview" data-type="tab-item"><h3 class="lh-tab-heading">Overview</h3><div data-tab-body=""><p>Big picture first.</p></div></section>');
    expect(out).toContain('<section data-type="tab-item"><h3 class="lh-tab-heading">Tab</h3>');
  });

  test("columns carry their grid tracks; a timeline is an ordered list with headings", () => {
    expect(out).toContain('data-type="columns" class="lh-columns-static" style="--lh-cols:minmax(0,1fr) minmax(0,2fr)"');
    expect(out).toContain('data-stack="false"');
    expect(out).toContain('<ol data-variant="process" data-orientation="horizontal" data-type="timeline">');
    expect(out).toContain('<p class="lh-tl-heading"><span class="lh-tl-label">Week 1</span> <strong>Prepare</strong></p><div data-tl-body=""><p>Gather what you need.</p></div>');
    const plain = renderToHTMLString({ content: doc({ type: "timeline", attrs: { numbered: false }, content: [{ type: "timelineItem", content: [p("x")] }] }), extensions: extensions() });
    expect(plain).toBe('<ul data-variant="steps" data-numbered="false" data-orientation="vertical" data-type="timeline"><li data-type="timeline-item"><div data-tl-body=""><p>x</p></div></li></ul>');
  });

  test("key takeaways, the checklist and the accordion keep their content and settings", () => {
    expect(out).toContain('<aside data-tone="teal" data-icon="star" data-type="key-takeaways"><p class="lh-kt-title"><strong>Key takeaways</strong></p>');
    expect(out).toContain('<ul data-block-id="check_1" data-type="taskList"><li data-checked="true" data-type="taskItem">');
    expect(out).toContain('<div data-single="false" data-variant="bordered" data-type="accordion">');
  });

  test("a table of contents without an editor leaves a placeholder", () => {
    expect(out).toContain('<nav data-title="On this page" data-max-level="3" data-numbered="true" data-type="table-of-contents" aria-label="On this page"><p class="lh-toc-title">On this page</p><ol data-lh-toc-pending=""');
  });

  test("settings at their defaults add no attributes", () => {
    const d = renderToHTMLString({ content: DEFAULTS, extensions: extensions() });
    expect(d).toContain('<div data-variant="default" data-type="accordion">');
    expect(d).toContain('<nav data-max-level="3" data-type="table-of-contents" aria-label="Contents">');
    expect(d).toContain('data-learner-can-check="false"');
    // Three columns stored with the default two-column layout get three even tracks.
    expect(d).toContain("--lh-cols:minmax(0,1fr) minmax(0,1fr) minmax(0,1fr)");
  });

  test("labels follow the learner's language", () => {
    expect(layoutLabels()).toEqual({ tab: "Tab", contents: "Contents", keyTakeaways: "Key takeaways" });
    const fr = createLayoutNodes({ mode: "learner", labels: () => ({ tab: "Onglet", contents: "Sommaire", keyTakeaways: "À retenir" }) });
    const s = renderToHTMLString({ content: DEFAULTS, extensions: [base, Blocks.ToggleBlock, ...fr] });
    expect(s).toContain('<h3 class="lh-tab-heading">Onglet</h3>');
    expect(s).toContain("<strong>À retenir</strong>");
    expect(s).toContain('aria-label="Sommaire"');
  });

  test("an older client without these nodes still shows their text", () => {
    const element = renderToReactElement({
      content: EVERY,
      extensions: [base],
      options: { unhandledNode: ({ children }) => React.createElement("div", null, children) },
    });
    const text = renderToStaticMarkup(element);
    for (const s of ["Big picture first.", "Narrow side.", "The outcome.", "Gather what you need.", "The main idea", "Read the lesson"]) expect(text).toContain(s);
  });
});

describe("table of contents", () => {
  test("getHTML in an editor lists the headings with their anchor ids", () => {
    const editor = makeEditor(EVERY, "learner");
    const out = editor.getHTML();
    expect(out).toContain('<ol><li data-depth="0"><a href="#heading-getting-started">Getting started</a></li><li data-depth="1"><a href="#heading-questions">Questions</a></li><li data-depth="0"><a href="#heading-wrap-up">Wrap up</a></li></ol>');
    editor.destroy();
  });

  test("hydrateTableOfContents fills a server placeholder from the rendered headings", () => {
    const root = document.createElement("div");
    root.innerHTML = `<h2 id="heading-a">A</h2>${renderToHTMLString({ content: doc({ type: "tableOfContents", attrs: { maxLevel: 2 } }), extensions: extensions() })}<h3 id="heading-b">B</h3><h2 id="heading-c">C</h2>`;
    expect(hydrateTableOfContents(root)).toBe(1);
    expect([...root.querySelectorAll("nav li a")].map((a) => [a.getAttribute("href"), a.textContent])).toEqual([["#heading-a", "A"], ["#heading-c", "C"]]);
    expect(root.querySelector("[data-lh-toc-pending]")).toBeNull();
    expect(hydrateTableOfContents(root)).toBe(0);
    expect(headingsFromDom(root).map((h) => h.level)).toEqual([2, 3, 2]);
  });
});

describe("StaticCanva before hydration (server HTML, no JS)", () => {
  const markup = renderToStaticMarkup(React.createElement(StaticCanva, { content: EVERY, activity: { activity_uuid: "act_1" } }));

  test("tabs show every panel under its title, with no tab bar", () => {
    expect(markup).not.toContain('role="tablist"');
    expect(markup).not.toContain("data-active=");
    expect(markup).not.toContain("data-ready");
    const titles = [...markup.matchAll(/<h3 class="lh-tab-title"[^>]*>([^<]+)<\/h3>/g)].map((m) => m[1]);
    expect(titles).toEqual(["Overview", "Details", "Tab"]);
    expect(markup).toContain("Untitled tab body.");
  });

  test("the other blocks render their content and settings", () => {
    expect(markup).toContain('data-layout="1-2" data-gap="lg" data-valign="center" data-stack="false"');
    expect(markup).toContain("--lh-cols:minmax(0,1fr) minmax(0,2fr)");
    expect(markup).toContain('data-lh-accordion="" data-variant="bordered" data-single="false"');
    expect(markup).toContain('data-variant="process" data-orientation="horizontal" data-numbered="true"');
    expect(markup).toContain(">Week 1</div>");
    expect(markup).toContain('<p class="m-0 text-[15px] font-semibold">Key takeaways</p>');
    expect(markup).toMatch(/role="checkbox" aria-checked="true" aria-label="Read the lesson"/);
    // Progress needs the learner's ticks, which only exist in the browser.
    expect(markup).not.toContain('role="progressbar"');
  });
});

// ── In the browser ──────────────────────────────────────────────────────────

let mounted = [];
afterEach(async () => {
  for (const { root, el } of mounted) {
    await act(async () => root.unmount());
    el.remove();
  }
  mounted = [];
  checklistStore._clear();
  localStorage.clear();
});

async function mount(content) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => root.render(React.createElement(StaticCanva, { content, activity: { activity_uuid: "act_1" } })));
  mounted.push({ root, el });
  return el;
}
const flush = () => act(async () => new Promise((r) => setTimeout(r, 5)));
const click = (node) => act(async () => node.dispatchEvent(new window.MouseEvent("click", { bubbles: true })));
const key = (node, k) => act(async () => node.dispatchEvent(new window.KeyboardEvent("keydown", { key: k, bubbles: true })));

describe("StaticCanva in the browser", () => {
  test("tabs: a tab bar, one panel at a time, arrows / Home / End", async () => {
    const el = await mount(EVERY);
    const tabs = () => [...el.querySelectorAll('[role="tab"]')];
    const panels = el.querySelector(".lh-tabs-panels");
    expect(el.querySelector(".lh-tabs").hasAttribute("data-ready")).toBe(true);
    expect(tabs().map((t) => t.textContent)).toEqual(["Overview", "Details", "Tab 3"]);
    expect(panels.getAttribute("data-active")).toBe("0");
    expect(tabs().map((t) => t.getAttribute("tabindex"))).toEqual(["0", "-1", "-1"]);
    await click(tabs()[1]);
    expect(panels.getAttribute("data-active")).toBe("1");
    expect(tabs()[1].getAttribute("aria-selected")).toBe("true");
    await key(tabs()[1], "ArrowRight");
    expect(panels.getAttribute("data-active")).toBe("2");
    expect(document.activeElement).toBe(tabs()[2]);
    await key(tabs()[2], "ArrowRight");
    expect(panels.getAttribute("data-active")).toBe("0");
    await key(tabs()[0], "End");
    expect(panels.getAttribute("data-active")).toBe("2");
    await key(tabs()[2], "Home");
    expect(panels.getAttribute("data-active")).toBe("0");
    expect(el.querySelectorAll('.lh-tab-panel[role="tabpanel"]').length).toBe(3);
  });

  test("accordion: one open at a time, expand / collapse all, arrow keys", async () => {
    const toggle = (summary) => ({ type: "toggleBlock", attrs: { summary }, content: [p(`${summary} body`)] });
    const el = await mount(doc({ type: "accordion", content: [toggle("One"), toggle("Two"), toggle("Three")] }));
    const headers = () => [...el.querySelectorAll(".lh-toggle button[aria-expanded]")];
    const state = () => headers().map((b) => b.getAttribute("aria-expanded"));
    expect(state()).toEqual(["false", "false", "false"]);
    await click(headers()[0]);
    await flush();
    expect(state()).toEqual(["true", "false", "false"]);
    await click(headers()[1]);
    await flush();
    expect(state()).toEqual(["false", "true", "false"]);
    const all = () => el.querySelector(".lh-accordion-actions button");
    expect(all().textContent).toBe("Expand all");
    await click(all());
    await flush();
    expect(state()).toEqual(["true", "true", "true"]);
    expect(all().textContent).toBe("Collapse all");
    await click(all());
    await flush();
    expect(state()).toEqual(["false", "false", "false"]);
    headers()[0].focus();
    await key(headers()[0], "ArrowDown");
    expect(document.activeElement).toBe(headers()[1]);
    await key(headers()[1], "End");
    expect(document.activeElement).toBe(headers()[2]);
    await key(headers()[2], "Home");
    expect(document.activeElement).toBe(headers()[0]);
  });

  test("accordion with single off lets several sections stay open", async () => {
    const el = await mount(EVERY);
    const acc = el.querySelector(".lh-accordion");
    const headers = () => [...acc.querySelectorAll(".lh-toggle button[aria-expanded]")];
    expect(headers().map((b) => b.getAttribute("aria-expanded"))).toEqual(["false", "true"]);
    await click(headers()[0]);
    await flush();
    expect(headers().map((b) => b.getAttribute("aria-expanded"))).toEqual(["true", "true"]);
  });

  test("checklist: learners tick items, progress follows, ticks persist and reset", async () => {
    const el = await mount(EVERY);
    const list = el.querySelector(".lh-checklist");
    const boxes = () => [...list.querySelectorAll('[role="checkbox"]')];
    const progress = () => list.querySelector(".lh-checklist-progress span").textContent;
    expect(progress()).toBe("1/2");
    expect(boxes().map((b) => b.getAttribute("aria-checked"))).toEqual(["true", "false"]);
    await click(boxes()[1]);
    expect(progress()).toBe("2/2");
    expect(JSON.parse(localStorage.getItem("lh:checklist:act_1:check_1"))).toEqual({ "try the exercise": true });
    // The author's default can be unticked by the learner too.
    await click(boxes()[0]);
    expect(progress()).toBe("1/2");
    expect(list.querySelector('[role="progressbar"]').getAttribute("aria-valuenow")).toBe("1");
    await click(list.querySelector(".lh-checklist-progress button"));
    expect(progress()).toBe("1/2");
    expect(boxes().map((b) => b.getAttribute("aria-checked"))).toEqual(["true", "false"]);
    expect(localStorage.getItem("lh:checklist:act_1:check_1")).toBeNull();
  });

  test("a locked checklist shows the author's state and no progress", async () => {
    const el = await mount(DEFAULTS);
    const list = el.querySelector('.lh-checklist[data-learner-can-check="false"]');
    expect(list.querySelector('[role="progressbar"]')).toBeNull();
    const box = list.querySelector('[role="checkbox"]');
    expect(box.hasAttribute("disabled")).toBe(true);
    await click(box);
    expect(box.getAttribute("aria-checked")).toBe("false");
  });

  test("table of contents: reads the rendered headings, numbered and indented", async () => {
    const el = await mount(EVERY);
    let links = [];
    for (let i = 0; i < 50 && links.length === 0; i++) {
      await flush();
      links = [...el.querySelectorAll(".lh-toc-list a")];
    }
    expect(links.map((a) => [a.getAttribute("href"), a.textContent])).toEqual([
      ["#heading-getting-started", "1Getting started"],
      ["#heading-questions", "1.1Questions"],
      ["#heading-wrap-up", "2Wrap up"],
    ]);
    expect(el.querySelector(".lh-toc nav").getAttribute("aria-label")).toBe("On this page");
  });
});

// ── Editor ─────────────────────────────────────────────────────────────────

function makeEditor(content, mode = "editor") {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({ element, content, extensions: extensions(mode) });
}
const findPos = (editor, name) => {
  let pos = -1;
  editor.state.doc.descendants((n, at) => {
    if (pos < 0 && n.type.name === name) pos = at;
  });
  return pos;
};
const props = (editor, name) => {
  const pos = findPos(editor, name);
  return { editor, getPos: () => pos, node: editor.state.doc.nodeAt(pos) };
};

describe("editor", () => {
  test("every slash item inserts valid starter content", () => {
    expect(layoutSlashItems.map((i) => [i.id, i.category])).toEqual([
      ["tabs", "layout"], ["columns", "layout"], ["accordion", "layout"], ["timeline", "layout"],
      ["tableOfContents", "layout"], ["keyTakeaways", "layout"], ["checklist", "text"],
    ]);
    const expected = { tabs: 3, columns: 2, accordion: 3, timeline: 3, keyTakeaways: 1, taskList: 3 };
    for (const item of layoutSlashItems) {
      const editor = makeEditor(doc(p("")));
      item.command(editor);
      expect(() => editor.state.doc.check()).not.toThrow();
      const node = editor.state.doc.firstChild;
      expect(LAYOUT_NODES).toContain(node.type.name);
      if (expected[node.type.name]) expect([node.type.name, node.childCount]).toEqual([node.type.name, expected[node.type.name]]);
      editor.destroy();
    }
    const takeaways = M.starterKeyTakeaways((_k, f) => f);
    expect(takeaways.content[0].type).toBe("bulletList");
    expect(takeaways.content[0].content.length).toBe(3);
  });

  test("tabs and checklists get their own block id, also when duplicated", () => {
    const list = { type: "taskList", content: [{ type: "taskItem", content: [p("a")] }] };
    const editor = makeEditor(doc(p("start")));
    editor.commands.insertContentAt(editor.state.doc.content.size, list);
    const ids = () => {
      const out = [];
      editor.state.doc.descendants((n) => void (n.type.name === "taskList" && out.push(n.attrs.blockId)));
      return out;
    };
    expect(ids()[0]).toMatch(/^lh_/);
    editor.commands.insertContentAt(editor.state.doc.content.size, { ...list, attrs: { blockId: ids()[0] } });
    const [a, b] = ids();
    expect(a).toMatch(/^lh_/);
    expect(b).toMatch(/^lh_/);
    expect(a).not.toBe(b);
    expect(editor.state.plugins.some((pl) => pl.spec.key === layoutBlockIdsKey)).toBe(true);
    // A copy pasted above its original: the original keeps its id (and its learners' ticks).
    editor.commands.insertContentAt(0, { ...list, attrs: { blockId: b } });
    const after = ids();
    expect(after.length).toBe(3);
    expect(after[2]).toBe(b);
    expect(after[1]).toBe(a);
    expect(new Set(after).size).toBe(3);
    // Tabs get one too.
    const tabs = M.starterTabs((_k, f) => f);
    editor.commands.insertContentAt(editor.state.doc.content.size, { ...tabs, attrs: { ...tabs.attrs, blockId: null } });
    let tabsId = null;
    editor.state.doc.descendants((n) => void (n.type.name === "tabs" && (tabsId = n.attrs.blockId)));
    expect(tabsId).toMatch(/^lh_/);
    editor.destroy();
    // Learners never rewrite documents.
    const learner = makeEditor(doc(list), "learner");
    expect(learner.state.plugins.some((pl) => pl.spec.key === layoutBlockIdsKey)).toBe(false);
    learner.destroy();
  });

  test("tab helpers: rename, add up to 8, delete down to 2, reorder", () => {
    const editor = makeEditor(doc(M.starterTabs((_k, f) => f)));
    const tabs = () => editor.state.doc.firstChild;
    expect(S.setChildAttrs(props(editor, "tabs"), 1, { title: "Renamed" })).toBe(true);
    expect(S.setChildAttrs(props(editor, "tabs"), 1, { title: "Renamed" })).toBe(false);
    expect(tabs().child(1).attrs.title).toBe("Renamed");
    for (let i = 0; i < 5; i++) S.appendChild(props(editor, "tabs"), { type: "tabItem", content: [p("")] });
    expect(tabs().childCount).toBe(8);
    expect(S.appendChild(props(editor, "tabs"), { type: "tabItem", content: [p("")] })).toBe(true);
    // The schema refuses a 9th tab, so the document keeps 8.
    expect(tabs().childCount).toBe(8);
    while (S.removeChild(props(editor, "tabs"), 0, M.MIN_TABS));
    expect(tabs().childCount).toBe(2);
    const titles = () => [0, 1].map((i) => tabs().child(i).attrs.title);
    const before = titles();
    expect(S.replaceChildren(props(editor, "tabs"), M.moveItem(S.childrenJSON(tabs()), 0, 1))).toBe(true);
    expect(titles()).toEqual([before[1], before[0]]);
    expect(S.replaceChildren(props(editor, "tabs"), [S.childrenJSON(tabs())[0]])).toBe(false);
    expect(S.commitAttrs(props(editor, "tabs"), { variant: "boxed" })).toBe(true);
    expect(S.commitAttrs(props(editor, "tabs"), { variant: "boxed" })).toBe(false);
    expect(tabs().attrs.variant).toBe("boxed");
    editor.destroy();
  });

  test("changing the column layout adds columns or folds removed ones into the last", () => {
    const editor = makeEditor(doc(M.starterColumns((_k, f) => f)));
    const cols = () => editor.state.doc.firstChild;
    const relayout = (layout) => {
      const pr = props(editor, "columns");
      return S.replaceChildren(pr, M.relayoutColumns(S.childrenJSON(pr.node), layout), { layout });
    };
    expect(relayout("1-1-1-1")).toBe(true);
    expect([cols().attrs.layout, cols().childCount]).toEqual(["1-1-1-1", 4]);
    expect(relayout("1-2")).toBe(true);
    expect([cols().attrs.layout, cols().childCount]).toEqual(["1-2", 2]);
    expect(cols().child(0).textContent).toBe("First column");
    expect(cols().child(1).textContent).toBe("Second column");
    expect(() => editor.state.doc.check()).not.toThrow();
    editor.destroy();
  });

  test("the editor keeps the stock task item view (authors set the default tick); learners get theirs", () => {
    const viewOf = (mode, name) => {
      const ext = createLayoutNodes({ mode }).find((e) => e.name === name);
      const add = getExtensionField(ext, "addNodeView", { name, options: ext.options, storage: ext.storage, editor: undefined, type: undefined, parent: undefined });
      return add ? add() : null;
    };
    const editorView = viewOf("editor", "taskItem");
    expect(typeof editorView).toBe("function");
    expect(getNodeViewComponent(editorView)).toBeNull();
    expect(getNodeViewComponent(viewOf("learner", "taskItem"))?.name).toBe("ChecklistItemView");
    expect(getNodeViewComponent(viewOf("preview", "taskItem"))?.name).toBe("ChecklistItemView");
    expect(getNodeViewComponent(viewOf("editor", "taskList"))?.name).toBe("ChecklistView");
    expect(createLayoutNodes({ mode: "editor", activityId: "act_9" }).find((e) => e.name === "taskItem").options).toMatchObject({ nested: false, activityId: "act_9" });
  });
});

describe("model", () => {
  test("column layouts", () => {
    expect(M.columnCount("1-1-1")).toBe(3);
    expect(M.columnCount("nope")).toBe(2);
    expect(M.columnTracks("2-1")).toBe("minmax(0,2fr) minmax(0,1fr)");
    expect(M.effectiveLayout("1-2", 2)).toBe("1-2");
    expect(M.effectiveLayout("1-2", 3)).toBe("1-1-1");
    expect(M.effectiveLayout("1-1", 4)).toBe("1-1-1-1");
    const col = (...t) => ({ type: "column", content: t.map(p) });
    const out = M.relayoutColumns([col("a"), col(""), col("c"), col("d")], "1-1");
    expect(out.map((c) => c.content.map((b) => b.content?.[0]?.text ?? ""))).toEqual([["a"], ["c", "d"]]);
    expect(M.relayoutColumns([col("a"), col("b")], "1-1-1").length).toBe(3);
  });

  test("outline entries: levels, indent from the shallowest, hierarchical numbers", () => {
    const h = (level, text) => ({ level, text, id: text });
    const entries = M.outlineEntries([h(2, "A"), h(3, "A1"), h(4, "deep"), h(3, "A2"), h(2, "B"), h(4, "B-deep"), h(2, " ")], 3);
    expect(entries.map((e) => [e.text, e.depth, e.number])).toEqual([["A", 0, "1"], ["A1", 1, "1.1"], ["A2", 1, "1.2"], ["B", 0, "2"]]);
    expect(M.outlineEntries([h(4, "x"), h(3, "y")], 4).map((e) => [e.depth, e.number])).toEqual([[1, "1.1"], [0, "2"]]);
    expect(M.outlineEntries([], 3)).toEqual([]);
  });

  test("helpers", () => {
    expect(M.moveItem([1, 2, 3], 0, 2)).toEqual([2, 3, 1]);
    expect(M.moveItem([1, 2], 0, 5)).toEqual([1, 2]);
    expect(M.checklistStorageKey("act", "blk")).toBe("lh:checklist:act:blk");
    expect(M.checklistStorageKey(null, "")).toBe("lh:checklist:local:default");
    expect(M.checklistItemKey("  Read   THE lesson ")).toBe("read the lesson");
    expect(M.hashText("abc")).toBe(M.hashText("abc"));
    expect(M.hashText("abc")).not.toBe(M.hashText("abd"));
    expect(M.toneOf("teal")).toBe("teal");
    expect(M.toneOf("violet")).toBeNull();
    expect(M.iconOf("rocket")).toBe("rocket");
    expect(M.newBlockId()).not.toBe(M.newBlockId());
  });
});

describe("checklist store", () => {
  test("ticks persist per list, the learner's tick wins over the author's default", () => {
    const k = "lh:checklist:a:b";
    expect(checklistStore.get(k)).toEqual({});
    let calls = 0;
    const off = checklistStore.subscribe(k, () => calls++);
    checklistStore.set(k, "x", true);
    expect(JSON.parse(localStorage.getItem(k))).toEqual({ x: true });
    expect(isTicked(checklistStore.get(k), "x", false)).toBe(true);
    expect(isTicked(checklistStore.get(k), "y", true)).toBe(true);
    checklistStore.set(k, "y", false);
    expect(isTicked(checklistStore.get(k), "y", true)).toBe(false);
    checklistStore.reset(k);
    expect(checklistStore.get(k)).toEqual({});
    off();
    checklistStore.set(k, "z", true);
    expect(calls).toBe(3);
    expect(checklistStore.getServer()).toEqual({});
  });

  test("bad stored data or blocked storage never throws", () => {
    localStorage.setItem("lh:checklist:bad:json", "{nope");
    expect(checklistStore.get("lh:checklist:bad:json")).toEqual({});
    localStorage.setItem("lh:checklist:bad:shape", JSON.stringify({ a: true, b: "yes", c: 1 }));
    expect(checklistStore.get("lh:checklist:bad:shape")).toEqual({ a: true });
    const original = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", { configurable: true, get: () => { throw new Error("blocked"); } });
    try {
      expect(checklistStore.get("lh:checklist:blocked:x")).toEqual({});
      expect(() => checklistStore.set("lh:checklist:blocked:x", "a", true)).not.toThrow();
      expect(checklistStore.get("lh:checklist:blocked:x")).toEqual({ a: true });
      expect(() => checklistStore.reset("lh:checklist:blocked:x")).not.toThrow();
    } finally {
      Object.defineProperty(window, "localStorage", original);
    }
  });
});

describe("translations", () => {
  const SRC = new URL(`${LAYOUT}`, import.meta.url);
  const files = [...readdirSync(SRC), ...readdirSync(new URL("views/", SRC)).map((f) => `views/${f}`)].filter((f) => /\.tsx?$/.test(f));
  const source = files.map((f) => readFileSync(new URL(f, SRC), "utf8")).join("\n");
  const used = new Set([...source.matchAll(/'((?:editor\.blocks_v2|activities|editor\.slash_menu\.items)\.[a-z0-9_.]+)'/g)].map((m) => m[1]));
  for (const icon of M.LAYOUT_ICONS) used.add(`editor.blocks_v2.layout.icons.${icon}`);
  const get = (obj, key) => key.split(".").reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), obj);
  const localeDir = new URL("../locales/", import.meta.url);
  const locales = readdirSync(localeDir).filter((f) => f.endsWith(".json"));
  const en = JSON.parse(readFileSync(new URL("en.json", localeDir), "utf8"));

  test("every key the layout blocks use exists in all 22 locales, placeholders intact", () => {
    expect(locales.length).toBe(22);
    expect(used.size).toBeGreaterThan(100);
    for (const file of locales) {
      const data = JSON.parse(readFileSync(new URL(file, localeDir), "utf8"));
      for (const k of used) {
        const v = get(data, k);
        expect([file, k, typeof v]).toEqual([file, k, "string"]);
        expect(v.trim().length).toBeGreaterThan(0);
        const ph = (s) => (s.match(/\{\{\w+\}\}/g) ?? []).sort();
        expect([file, k, ph(v)]).toEqual([file, k, ph(get(en, k))]);
      }
    }
  });

  test("other languages are really translated", () => {
    const fr = JSON.parse(readFileSync(new URL("fr.json", localeDir), "utf8"));
    const ja = JSON.parse(readFileSync(new URL("ja.json", localeDir), "utf8"));
    const same = [...used].filter((k) => get(fr, k) === get(en, k) && get(ja, k) === get(en, k));
    // Only placeholders-only strings may match English.
    expect(same).toEqual(["activities.checklist.progress"]);
  });
});
