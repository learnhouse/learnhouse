import { describe, expect, test } from "bun:test";
import * as Y from "yjs";

// The AI Editor applies proposals on the client as editor transactions. These
// tests check locating a hunk in a document that moved since the proposal,
// minimal replacement (only what differs), reverting, and that with live
// editing (two Yjs clients) the AI change merges with someone else's typing
// instead of overwriting it. Plus the credit estimates the panel shows.

const { Node, getSchema } = await import("@tiptap/core");
const { default: StarterKit } = await import("@tiptap/starter-kit");
const { EditorState } = await import("@tiptap/pm/state");
const { prosemirrorJSONToYDoc, updateYFragment, yXmlFragmentToProseMirrorRootNode } = await import("@tiptap/y-tiptap");
const engine = await import("../components/Objects/Editor/AI/engine/proposals.ts");
const actions = await import("../components/Objects/Editor/AI/engine/actions.ts");
const ghost = await import("../components/Objects/Editor/AI/engine/ghostText.ts");

const BlockQuiz = Node.create({
  name: "blockQuiz",
  group: "block",
  atom: true,
  addAttributes: () => ({ quizId: { default: null }, questions: { default: [] } }),
});
const schema = getSchema([StarterKit, BlockQuiz]);

const p = (text) => ({ type: "paragraph", content: text ? [{ type: "text", text }] : [] });
const h = (level, text) => ({ type: "heading", attrs: { level }, content: [{ type: "text", text }] });
const doc = (...content) => ({ type: "doc", content });
const stateOf = (json) => EditorState.create({ schema, doc: schema.nodeFromJSON(json) });
const texts = (state) => {
  const out = [];
  state.doc.forEach((n) => out.push(n.textContent));
  return out;
};

const BASE = doc(h(2, "Water"), p("Water moves between oceans and air."), p("The sun heats the sea."), p("Clouds form."));

function replaceHunk(index, beforeJson, afterJson, extra = {}) {
  return { id: "h1", kind: "replace", index, before: [beforeJson], after: [afterJson], prev: null, next: null, ...extra };
}

describe("locating hunks", () => {
  test("finds the block at its old index", () => {
    const state = stateOf(BASE);
    const hunk = replaceHunk(2, p("The sun heats the sea."), p("Sunlight warms the sea."));
    const at = engine.locateHunk(state.doc, hunk, schema);
    expect(at.index).toBe(2);
    expect(at.from).toBe(engine.posOfIndex(state.doc, 2));
  });

  test("follows the block when content was added above it", () => {
    const state = stateOf(doc(p("A new intro someone typed."), ...BASE.content));
    const hunk = replaceHunk(2, p("The sun heats the sea."), p("Sunlight warms the sea."));
    expect(engine.locateHunk(state.doc, hunk, schema).index).toBe(3);
  });

  test("whitespace and case do not break the match", () => {
    const state = stateOf(doc(p("The  sun heats THE sea. ")));
    expect(engine.locateHunk(state.doc, replaceHunk(0, p("The sun heats the sea."), p("x")), schema)).not.toBeNull();
  });

  test("returns null when the block was edited since", () => {
    const state = stateOf(doc(h(2, "Water"), p("Water moves."), p("The sun heats the whole sea."), p("Clouds form.")));
    expect(engine.locateHunk(state.doc, replaceHunk(2, p("The sun heats the sea."), p("x")), schema)).toBeNull();
  });

  test("picks the nearest of several identical blocks", () => {
    const state = stateOf(doc(p("Same"), p("Other"), p("Same"), p("Other"), p("Same")));
    expect(engine.locateHunk(state.doc, replaceHunk(3, p("Same"), p("x")), schema).index).toBe(2);
    expect(engine.locateHunk(state.doc, replaceHunk(4, p("Same"), p("x")), schema).index).toBe(4);
  });

  test("inserts go after their previous block, else before the next one", () => {
    const state = stateOf(doc(p("Intro"), ...BASE.content));
    const ins = { id: "h2", kind: "insert", index: 2, before: [], after: [p("New")], prev: p("Water moves between oceans and air."), next: p("The sun heats the sea.") };
    expect(engine.locateHunk(state.doc, ins, schema).index).toBe(3);
    const noPrev = { ...ins, prev: p("gone") };
    expect(engine.locateHunk(state.doc, noPrev, schema).index).toBe(3);
    const start = { ...ins, index: 0, prev: null, next: p("gone") };
    expect(engine.locateHunk(state.doc, start, schema).index).toBe(0);
    const end = { ...ins, index: 9, prev: p("gone"), next: null };
    expect(engine.locateHunk(state.doc, end, schema).from).toBe(state.doc.content.size);
    const lost = { ...ins, prev: p("gone"), next: p("also gone") };
    expect(engine.locateHunk(state.doc, lost, schema).approximate).toBe(true);
  });

  test("an insert anchored on a block another hunk rewrote finds the new text through aliases", () => {
    const rewrite = replaceHunk(1, p("Water moves between oceans and air."), p("Water travels."));
    const ins = { id: "h2", kind: "insert", index: 2, before: [], after: [p("Extra")], prev: p("Water moves between oceans and air."), next: p("gone") };
    let state = stateOf(BASE);
    state = state.apply(engine.hunkTransaction(state, rewrite).tr);
    const aliases = new Map();
    engine.addAliases(aliases, rewrite, schema);
    const at = engine.locateHunk(state.doc, ins, schema, { aliases });
    expect(at.index).toBe(2);
    expect(at.approximate).toBe(false);
  });
});

