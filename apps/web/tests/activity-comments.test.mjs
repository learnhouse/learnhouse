import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

// ProseMirror needs a DOM to build an editor view.
const domWindow = new Window({ url: "http://localhost/" });
for (const key of [
  "document",
  "navigator",
  "HTMLElement",
  "Element",
  "Node",
  "Text",
  "DocumentFragment",
  "MutationObserver",
  "Range",
  "Selection",
  "DOMParser",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "CustomEvent",
  "Event",
  "KeyboardEvent",
  "MouseEvent",
  "InputEvent",
  "NodeFilter",
  "DOMException",
]) {
  if (domWindow[key] !== undefined && globalThis[key] === undefined) {
    globalThis[key] = domWindow[key];
  }
}
globalThis.window = domWindow;

const { Editor } = await import("@tiptap/core");
const { default: StarterKit } = await import("@tiptap/starter-kit");
const { Slice } = await import("@tiptap/pm/model");
const {
  default: CommentMark,
  commentHighlightKey,
  filterPastedCommentMarks,
  touchesCommentMarks,
} = await import("../components/Objects/Editor/Comments/CommentMark.ts");
const { collectCommentAnchors, groupThreads, layoutCards } = await import(
  "../components/Objects/Editor/Comments/commentAnchors.ts"
);
const { hasCommentMarks, stripCommentMarks } = await import(
  "../components/Objects/Editor/Comments/commentContent.ts"
);
const { parseInline, mentionedIds, mentionQueryAt, insertMention } = await import(
  "../components/Objects/Editor/Comments/commentFormat.ts"
);
const { findEditorYDoc } = await import(
  "../components/Objects/Editor/Comments/useActivityComments.ts"
);

const comment = (threadId) => ({ type: "comment", attrs: { threadId } });
const text = (t, marks) => (marks ? { type: "text", text: t, marks } : { type: "text", text: t });
const para = (...content) => ({ type: "paragraph", content });
const doc = (...content) => ({ type: "doc", content });

function makeEditor(content, extra = []) {
  return new Editor({
    element: document.createElement("div"),
    extensions: [StarterKit, CommentMark, ...extra],
    content,
  });
}

const thread = (id, status = "open", created_at = "2026-11-09T10:00:00Z") => ({
  thread_uuid: id,
  status,
  created_at,
});

