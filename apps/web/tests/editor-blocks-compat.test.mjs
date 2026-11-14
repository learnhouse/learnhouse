// Backward compatibility of the redesigned blocks against REAL stored content.
//
// tests/fixtures/editor-blocks/db-activities.json holds activities dumped from
// a local database (every activity that uses an image, video, audio, library,
// callout, code, divider or table block). Each one is loaded through a schema
// that carries the redesigned attrs, and must come back with every stored attr
// unchanged, the new attrs at their defaults, nothing dropped, and the view
// helpers resolving to exactly what the old blocks rendered.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";

const domWindow = new Window({ url: "http://localhost/" });
for (const key of ["document", "navigator", "HTMLElement", "Element", "Node", "Text", "DocumentFragment", "MutationObserver", "Range"]) {
  if (!(key in globalThis)) globalThis[key] = domWindow[key];
}
globalThis.window ??= domWindow;

const { Node, Extension, getSchema } = await import("@tiptap/core");
const { default: StarterKit } = await import("@tiptap/starter-kit");
const { default: CodeBlock } = await import("@tiptap/extension-code-block");
const { Table } = await import("@tiptap/extension-table");
const { default: TableRow } = await import("@tiptap/extension-table-row");
const { default: TableCell } = await import("@tiptap/extension-table-cell");
const { default: TableHeader } = await import("@tiptap/extension-table-header");
const { CALLOUT_CONTENT, normalizeCalloutContent } = await import(
  "../components/Objects/Editor/Extensions/Callout/calloutContent.ts"
);
const A = await import("../components/Objects/Editor/Blocks/schema/blockAttrs.ts");
const { resolveEmbedSrc } = await import("../components/Objects/Editor/Blocks/embeds/embedRender.ts");

const EDITOR = new URL("../components/Objects/Editor/Extensions/", import.meta.url);
const fixtures = JSON.parse(readFileSync(new URL("./fixtures/editor-blocks/db-activities.json", import.meta.url), "utf8"));

// The attrs each node declared BEFORE the redesign, read from its source so a
// later change to a node definition can't silently drift from this test.
function baseAttrsFromSource(rel) {
  const src = readFileSync(new URL(rel, EDITOR), "utf8");
  const body = src.slice(src.indexOf("addAttributes()"), src.indexOf("parseHTML()"));
  return [...body.matchAll(/^\s{6}(\w+): \{/gm)].map((m) => m[1]);
}

const NODE_SOURCES = {
  blockImage: "Image/ImageBlock.ts",
  blockVideo: "Video/VideoBlock.ts",
  blockAudio: "Audio/AudioBlock.ts",
  blockPDF: "PDF/PDFBlock.ts",
  blockEmbed: "EmbedObjects/EmbedObjects.ts",
};
const EXTRA = {
  blockImage: A.IMAGE_EXTRA_ATTRS,
  blockVideo: A.VIDEO_EXTRA_ATTRS,
  blockAudio: A.AUDIO_EXTRA_ATTRS,
  blockPDF: A.PDF_EXTRA_ATTRS,
  blockEmbed: A.EMBED_EXTRA_ATTRS,
};
// Defaults copied from the node files (checked against the source below).
const BASE_DEFAULTS = {
  blockImage: { blockObject: null, size: null, alignment: "center", unsplash_url: null, unsplash_photographer_name: null, unsplash_photographer_url: null, unsplash_photo_url: null },
  blockVideo: { blockObject: null },
  blockAudio: { blockObject: null },
  blockPDF: { blockObject: null, pdfHeight: null },
  blockEmbed: { embedUrl: null, embedCode: null, embedType: null, embedHeight: 300, embedAspectRatio: null, embedWidth: "100%", alignment: "left" },
};

const atom = (name, attrs) =>
  Node.create({
    name,
    group: "block",
    atom: true,
    addAttributes: () => attrs,
    parseHTML: () => [{ tag: name }],
    renderHTML: () => [name],
  });

const specs = (defaults) => Object.fromEntries(Object.entries(defaults).map(([k, v]) => [k, { default: v }]));

// Nodes this redesign doesn't touch, declared with whatever attrs the fixtures use.
const otherAtoms = {};
(function collect(node) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) return node.forEach(collect);
  if (["blockLibrary", "blockMathEquation", "blockQuiz", "flipcard", "flipcardGrid"].includes(node.type)) {
    otherAtoms[node.type] ??= {};
    for (const k of Object.keys(node.attrs || {})) otherAtoms[node.type][k] = { default: null };
  }
  collect(node.content);
})(fixtures.map((f) => f.content));