describe("applying as editor transactions", () => {
  test("only the differing range is replaced", () => {
    const state = stateOf(BASE);
    const hunk = replaceHunk(2, p("The sun heats the sea."), p("The sun warms the sea."));
    const { tr } = engine.hunkTransaction(state, hunk);
    expect(tr.getMeta(engine.AI_ORIGIN_META)).toBe("ai");
    expect(tr.steps.length).toBe(1);
    const step = tr.steps[0].toJSON();
    const paraStart = engine.posOfIndex(state.doc, 2) + 1;
    // "The sun " is kept: the step starts inside the paragraph, after it.
    expect(step.from).toBe(paraStart + "The sun ".length);
    expect(step.to).toBe(paraStart + "The sun heat".length);
    expect(texts(state.apply(tr))[2]).toBe("The sun warms the sea.");
  });

  test("replace, delete and insert hunks change the document", () => {
    let state = stateOf(BASE);
    const del = { id: "d", kind: "delete", index: 3, before: [p("Clouds form.")], after: [], prev: null, next: null };
    state = state.apply(engine.hunkTransaction(state, del).tr);
    expect(texts(state)).toEqual(["Water", "Water moves between oceans and air.", "The sun heats the sea."]);
    const ins = { id: "i", kind: "insert", index: 1, before: [], after: [p("First"), p("Second")], prev: h(2, "Water"), next: null };
    state = state.apply(engine.hunkTransaction(state, ins).tr);
    expect(texts(state).slice(0, 3)).toEqual(["Water", "First", "Second"]);
  });

  test("a type change (paragraph to heading) replaces the block", () => {
    const state = stateOf(BASE);
    const { tr } = engine.hunkTransaction(state, replaceHunk(3, p("Clouds form."), h(3, "Clouds form.")));
    const next = state.apply(tr);
    expect(next.doc.child(3).type.name).toBe("heading");
  });

  test("an identical hunk is a no-op", () => {
    const state = stateOf(BASE);
    expect(engine.hunkTransaction(state, replaceHunk(3, p("Clouds form."), p("Clouds form.")))).toBeNull();
  });

  test("deleting every block leaves one empty paragraph", () => {
    const state = stateOf(doc(p("Only")));
    const next = state.apply(engine.hunkTransaction(state, { id: "d", kind: "delete", index: 0, before: [p("Only")], after: [], prev: null, next: null }).tr);
    expect(next.doc.childCount).toBe(1);
    expect(next.doc.child(0).type.name).toBe("paragraph");
  });

  test("revert puts the original back", () => {
    let state = stateOf(BASE);
    const hunk = replaceHunk(2, p("The sun heats the sea."), p("Sunlight warms the whole sea."));
    state = state.apply(engine.hunkTransaction(state, hunk).tr);
    state = state.apply(engine.hunkTransaction(state, hunk, { direction: "revert" }).tr);
    expect(state.doc.eq(stateOf(BASE).doc)).toBe(true);
  });

  test("model output with unknown marks or nodes still loads", () => {
    const odd = { type: "paragraph", content: [{ type: "text", text: "Bold-ish", marks: [{ type: "sparkle" }, { type: "bold" }] }] };
    const node = engine.nodeFromJSON(odd, schema);
    expect(node.textContent).toBe("Bold-ish");
    expect(node.firstChild.marks.map((m) => m.type.name)).toEqual(["bold"]);
    const unknown = engine.nodeFromJSON({ type: "mysteryBlock", content: [{ type: "text", text: "kept text" }] }, schema);
    expect(unknown.type.name).toBe("paragraph");
    expect(unknown.textContent).toBe("kept text");
    expect(engine.nodeFromJSON({ type: "mysteryBlock" }, schema)).toBeNull();
  });

  test("atom blocks match by their settings, not volatile ids", () => {
    const quiz = { type: "blockQuiz", attrs: { quizId: "q1", questions: [{ question: "Why?" }] } };
    const live = stateOf(doc(p("x"), { ...quiz, attrs: { ...quiz.attrs, quizId: "other" } }));
    const at = engine.locateHunk(live.doc, { id: "q", kind: "delete", index: 1, before: [quiz], after: [], prev: null, next: null }, schema);
    expect(at.index).toBe(1);
  });

  test("insertAtHunk places ready blocks (generated images) where the hunk goes", () => {
    const state = stateOf(BASE);
    const hunk = { id: "img", kind: "image", index: 2, before: [], after: [], prev: p("Water moves between oceans and air."), next: null, prompt: "a cloud" };
    const tr = engine.insertAtHunk(state, hunk, [schema.nodes.paragraph.create(null, schema.text("IMG"))]);
    expect(texts(state.apply(tr))[2]).toBe("IMG");
  });

  test("hunkText gives readable text for previews", () => {
    expect(engine.hunkText([h(2, "A"), p("B")], schema)).toBe("A\n\nB");
  });
});

