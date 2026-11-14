import { describe, expect, test } from "bun:test";
import { computeHeadingIds, slugifyHeading } from "../components/Objects/Activities/DynamicCanva/headingIds.ts";
import {
  countWords,
  docToMarkdown,
  formatTimestamp,
  isEmptyDoc,
  notesToMarkdown,
} from "../lib/notes/noteMarkdown.ts";

// A stand-in for a ProseMirror doc: just what computeHeadingIds walks.
function fakeDoc(headings) {
  return {
    descendants(cb) {
      let pos = 0;
      for (const h of headings) {
        const node = h === null
          ? { type: { name: "paragraph" }, textContent: "body", attrs: {} }
          : { type: { name: "heading" }, textContent: h.text, attrs: { level: h.level ?? 2 } };
        cb(node, pos);
        pos += 10;
      }
    },
  };
}

describe("heading ids", () => {
  test("slugs keep every script and drop punctuation", () => {
    expect(slugifyHeading("  Hello, World!  ")).toBe("hello-world");
    expect(slugifyHeading("Введение в DNS")).toBe("введение-в-dns");
    expect(slugifyHeading("مقدمة")).toBe("مقدمة");
    expect(slugifyHeading("___")).toBe("");
  });

  test("duplicates get -2, -3 and never collide", () => {
    const ids = computeHeadingIds(
      fakeDoc([{ text: "Intro" }, null, { text: "Intro" }, { text: "Intro 2" }, { text: "Intro" }]),
    ).map((h) => h.id);
    expect(ids[0]).toBe("heading-intro");
    expect(ids[1]).toBe("heading-intro-2");
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("an id that a later title would take is not reused", () => {
    const ids = computeHeadingIds(fakeDoc([{ text: "Intro 2" }, { text: "Intro" }, { text: "Intro" }])).map((h) => h.id);
    expect(new Set(ids).size).toBe(3);
    expect(ids[0]).toBe("heading-intro-2");
  });

  test("empty headings get a stable positional id", () => {
    const doc = fakeDoc([{ text: "A" }, { text: "   " }, { text: "!!!" }]);
    const first = computeHeadingIds(doc).map((h) => h.id);
    const again = computeHeadingIds(doc).map((h) => h.id);
    expect(first).toEqual(["heading-a", "heading-2", "heading-3"]);
    expect(again).toEqual(first);
  });

  test("keeps level, text and position", () => {
    const [h] = computeHeadingIds(fakeDoc([null, { text: "Glue records", level: 3 }]));
    expect(h).toEqual({ pos: 10, level: 3, text: "Glue records", id: "heading-glue-records" });
  });
});

describe("note helpers", () => {
  test("timestamps", () => {
    expect(formatTimestamp(0)).toBe("00:00");
    expect(formatTimestamp(192.7)).toBe("03:12");
    expect(formatTimestamp(3725)).toBe("1:02:05");
    expect(formatTimestamp(-4)).toBe("00:00");
  });

  test("word count, CJK included", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("  one two\nthree — ")).toBe(3);
    expect(countWords("日本語")).toBe(3);
  });

  test("empty documents", () => {
    expect(isEmptyDoc(null)).toBe(true);
    expect(isEmptyDoc({ type: "doc", content: [{ type: "paragraph" }] })).toBe(true);
    expect(isEmptyDoc({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: " " }] }] })).toBe(true);
    expect(isEmptyDoc({ type: "doc", content: [{ type: "horizontalRule" }] })).toBe(false);
    expect(isEmptyDoc({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }] })).toBe(false);
  });
});