describe("comment mark", () => {
  test("round-trips several overlapping threads through JSON", () => {
    const content = doc(
      para(text("Hello "), text("big", [comment("t1"), comment("t2")]), text(" world", [comment("t1")])),
    );
    const editor = makeEditor(content);
    const json = editor.getJSON();
    const marks = json.content[0].content[1].marks.map((m) => m.attrs.threadId).sort();
    expect(marks).toEqual(["t1", "t2"]);
    expect(json.content[0].content[2].marks).toEqual([comment("t1")]);
    editor.destroy();
  });

  test("is not inclusive: typing at its end does not extend it", () => {
    const editor = makeEditor(doc(para(text("abc", [comment("t1")]))));
    editor.commands.setTextSelection(4); // after "c"
    editor.commands.insertContent("d");
    const nodes = editor.getJSON().content[0].content;
    expect(nodes.map((n) => n.text)).toEqual(["abc", "d"]);
    expect(nodes[1].marks).toBeUndefined();
    editor.destroy();
  });

  test("setComment anchors the selection; unsetComment removes only that thread", () => {
    const editor = makeEditor(doc(para(text("one two three"))));
    editor.commands.setComment("t1", { from: 1, to: 4 });
    editor.commands.setComment("t2", { from: 1, to: 8 });
    expect([...collectCommentAnchors(editor.state.doc).keys()].sort()).toEqual(["t1", "t2"]);
    expect(editor.commands.unsetComment("t1")).toBe(true);
    expect([...collectCommentAnchors(editor.state.doc).keys()]).toEqual(["t2"]);
    expect(editor.commands.unsetComment("nope")).toBe(false);
    // Empty or out-of-range ranges are refused.
    expect(editor.commands.setComment("t3", { from: 3, to: 3 })).toBe(false);
    expect(editor.commands.setComment("", { from: 1, to: 3 })).toBe(false);
    editor.destroy();
  });

  test("highlights only visible threads and marks the active one", () => {
    const editor = makeEditor(
      doc(para(text("open", [comment("t1")]), text(" "), text("resolved", [comment("t2")]))),
    );
    expect(commentHighlightKey.getState(editor.state).deco.find().length).toBe(0);
    editor.commands.setCommentHighlights({ visible: ["t1"], active: "t1" });
    const decos = commentHighlightKey.getState(editor.state).deco.find();
    expect(decos.length).toBe(1);
    expect(decos[0].type.attrs["data-comment-thread"]).toBe("t1");
    expect(decos[0].type.attrs.class).toContain("lh-comment-hl--active");
    // Highlights are view state: the document is untouched and nothing to save.
    expect(editor.getJSON().content[0].content[0].marks).toEqual([comment("t1")]);
    editor.destroy();
  });

  test("overlapping threads get one darker highlight carrying both ids", () => {
    const editor = makeEditor(doc(para(text("a", [comment("t1")]), text("b", [comment("t1"), comment("t2")]))));
    editor.commands.setCommentHighlights({ visible: ["t1", "t2"], active: "t2" });
    const decos = commentHighlightKey.getState(editor.state).deco.find();
    expect(decos.length).toBe(2);
    const both = decos.find((d) => d.from === 2);
    expect(both.type.attrs["data-comment-threads"]).toBe("t1 t2");
    expect(both.type.attrs["data-comment-thread"]).toBe("t2");
    expect(both.type.attrs.class).toContain("lh-comment-hl--overlap");
    expect(both.type.attrs.class).toContain("lh-comment-hl--active");
    expect(decos.find((d) => d.from === 1).type.attrs.class).not.toContain("--overlap");
    editor.destroy();
  });

  test("keeps the pending range mapped while text is typed before it", () => {
    const editor = makeEditor(doc(para(text("abc def"))));
    editor.commands.setCommentHighlights({ pending: { from: 5, to: 8 } });
    editor.commands.insertContentAt(1, "XX");
    expect(commentHighlightKey.getState(editor.state).pending).toEqual({ from: 7, to: 10 });
    editor.commands.setCommentHighlights({ pending: null });
    expect(commentHighlightKey.getState(editor.state).pending).toBeNull();
    editor.destroy();
  });

  test("touchesCommentMarks tells plain typing from comment changes", () => {
    const editor = makeEditor(doc(para(text("abc"))));
    const typing = editor.state.tr.insertText("x", 2);
    expect(touchesCommentMarks(typing)).toBe(false);
    const marking = editor.state.tr.addMark(1, 3, editor.schema.marks.comment.create({ threadId: "t" }));
    expect(touchesCommentMarks(marking)).toBe(true);
    editor.destroy();
  });

  test("pasted comment marks of unknown threads are dropped", () => {
    const editor = makeEditor(doc(para(text("x"))));
    const schema = editor.schema;
    const node = schema.nodeFromJSON(para(text("mine", [comment("t1")]), text("theirs", [comment("tX"), { type: "bold" }])));
    const slice = new Slice(node.content, 0, 0);
    const out = filterPastedCommentMarks(slice, new Set(["t1"]));
    const json = out.content.toJSON();
    expect(json[0].marks).toEqual([comment("t1")]);
    expect(json[1].marks).toEqual([{ type: "bold" }]);
    // Threads not loaded yet: drop them all rather than keep strangers.
    const none = filterPastedCommentMarks(slice, null).content.toJSON();
    expect(none[0].marks).toBeUndefined();
    // No comment marks: the very same slice.
    const plain = new Slice(schema.nodeFromJSON(para(text("plain"))).content, 0, 0);
    expect(filterPastedCommentMarks(plain, null)).toBe(plain);
    editor.destroy();
  });
});