describe("live editing: two Yjs clients", () => {
  // Each client's document lives in a Y.Doc; editor states are synced to it
  // with updateYFragment, the same diffing the collaboration binding uses.
  function client(ydoc) {
    const frag = ydoc.getXmlFragment("default");
    const read = () => EditorState.create({ schema, doc: yXmlFragmentToProseMirrorRootNode(frag, schema) });
    const write = (state) => ydoc.transact(() => updateYFragment(ydoc, frag, state.doc, { mapping: new Map(), isOMark: new Map() }), "local");
    return { read, write };
  }
  function pair(json) {
    const a = prosemirrorJSONToYDoc(schema, json, "default");
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    return [a, b];
  }
  const sync = (a, b) => {
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
  };

  test("an AI change and someone else's edit in another block both survive", () => {
    const [ya, yb] = pair(BASE);
    const A = client(ya);
    const B = client(yb);
    // A accepts an AI rewrite of block 2 while B, offline from A, types in block 3.
    const sa = A.read();
    A.write(sa.apply(engine.hunkTransaction(sa, replaceHunk(2, p("The sun heats the sea."), p("Sunlight warms the sea."))).tr));
    const sb = B.read();
    B.write(sb.apply(sb.tr.insertText(" Rain falls.", engine.posOfIndex(sb.doc, 3) + 1 + "Clouds form.".length)));
    sync(ya, yb);
    expect(texts(A.read())).toEqual(texts(B.read()));
    expect(texts(A.read())[2]).toBe("Sunlight warms the sea.");
    expect(texts(A.read())[3]).toBe("Clouds form. Rain falls.");
  });

  test("an edit in the untouched part of the same paragraph survives too", () => {
    const [ya, yb] = pair(BASE);
    const A = client(ya);
    const B = client(yb);
    const sa = A.read();
    // The AI only changes the end of the paragraph ("air." -> "the sky.")...
    A.write(sa.apply(engine.hunkTransaction(sa, replaceHunk(1, p("Water moves between oceans and air."), p("Water moves between oceans and the sky."))).tr));
    // ...while B fixes the start of it.
    const sb = B.read();
    B.write(sb.apply(sb.tr.insertText("Fresh ", engine.posOfIndex(sb.doc, 1) + 1)));
    sync(ya, yb);
    expect(texts(A.read())[1]).toBe("Fresh Water moves between oceans and the sky.");
    expect(texts(B.read())[1]).toBe("Fresh Water moves between oceans and the sky.");
  });

  test("a proposal made before someone added blocks still lands on the right block", () => {
    const [ya, yb] = pair(BASE);
    const A = client(ya);
    const B = client(yb);
    const sb = B.read();
    B.write(sb.apply(sb.tr.insert(0, schema.nodes.paragraph.create(null, schema.text("Added by B")))));
    sync(ya, yb);
    const sa = A.read();
    const res = engine.hunkTransaction(sa, replaceHunk(3, p("Clouds form."), p("Clouds form high up.")));
    expect(res.located.index).toBe(4);
    A.write(sa.apply(res.tr));
    sync(ya, yb);
    expect(texts(B.read())).toEqual(["Added by B", "Water", "Water moves between oceans and air.", "The sun heats the sea.", "Clouds form high up."]);
  });
});

