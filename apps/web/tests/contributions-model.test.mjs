import { describe, expect, test } from "bun:test";

// Course contributions on the learner page: block fingerprints must match the
// API's (services/courses/contributions/blocks.py), drafts carry what the API
// needs, credits land on the right rendered block, and the registry decides
// how each block type is edited.

const m = await import("../components/Objects/Contributions/contributionModel.ts");
const reg = await import("../components/Objects/Contributions/blockRegistry.ts");

const p = (text) => ({ type: "paragraph", content: text ? [{ type: "text", text }] : [] });
const h = (text) => ({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text }] });

describe("fingerprint (same as the API)", () => {
  test("text blocks: type + normalized text", () => {
    expect(m.fingerprint(p("  Hello\n  World "))).toBe("paragraph|hello world");
    expect(m.fingerprint(h("Title"))).toBe("heading|title");
  });
  test("nested text joins without separators", () => {
    const list = { type: "bulletList", content: [{ type: "listItem", content: [p("one")] }, { type: "listItem", content: [p("two")] }] };
    expect(m.fingerprint(list)).toBe("bulletList|onetwo");
  });
  test("atoms: stable attrs, ids ignored", () => {
    const img = { type: "blockImage", attrs: { id: "x", size: { width: 300 }, alt: "" } };
    expect(m.fingerprint(img)).toBe('blockImage|#[["size",{"width":300}]]');
    expect(m.fingerprint({ type: "horizontalRule" })).toBe("horizontalRule|#");
    expect(m.fingerprint(null)).toBe("?|");
  });
});

describe("drafts", () => {
  const blocks = [h("Intro"), p("The sky is green."), p("Water boils.")];
  test("replace", () => {
    const d = m.buildDraft(blocks, 1, 2, [p("The sky is blue."), p("")], 3, "  fix ");
    expect(d).toEqual({ base_version: 3, start_index: 1, before: [blocks[1]], after: [p("The sky is blue.")], note: "fix" });
  });
  test("insert carries the previous block's fingerprint", () => {
    expect(m.buildDraft(blocks, 3, 3, [p("End")], 3).prev_fp).toBe("paragraph|water boils.");
    expect(m.buildDraft(blocks, 0, 0, [p("Top")], 3).prev_fp).toBe("");
  });
  test("sameBlocks ignores null attrs and key order", () => {
    expect(m.sameBlocks([{ type: "paragraph", attrs: { textAlign: null }, content: [] }], [{ content: [], type: "paragraph" }])).toBe(true);
    expect(m.sameBlocks([p("a")], [p("b")])).toBe(false);
  });
});

describe("credits on the rendered page", () => {
  test("by fingerprint, nearest the hint, else by index", () => {
    const blocks = [p("a"), p("b"), p("a")];
    const map = m.creditIndexes(blocks, [
      { block_index: 2, block_fp: "paragraph|a" },
      { block_index: 1, block_fp: "paragraph|zzz" },
      { block_index: 9, block_fp: "paragraph|gone" },
    ]);
    expect([...map.entries()]).toEqual([[2, 0], [1, 1]]);
  });
});

describe("changes for the preview", () => {
  const text = reg.textBlockTypes();
  test("text diff", () => {
    const [c] = m.blockChanges([p("The sky is green.")], [p("The sky is blue.")], text);
    expect(c.kind).toBe("text");
    expect(c.parts.filter((x) => x.kind !== "same").map((x) => x.text.trim())).toEqual(["green.", "blue."]);
  });
  test("added, removed, replaced, unchanged, format only", () => {
    const quiz = { type: "blockQuiz", attrs: { questions: [1] } };
    const quiz2 = { type: "blockQuiz", attrs: { questions: [2] } };
    expect(m.blockChanges([], [p("x")], text)[0].kind).toBe("added");
    expect(m.blockChanges([p("x")], [], text)[0].kind).toBe("removed");
    expect(m.blockChanges([quiz], [quiz2], text)[0].kind).toBe("replaced");
    expect(m.blockChanges([quiz], [quiz], text)[0].kind).toBe("text");
    const bold = { type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "bold" }] }] };
    const [c] = m.blockChanges([p("x")], [bold], text);
    expect(m.formatOnly(c, p("x"), bold)).toBe(true);
  });
  test("readable text keeps line breaks between blocks", () => {
    const list = { type: "bulletList", content: [{ type: "listItem", content: [p("one")] }, { type: "listItem", content: [p("two")] }] };
    expect(m.readableText(list)).toBe("one\ntwo");
    expect(m.readableText({ type: "paragraph", content: [{ type: "text", text: "a" }, { type: "hardBreak" }, { type: "text", text: "b" }] })).toBe("a\nb");
  });
});

describe("block registry", () => {
  test("text, block, none, and unknown types", () => {
    expect(reg.blockConfig("paragraph").mode).toBe("text");
    expect(reg.blockConfig("blockQuiz")).toEqual({ mode: "block", label: "quiz" });
    expect(reg.blockConfig("conditionalBlock").mode).toBe("none");
    expect(reg.blockConfig("blockEmbed").mode).toBe("none");
    expect(reg.blockConfig("blockMagic").mode).toBe("none");
    expect(reg.blockConfig("someFutureBlock")).toEqual({ mode: "block", label: "block" });
  });
  test("new blocks plug in", () => {
    reg.registerContributionBlock("experienceSort", { mode: "block", label: "sort" });
    expect(reg.blockConfig("experienceSort").label).toBe("sort");
    expect(m.isTextOnly([p("a"), h("b")], reg.textBlockTypes())).toBe(true);
    expect(m.isTextOnly([p("a"), { type: "blockQuiz" }], reg.textBlockTypes())).toBe(false);
  });
});