describe("anchor mapping", () => {
  test("spans a thread from its first to its last marked character, across nodes", () => {
    const editor = makeEditor(
      doc(
        para(text("aa"), text("bb", [comment("t1")]), text("cc")),
        para(text("dd", [comment("t1")]), text("ee", [comment("t2")])),
      ),
    );
    const anchors = collectCommentAnchors(editor.state.doc);
    // p(1) a a b b c c (p close 8) p(9) d d e e
    expect(anchors.get("t1")).toEqual({ from: 3, to: 11 });
    expect(anchors.get("t2")).toEqual({ from: 11, to: 13 });
    editor.destroy();
  });

  test("anchors follow edits and vanish when the text is deleted", () => {
    const editor = makeEditor(doc(para(text("keep "), text("gone", [comment("t1")]))));
    editor.commands.insertContentAt(1, ">> ");
    expect(collectCommentAnchors(editor.state.doc).get("t1")).toEqual({ from: 9, to: 13 });
    editor.commands.deleteRange({ from: 9, to: 13 });
    expect(collectCommentAnchors(editor.state.doc).has("t1")).toBe(false);
    editor.destroy();
  });
});

describe("orphan detection", () => {
  test("groups open anchored, detached and resolved threads", () => {
    const anchors = new Map([
      ["b", { from: 20, to: 25 }],
      ["a", { from: 5, to: 9 }],
      ["r1", { from: 1, to: 2 }],
    ]);
    const groups = groupThreads(
      [
        thread("b"),
        thread("orphan2", "open", "2026-11-09T12:00:00Z"),
        thread("a"),
        thread("orphan1", "open", "2026-11-09T11:00:00Z"),
        thread("r2", "resolved", "2026-11-01T00:00:00Z"),
        thread("r1", "resolved"),
      ],
      anchors,
    );
    expect(groups.anchored.map((t) => t.thread_uuid)).toEqual(["a", "b"]);
    expect(groups.detached.map((t) => t.thread_uuid)).toEqual(["orphan1", "orphan2"]);
    // Resolved: anchored ones in document order first, then the rest.
    expect(groups.resolved.map((t) => t.thread_uuid)).toEqual(["r1", "r2"]);
  });

  test("a thread whose text was deleted becomes detached", () => {
    const editor = makeEditor(doc(para(text("x "), text("quote", [comment("t1")]))));
    const before = groupThreads([thread("t1")], collectCommentAnchors(editor.state.doc));
    expect(before.anchored.length).toBe(1);
    editor.commands.deleteRange({ from: 3, to: 8 });
    const after = groupThreads([thread("t1")], collectCommentAnchors(editor.state.doc));
    expect(after.detached.map((t) => t.thread_uuid)).toEqual(["t1"]);
    editor.destroy();
  });

  test("tolerates a missing thread list", () => {
    expect(groupThreads(undefined, new Map())).toEqual({ anchored: [], detached: [], resolved: [] });
  });
});

describe("overlap stacking", () => {
  const box = (id, desired, height = 50) => ({ id, desired, height });

  test("cards sit at their anchors when there is room", () => {
    const tops = layoutCards([box("a", 0), box("b", 100), box("c", 300)], null);
    expect([...tops.values()]).toEqual([0, 100, 300]);
  });

  test("overlapping cards are pushed down, keeping order and the gap", () => {
    const tops = layoutCards([box("a", 0), box("b", 10), box("c", 20)], null, 8);
    expect(tops.get("a")).toBe(0);
    expect(tops.get("b")).toBe(58);
    expect(tops.get("c")).toBe(116);
  });

  test("the active card sits at its anchor; cards above move up, below move down", () => {
    const tops = layoutCards([box("a", 90), box("b", 100), box("c", 110)], "b", 8);
    expect(tops.get("b")).toBe(100);
    expect(tops.get("a")).toBe(100 - 8 - 50);
    expect(tops.get("c")).toBe(158);
  });

  test("an unknown active id falls back to the plain layout", () => {
    const tops = layoutCards([box("a", 0), box("b", 10)], "zzz", 8);
    expect(tops.get("b")).toBe(58);
  });

  test("no cards, no tops", () => {
    expect(layoutCards([], null).size).toBe(0);
  });
});