describe("credits", () => {
  test("a message or action costs one turn; images cost more only when generated", () => {
    const costs = actions.costsOf({ turn: 3, image: 5, complete: 1 });
    expect(actions.estimateCredits(null, costs)).toEqual({ now: 3, perItem: 0 });
    expect(actions.estimateCredits("shorten", costs)).toEqual({ now: 3, perItem: 0 });
    expect(actions.estimateCredits("images", costs)).toEqual({ now: 3, perItem: 5 });
    expect(actions.acceptCredits([{ kind: "image" }, { kind: "replace" }, { kind: "image" }], costs)).toBe(10);
    expect(actions.isExpensive(3)).toBe(false);
    expect(actions.isExpensive(10)).toBe(true);
  });

  test("bad cost values fall back to the defaults", () => {
    expect(actions.costsOf(null)).toEqual(actions.DEFAULT_COSTS);
    expect(actions.costsOf({ turn: -1, image: "x", complete: 2 })).toEqual({ turn: 3, image: 5, complete: 2 });
  });

  test("every action belongs to a group and ids are unique", () => {
    const ids = actions.QUICK_ACTIONS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(actions.groupedActions().flatMap((g) => g.actions).length).toBe(ids.length);
    expect(actions.actionById("translate").param).toBe("language");
  });

  test("suggestions fit the page: selection edits, writing help, or page tasks", () => {
    expect(actions.suggestedActions({ hasSelection: true, textLength: 2000, headings: 3 })[0]).toBe("improve");
    expect(actions.suggestedActions({ hasSelection: false, textLength: 40, headings: 2 })[0]).toBe("draft_section");
    expect(actions.suggestedActions({ hasSelection: false, textLength: 40, headings: 0 })[0]).toBe("continue");
    const page = actions.suggestedActions({ hasSelection: false, textLength: 4000, headings: 3 });
    expect(page.length).toBeLessThanOrEqual(6);
    expect(page.every((id) => actions.actionById(id))).toBe(true);
  });
});

describe("ghost text", () => {
  test("suggests only at the end of a long enough paragraph", () => {
    const { TextSelection } = require("@tiptap/pm/state");
    let state = stateOf(doc(p("A long enough sentence to continue from here")));
    const end = state.doc.child(0).nodeSize - 1;
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, end)));
    expect(ghost.suggestionSpot(state, 10)).toBe(end);
    expect(ghost.suggestionSpot(state, 200)).toBeNull();
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 3)));
    expect(ghost.suggestionSpot(state, 10)).toBeNull();
  });
});

describe("carrying formatting onto rewritten text (selection menu)", () => {
  test("comments, spoilers and links stay on surviving words; lost ones are reported", async () => {
    const { carryMarks } = await import("../components/Objects/Editor/AI/engine/carryMarks.ts");
    const comment = { type: "comment", attrs: { threadId: "thread_1" } };
    const prev = [
      { type: "text", text: "Records are cached for their " },
      { type: "text", text: "TTL", marks: [comment] },
      { type: "text", text: ". The answer is " },
      { type: "text", text: "an A record", marks: [{ type: "spoiler" }] },
      { type: "text", text: " and " },
      { type: "text", text: "TTL", marks: [{ type: "italic" }] },
      { type: "text", text: " again. " },
      { type: "text", text: "Shiny tip", marks: [{ type: "textEffect", attrs: { effect: "glow" } }] },
    ];
    const { nodes, lost } = carryMarks(prev, [{ type: "text", text: "DNS records stay cached for their TTL; the answer is an A record, see TTL." }]);
    const marked = (type) => nodes.filter((n) => (n.marks || []).some((m) => m.type === type)).map((n) => n.text);
    expect(marked("comment")).toEqual(["TTL"]);
    expect(marked("spoiler")).toEqual(["an A record"]);
    expect(marked("italic")).toEqual(["TTL"]);
    // The comment sits on the first TTL, the italic on the second, as before.
    expect(nodes.findIndex((n) => (n.marks || []).some((m) => m.type === "comment"))).toBeLessThan(nodes.findIndex((n) => (n.marks || []).some((m) => m.type === "italic")));
    expect(lost).toEqual(["textEffect"]);
    expect(nodes.map((n) => n.text).join("")).toBe("DNS records stay cached for their TTL; the answer is an A record, see TTL.");
  });

  test("inline atoms and code are kept as they are", async () => {
    const { carryMarks } = await import("../components/Objects/Editor/AI/engine/carryMarks.ts");
    const { nodes } = carryMarks(
      [{ type: "text", text: "run", marks: [{ type: "bold" }] }],
      [{ type: "text", text: "Now " }, { type: "hardBreak" }, { type: "text", text: "run", marks: [{ type: "code" }] }, { type: "text", text: " it, run" }]
    );
    expect(nodes[1]).toEqual({ type: "hardBreak" });
    expect(nodes.find((n) => n.text === "run" && n.marks?.[0]?.type === "code")).toBeTruthy();
  });
});