const extensions = [
  StarterKit.configure({ codeBlock: false, link: false }),
  CodeBlock.extend({ addAttributes() { return { ...this.parent?.(), ...A.CODE_BLOCK_EXTRA_ATTRS }; } }),
  Extension.create({ name: "dividerStyle", addGlobalAttributes: () => [{ types: ["horizontalRule"], attributes: A.DIVIDER_EXTRA_ATTRS }] }),
  Node.create({
    name: "callout",
    group: "block",
    content: CALLOUT_CONTENT,
    addAttributes: () => ({ type: { default: "info" }, dismissible: { default: false }, ...A.CALLOUT_EXTRA_ATTRS }),
    parseHTML: () => [{ tag: "callout" }],
    renderHTML: () => ["callout", 0],
  }),
  Node.create({ name: "calloutInfo", group: "block", content: "text*", parseHTML: () => [{ tag: "callout-info" }], renderHTML: () => ["callout-info", 0] }),
  Node.create({ name: "calloutWarning", group: "block", content: "text*", parseHTML: () => [{ tag: "callout-warning" }], renderHTML: () => ["callout-warning", 0] }),
  ...Object.entries(BASE_DEFAULTS).map(([name, defaults]) => atom(name, { ...specs(defaults), ...EXTRA[name] })),
  // Same content expressions as Flipcard.ts / FlipcardGrid.ts.
  ...Object.entries(otherAtoms).map(([name, attrs]) =>
    name === "flipcardGrid" || name === "flipcard"
      ? Node.create({ name, group: "block", content: name === "flipcard" ? "text*" : "flipcard+", addAttributes: () => attrs, parseHTML: () => [{ tag: name }], renderHTML: () => [name, 0] })
      : atom(name, attrs),
  ),
  Table,
  TableRow,
  TableHeader,
  TableCell,
];
const schema = getSchema(extensions);

const walk = (node, fn, path = "doc") => {
  fn(node, path);
  (node.content || []).forEach((c, i) => walk(c, fn, `${path}/${c.type}[${i}]`));
};

describe("stand-in schema matches the real node definitions", () => {
  for (const [name, rel] of Object.entries(NODE_SOURCES)) {
    test(`${name} declares the same base attrs as ${rel}`, () => {
      expect(baseAttrsFromSource(rel).sort()).toEqual(Object.keys(BASE_DEFAULTS[name]).sort());
      const src = readFileSync(new URL(rel, EDITOR), "utf8");
      expect(src).toContain(`...${name === "blockPDF" ? "PDF" : name.replace("block", "").toUpperCase()}_EXTRA_ATTRS`);
    });
  }
  test("callout spreads CALLOUT_EXTRA_ATTRS", () => {
    expect(readFileSync(new URL("Callout/Callout.ts", EDITOR), "utf8")).toContain("...CALLOUT_EXTRA_ATTRS");
  });
});

describe("stored activities load unchanged", () => {
  test("fixtures cover the blocks this redesign touched", () => {
    const seen = new Set();
    fixtures.forEach((f) => walk(f.content, (n) => seen.add(n.type)));
    for (const type of ["blockImage", "blockVideo", "blockAudio", "callout", "calloutInfo", "codeBlock", "horizontalRule", "table"]) {
      expect(seen.has(type)).toBe(true);
    }
    expect(fixtures.length).toBeGreaterThanOrEqual(20);
  });

  for (const fixture of fixtures) {
    test(`${fixture.name} (${fixture.activity_uuid})`, () => {
      const original = normalizeCalloutContent(fixture.content);
      const doc = schema.nodeFromJSON(original);
      expect(() => doc.check()).not.toThrow();
      const out = doc.toJSON();

      const before = [];
      const after = [];
      walk(original, (n, p) => before.push([p, n]));
      walk(out, (n, p) => after.push([p, n]));
      // Same nodes in the same places, same text.
      expect(after.map(([p]) => p)).toEqual(before.map(([p]) => p));
      expect(doc.textContent).toBe(schema.nodeFromJSON(original).textContent);

      after.forEach(([p, node], i) => {
        const old = before[i][1];
        // Every attr the old block stored survives as-is…
        for (const [k, v] of Object.entries(old.attrs || {})) expect([p, k, node.attrs?.[k]]).toEqual([p, k, v]);
        // …and the new ones sit at defaults that mean "as before".
        const added = A.NEW_ATTR_DEFAULTS[node.type] || {};
        for (const [k, v] of Object.entries(added)) {
          if (!(k in (old.attrs || {}))) expect([p, k, node.attrs?.[k]]).toEqual([p, k, v]);
        }
        expect(JSON.stringify(node.marks || [])).toBe(JSON.stringify(old.marks || []));
      });
    });
  }
});