describe("learner rendering never carries comment marks", () => {
  const stored = doc(
    para(text("Plain "), text("noted", [{ type: "bold" }, comment("t1")]), text(" end", [comment("t2")])),
    { type: "callout", content: [para(text("deep", [comment("t3")]))] },
  );

  test("strips every comment mark without touching other marks or the input", () => {
    const before = JSON.stringify(stored);
    const out = stripCommentMarks(stored);
    expect(JSON.stringify(stored)).toBe(before);
    expect(hasCommentMarks(out)).toBe(false);
    expect(out.content[0].content[1].marks).toEqual([{ type: "bold" }]);
    expect(out.content[0].content[2].marks).toBeUndefined();
    expect(out.content[1].content[0].content[0].text).toBe("deep");
  });

  test("returns the same reference when there is nothing to strip", () => {
    const clean = doc(para(text("x")));
    expect(stripCommentMarks(clean)).toBe(clean);
    expect(stripCommentMarks(null)).toBe(null);
  });

  test("accepts a JSON string (the canvas gets either form)", () => {
    const out = stripCommentMarks(JSON.stringify(stored));
    expect(hasCommentMarks(out)).toBe(false);
    expect(stripCommentMarks('{"type":"comment" broken')).toBe('{"type":"comment" broken');
  });

  test("a renderer schema without the mark loads the stripped doc instead of an empty one", () => {
    // What DynamicCanva / EditorPreview do: no CommentMark in their schema.
    const warn = console.warn;
    console.warn = () => {};
    const naive = new Editor({ element: document.createElement("div"), extensions: [StarterKit], content: stored });
    console.warn = warn;
    // Unstripped, TipTap throws the whole document away.
    expect(naive.getText().trim()).toBe("");
    naive.destroy();

    const learner = new Editor({
      element: document.createElement("div"),
      extensions: [StarterKit],
      content: stripCommentMarks(doc(para(text("Plain "), text("noted", [comment("t1")])))),
    });
    expect(learner.getText()).toBe("Plain noted");
    expect(learner.getHTML()).not.toContain("comment");
    learner.destroy();
  });
});

describe("comment text", () => {
  test("parses markdown-lite and mentions", () => {
    expect(parseInline("hi **bold** and *it* `code` @maya. https://x.io/a, ok")).toEqual([
      { kind: "text", text: "hi " },
      { kind: "bold", text: "bold" },
      { kind: "text", text: " and " },
      { kind: "italic", text: "it" },
      { kind: "text", text: " " },
      { kind: "code", text: "code" },
      { kind: "text", text: " " },
      { kind: "mention", text: "@maya", username: "maya" },
      { kind: "text", text: ". " },
      { kind: "link", text: "https://x.io/a", href: "https://x.io/a" },
      { kind: "text", text: ", ok" },
    ]);
    // An email address is not a mention; markup stays text.
    expect(parseInline("mail a@b.com").some((t) => t.kind === "mention")).toBe(false);
    expect(parseInline("<b>x</b>")).toEqual([{ kind: "text", text: "<b>x</b>" }]);
  });

  test("only picked people still named in the body are mentioned", () => {
    const picked = [
      { id: 3, username: "contrib" },
      { id: 4, username: "teach" },
      { id: 3, username: "contrib" },
    ];
    expect(mentionedIds("cc @Contrib please", picked)).toEqual([3]);
    expect(mentionedIds("nobody", picked)).toEqual([]);
  });

  test("finds the @query at the caret and inserts the pick", () => {
    expect(mentionQueryAt("hello @ma", 9)).toEqual({ query: "ma", start: 6 });
    expect(mentionQueryAt("mail a@b", 8)).toBeNull();
    expect(mentionQueryAt("@", 1)).toEqual({ query: "", start: 0 });
    expect(insertMention("hello @ma!", 6, 9, "maya")).toEqual({ text: "hello @maya !", caret: 12 });
  });
});

describe("live refresh channel", () => {
  test("finds the Y doc through the Collaboration extension", () => {
    const ydoc = { getMap: () => ({}) };
    const fake = (options) => ({ extensionManager: { extensions: [{ name: "collaboration", options }] } });
    expect(findEditorYDoc(fake({ document: ydoc }))).toBe(ydoc);
    expect(findEditorYDoc(fake({ fragment: { doc: ydoc } }))).toBe(ydoc);
    expect(findEditorYDoc({ extensionManager: { extensions: [] } })).toBeNull();
    expect(findEditorYDoc(null)).toBeNull();
  });
});