describe("markdown export", () => {
  const doc = {
    type: "doc",
    content: [
      { type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: "TTL is *cached*", marks: [{ type: "link", attrs: { href: "https://x.test/a#heading-ttl" } }] }] }] },
      { type: "paragraph", content: [
        { type: "text", text: "Bold", marks: [{ type: "bold" }] },
        { type: "text", text: " and " },
        { type: "text", text: "it", marks: [{ type: "italic" }] },
        { type: "hardBreak" },
        { type: "text", text: "code", marks: [{ type: "code" }] },
        { type: "text", text: "gone", marks: [{ type: "strike" }] },
      ] },
      { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "a" }] }, { type: "paragraph", content: [{ type: "text", text: "more" }] }] }] },
      { type: "orderedList", attrs: { start: 3 }, content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "three" }] }] }] },
      { type: "taskList", content: [
        { type: "taskItem", attrs: { checked: true }, content: [{ type: "paragraph", content: [{ type: "text", text: "done" }] }] },
        { type: "taskItem", attrs: { checked: false }, content: [{ type: "paragraph", content: [{ type: "text", text: "todo" }] }] },
      ] },
      { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "H" }] },
      { type: "horizontalRule" },
      { type: "paragraph" },
    ],
  };

  test("doc to markdown", () => {
    const md = docToMarkdown(doc);
    expect(md).toContain("> [TTL is \\*cached\\*](https://x.test/a#heading-ttl)");
    expect(md).toContain("**Bold** and *it*  \n`code`~~gone~~");
    expect(md).toContain("- a\n  more");
    expect(md).toContain("3. three");
    expect(md).toContain("- [x] done\n- [ ] todo");
    expect(md).toContain("### H");
    expect(md).toContain("---");
    expect(md.endsWith("---")).toBe(true);
    expect(docToMarkdown(null)).toBe("");
  });

  test("one course, grouped by lesson with anchors", () => {
    const md = notesToMarkdown(
      "DNS basics",
      [
        { content: doc, anchor: { kind: "video", seconds: 192 }, updated_at: "", activity: { name: "Resolvers", chapter_name: "Ch 1", url: "https://x.test/l1" } },
        { content: { type: "doc", content: [] }, anchor: { kind: "heading", label: "TTL" }, updated_at: "", activity: { name: "Resolvers", chapter_name: "Ch 1", url: "https://x.test/l1" } },
        { content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "glue" }] }] }, anchor: null, updated_at: "", activity: { name: "Glue [records]" } },
      ],
      { exported: "Exported on", at: (time) => `At ${time}` },
      "Nov 11, 2026",
    );
    expect(md.startsWith("# DNS basics\n\n_Exported on Nov 11, 2026_")).toBe(true);
    expect(md.match(/^## /gm).length).toBe(2);
    expect(md).toContain("## Ch 1 · [Resolvers](https://x.test/l1)");
    expect(md).toContain("**At 03:12**");
    expect(md).toContain("**§ TTL**\n\n_…_");
    expect(md).toContain("## Glue \\[records\\]\n\nglue");
  });
});

describe("note card actions", async () => {
  const { noteMenuActions } = await import("../lib/notes/lessonAnchor.ts");
  const React = (await import("react")).default;
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { default: NoteCardHeader } = await import("../components/Objects/Activities/Notes/NoteCardHeader.tsx");
  const h = React.createElement;

  test("every card gets the same menu; jump only when there is a spot to jump to", () => {
    expect(noteMenuActions(null)).toEqual(["copy", "delete"]);
    expect(noteMenuActions({ kind: "heading", ref: "heading-ttl", label: "TTL" })).toEqual(["jump", "copy", "delete"]);
    expect(noteMenuActions({ kind: "heading", ref: null, label: "TTL" })).toEqual(["copy", "delete"]);
    expect(noteMenuActions({ kind: "video", seconds: 0 })).toEqual(["jump", "copy", "delete"]);
    expect(noteMenuActions({ kind: "video", seconds: null })).toEqual(["copy", "delete"]);
  });

  test("a brand-new note shows its actions menu right away", () => {
    const html = renderToStaticMarkup(h(NoteCardHeader, { anchor: null, updatedLabel: "New", getText: () => "", onDelete: () => {} }));
    expect(html).toContain("data-note-actions");
    expect(html).not.toContain("data-confirm-delete");
  });

  test("delete is confirmed inline in the card", () => {
    const html = renderToStaticMarkup(
      h(NoteCardHeader, { anchor: { kind: "video", seconds: 192 }, getText: () => "x", onDelete: () => {}, initialConfirming: true }),
    );
    expect(html).toContain("data-confirm-delete");
    expect(html).not.toContain("data-note-actions");
    expect((html.match(/<button/g) || []).length).toBe(2);
  });
});