describe("old blocks resolve to their old rendering", () => {
  const nodesOf = (type) => {
    const out = [];
    fixtures.forEach((f) => walk(schema.nodeFromJSON(normalizeCalloutContent(f.content)).toJSON(), (n) => n.type === type && out.push(n)));
    return out;
  };

  test("images: same width, alignment, empty alt, no caption/link, viewer on", () => {
    const imgs = nodesOf("blockImage");
    expect(imgs.length).toBeGreaterThan(0);
    for (const n of imgs) {
      const view = A.resolveImageView(n.attrs);
      // The old block: width = size.width ?? 300, alignment as stored, alt="".
      expect(view.width).toBe(n.attrs.size ? n.attrs.size.width : 300);
      expect(view.alignment).toBe(n.attrs.alignment || "center");
      expect(view).toMatchObject({ alt: "", caption: "", href: null, lightbox: true });
    }
  });

  test("videos: same size bucket, no start time, no chapters, no caption", () => {
    for (const n of nodesOf("blockVideo")) {
      const bo = A.resolveVideoBlockObject(n.attrs.blockObject);
      expect(["small", "medium", "large"]).toContain(bo.size);
      expect(A.parseTimecode(n.attrs.startTime)).toBeNull();
      expect(A.normalizeChapters(n.attrs.chapters)).toEqual([]);
      expect(n.attrs.caption).toBe("");
    }
  });

  test("audio: no caption and no transcript panel", () => {
    for (const n of nodesOf("blockAudio")) {
      expect(n.attrs.caption).toBe("");
      expect(n.attrs.transcript.trim()).toBe("");
    }
  });

  test("dividers keep the original line; callouts their type icon; code blocks no file name", () => {
    for (const n of nodesOf("horizontalRule")) expect(A.dividerVariantOf(n.attrs)).toBe("line");
    for (const n of nodesOf("callout")) expect(n.attrs.icon).toBeNull();
    for (const n of nodesOf("codeBlock")) expect(n.attrs.filename).toBeNull();
  });

  test("an embed saved by the old block (legacy shape) renders the same iframe src", () => {
    const legacy = {
      type: "doc",
      content: [
        { type: "blockEmbed", attrs: { embedUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", embedCode: null, embedType: "url", embedHeight: 300, embedAspectRatio: null, embedWidth: "100%", alignment: "left" } },
        { type: "blockEmbed", attrs: { embedUrl: "https://example.com/widget", embedType: "url", embedHeight: 480, embedAspectRatio: 1.5, embedWidth: "80%", alignment: "center" } },
        { type: "blockPDF", attrs: { blockObject: null, pdfHeight: 640 } },
      ],
    };
    const out = schema.nodeFromJSON(legacy).toJSON();
    const [yt, other, pdf] = out.content;
    expect(yt.attrs.embedProvider).toBeNull();
    expect(resolveEmbedSrc(yt.attrs.embedUrl, yt.attrs.embedProvider)).toBe("https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=0&rel=0");
    expect(resolveEmbedSrc(other.attrs.embedUrl, other.attrs.embedProvider)).toBe("https://example.com/widget");
    expect(other.attrs).toMatchObject({ embedHeight: 480, embedAspectRatio: 1.5, embedWidth: "80%", alignment: "center", caption: "" });
    expect(pdf.attrs).toEqual({ blockObject: null, pdfHeight: 640, caption: "" });
  });

  test("content written by the new blocks round-trips", () => {
    const fresh = {
      type: "doc",
      content: [
        { type: "blockImage", attrs: { ...BASE_DEFAULTS.blockImage, size: { width: "100%" }, alt: "A chart", caption: "Fig. 1", href: "https://example.com/", lightbox: false } },
        { type: "blockVideo", attrs: { blockObject: { block_uuid: "b", size: "large" }, caption: "Demo", startTime: 90, chapters: [{ start: 0, title: "Intro" }] } },
        { type: "horizontalRule", attrs: { variant: "dots" } },
        { type: "codeBlock", attrs: { language: "python", filename: "main.py" }, content: [{ type: "text", text: "print(1)" }] },
        { type: "callout", attrs: { type: "tip", dismissible: true, icon: "rocket" }, content: [{ type: "paragraph" }] },
      ],
    };
    expect(schema.nodeFromJSON(fresh).toJSON()).toEqual(fresh);
  });
});
