import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { Window } from "happy-dom";

// The collab server seeds rooms from stored activity JSON without knowing the
// editor schema (apps/collab/src/prosemirrorY.ts). This checks, against the
// editor's REAL schema, that every stored fixture and a document holding every
// block loads into the editor from such a room without losing anything, and
// that the server encodes exactly like the editor's own Yjs binding does.

const domWindow = new Window({ url: "http://localhost/" });
for (const key of [
  "document", "navigator", "HTMLElement", "Element", "Node", "Text", "DocumentFragment",
  "MutationObserver", "Range", "Selection", "DOMParser", "getComputedStyle",
  "requestAnimationFrame", "cancelAnimationFrame", "CustomEvent", "Event", "KeyboardEvent",
  "MouseEvent", "InputEvent", "NodeFilter", "DOMException", "localStorage", "sessionStorage",
]) {
  if (domWindow[key] !== undefined && globalThis[key] === undefined) globalThis[key] = domWindow[key];
}
globalThis.window = domWindow;

const Y = await import("yjs");
const { getSchema } = await import("@tiptap/core");
const { yXmlFragmentToProseMirrorRootNode, prosemirrorJSONToYXmlFragment } = await import("@tiptap/y-tiptap");
const { default: StarterKit } = await import("@tiptap/starter-kit");
// The editor's real table nodes (stock nodes extended by Editor Plus).
const { createTableNodes } = await import("../components/Objects/Editor/Extensions/Plus/tables/tableNodes.ts");
// Editor Plus layout blocks (tabs, columns, accordion, timeline, toc, key takeaways, checklist).
const { createLayoutNodes } = await import("../components/Objects/Editor/Extensions/Plus/layout/layoutNodes.ts");
// Editor Plus media and data blocks (gallery, image compare, chart, stats, file card, quote).
const { createMediaNodes } = await import("../components/Objects/Editor/Extensions/Plus/media/mediaNodes.ts");
// Editor Plus block upgrades (button group, inline math, text alignment).
const { createUpgradeNodes } = await import("../components/Objects/Editor/Extensions/Plus/upgrades/upgradeNodes.ts");
const { default: Youtube } = await import("@tiptap/extension-youtube");
const { getLinkExtension } = await import("../components/Objects/Editor/EditorConf.ts");
const Blocks = await import("../components/Objects/Editor/Blocks/extensions");
const { default: CommentMark } = await import("../components/Objects/Editor/Comments/CommentMark.ts");
const { default: AIStreamingMark } = await import("../components/Objects/Editor/Extensions/AIStreaming/AIStreamingMark");
const { CommunityTag } = await import("../components/Objects/Communities/Tags/CommunityTag");

// The collab server's converter. It lives in apps/collab and uses that app's
// copy of yjs, so documents cross over as encoded updates (as on the wire).
// The collab app's own packages are installed only where the collab app is
// (not in the web-only CI job); without them these checks have nothing to load.
const HAS_COLLAB = existsSync(new URL("../../collab/node_modules/yjs", import.meta.url));
const server = HAS_COLLAB ? await import("../../collab/src/prosemirrorY.ts") : null;

const ext = (path) => import(`../components/Objects/Editor/Extensions/${path}`).then((m) => m.default);
const BLOCK_EXTENSIONS = await Promise.all([
  "Callout/Callout", "Callout/Info/InfoCallout", "Callout/Warning/WarningCallout", "Image/ImageBlock",
  "Video/VideoBlock", "Audio/AudioBlock", "MathEquation/MathEquationBlock", "PDF/PDFBlock", "H5P/H5PBlock",
  "Library/LibraryBlock", "Quiz/QuizBlock", "EmbedObjects/EmbedObjects", "Badges/Badges", "Buttons/Buttons",
  "Users/UserBlock", "WebPreview/WebPreview", "Flipcard/Flipcard", "Flipcard/FlipcardGrid", "Scenarios/Scenarios",
  "CodePlayground/CodePlayground", "MagicBlocks/MagicBlock", "Dynamic/ConditionalBlock", "Dynamic/DynamicVariable",
  // Experiences family (same list as Extensions/Experiences/extensions.ts).
  "Experiences/Sort/Sort", "Experiences/Sequence/Sequence", "Experiences/Match/Match", "Experiences/Hotspot/Hotspot",
  "Experiences/Gaps/Gaps", "Experiences/MythFact/MythFact", "Experiences/SpeedRound/SpeedRound",
  "Experiences/Estimate/Estimate", "Experiences/SpotMistake/SpotMistake", "Experiences/CodeLock/CodeLock",
  "Experiences/Venn/Venn", "Experiences/Label/Label", "Experiences/WordGuess/WordGuess",
  "Experiences/Confidence/Confidence", "Experiences/Matrix/Matrix", "Experiences/Reflect/Reflect",
].map(ext));

// Same schema-defining extensions as Editor.tsx (plugins-only ones left out)
const schema = getSchema([
  StarterKit.configure({ codeBlock: false, link: false, undoRedo: false }),
  ...BLOCK_EXTENSIONS,
  Youtube,
  Blocks.LHCodeBlock,
  Blocks.ToggleBlock,
  Blocks.DividerStyle,
  Blocks.TableControls,
  ...createTableNodes({ mode: "editor" }),
  ...createLayoutNodes({ mode: "editor" }),
  ...createMediaNodes({ mode: "editor" }),
  ...createUpgradeNodes({ mode: "editor" }),
  getLinkExtension(),
  CommunityTag,
  AIStreamingMark,
  CommentMark,
]);

const fixtures = JSON.parse(
  readFileSync(new URL("../../collab/tests/fixtures/activities.json", import.meta.url), "utf8"),
);

const p = (text, marks) => ({ type: "paragraph", content: [{ type: "text", text, ...(marks ? { marks } : {}) }] });

const EVERY_BLOCK = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Title" }] },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "plain " },
        { type: "text", text: "bold", marks: [{ type: "bold" }] },
        { type: "text", text: "italic", marks: [{ type: "italic" }, { type: "strike" }] },
        { type: "text", text: "code", marks: [{ type: "code" }] },
        { type: "text", text: "link", marks: [{ type: "link", attrs: { href: "https://example.com", target: "_blank" } }] },
        { type: "hardBreak" },
        { type: "text", text: "two threads", marks: [{ type: "comment", attrs: { threadId: "thread_a" } }, { type: "comment", attrs: { threadId: "thread_b" } }] },
        { type: "text", text: " one thread", marks: [{ type: "comment", attrs: { threadId: "thread_a" } }] },
      ],
    },
    { type: "blockquote", content: [p("Quote")] },
    { type: "bulletList", content: [{ type: "listItem", content: [p("one")] }, { type: "listItem", content: [p("two")] }] },
    { type: "orderedList", attrs: { start: 3 }, content: [{ type: "listItem", content: [p("three")] }] },
    { type: "codeBlock", attrs: { language: "python" }, content: [{ type: "text", text: "print('hi')" }] },
    { type: "horizontalRule" },
    { type: "callout", attrs: { type: "tip" }, content: [p("A tip")] },
    { type: "callout", attrs: { type: "warning" }, content: [{ type: "text", text: "legacy callout text" }] },
    { type: "calloutInfo", content: [{ type: "text", text: "info" }] },
    { type: "calloutWarning", content: [{ type: "text", text: "warning" }] },
    {
      type: "table",
      content: [
        { type: "tableRow", content: [{ type: "tableHeader", content: [p("H")] }, { type: "tableHeader", content: [p("H2")] }] },
        { type: "tableRow", content: [{ type: "tableCell", content: [p("a")] }, { type: "tableCell", content: [p("b")] }] },
      ],
    },
    {
      type: "table",
      attrs: { variant: "striped", caption: "Progress", sortable: true, stickyHeader: true, totals: "average" },
      content: [
        { type: "tableRow", content: [{ type: "tableHeader", content: [p("Task")] }, { type: "tableHeader", content: [p("Done")] }, { type: "tableHeader", content: [p("Progress")] }] },
        {
          type: "tableRow",
          content: [
            { type: "tableCell", attrs: { background: "blue", valign: "middle" }, content: [p("Docs")] },
            { type: "tableCell", attrs: { cellType: "checkbox", align: "center" }, content: [p("yes")] },
            { type: "tableCell", attrs: { cellType: "progress", tone: "teal" }, content: [p("75")] },
          ],
        },
        {
          type: "tableRow",
          content: [
            { type: "tableCell", content: [p("Quiz")] },
            { type: "tableCell", attrs: { cellType: "number", numberFormat: "currency", currency: "EUR" }, content: [p("12.5")] },
            { type: "tableCell", attrs: { cellType: "status", tone: "red" }, content: [p("Blocked")] },
          ],
        },
      ],
    },
    // Editor Plus layout blocks: containers hold ordinary blocks.
    {
      type: "tabs",
      attrs: { blockId: "tabs_1", variant: "pills" },
      content: [
        { type: "tabItem", attrs: { title: "Overview" }, content: [p("Big picture")] },
        { type: "tabItem", content: [{ type: "columns", attrs: { layout: "1-2", gap: "lg", stackOnMobile: false, verticalAlign: "center" }, content: [{ type: "column", content: [p("a")] }, { type: "column", content: [p("b")] }] }] },
      ],
    },
    { type: "accordion", attrs: { single: false, variant: "filled" }, content: [{ type: "toggleBlock", attrs: { summary: "Why?" }, content: [p("Because")] }] },
    {
      type: "timeline",
      attrs: { variant: "process", numbered: false, orientation: "horizontal" },
      content: [{ type: "timelineItem", attrs: { title: "Plan", label: "Week 1", tone: "blue", icon: "flag" }, content: [p("Plan it")] }, { type: "timelineItem", content: [p("Do it")] }],
    },
    { type: "tableOfContents", attrs: { title: "On this page", maxLevel: 2, numbered: true } },
    { type: "keyTakeaways", attrs: { title: "Remember", tone: "teal", icon: "star" }, content: [{ type: "bulletList", content: [{ type: "listItem", content: [p("one")] }] }] },
    { type: "taskList", attrs: { blockId: "check_1", learnerCanCheck: false }, content: [{ type: "taskItem", attrs: { checked: true }, content: [p("done")] }, { type: "taskItem", content: [p("todo")] }] },
    // Editor Plus media and data blocks: list-like attrs are JSON values.
    {
      type: "gallery",
      attrs: {
        blockId: "gal_1",
        layout: "carousel",
        columns: 2,
        images: [
          { id: "img_1", url: "https://images.example.com/a.jpg", caption: "Dawn", alt: "A coast" },
          { id: "img_2", blockObject: { block_uuid: "block_g2", block_type: "BLOCK_IMAGE", content: { file_id: "f2", file_format: "png", activity_uuid: "act_1" } }, alt: "Tide pool" },
        ],
      },
    },
    { type: "imageCompare", attrs: { before: { url: "https://images.example.com/b.jpg", label: "1990" }, after: { url: "https://images.example.com/c.jpg", label: "2020", alt: "Forest" }, start: 35, orientation: "vertical" } },
    {
      type: "chart",
      attrs: { type: "line", title: "Scores", data: { labels: ["Q1", "Q2"], series: [{ name: "A", values: [60, 72], tone: "blue" }, { name: "B", values: [58, 70], tone: null }] }, showLegend: false, showValues: true, stacked: true },
    },
    { type: "statHighlights", attrs: { items: [{ id: "s1", value: "92", label: "Completion", suffix: "%", tone: "teal" }, { id: "s2", value: "4.8", label: "Rating", description: "of 5" }], columns: 2, animate: false } },
    { type: "fileCard", attrs: { blockObject: { block_uuid: "block_pdf", block_type: "BLOCK_DOCUMENT_PDF", content: { file_id: "f", file_format: "pdf" } }, url: null, name: "Guide.pdf", description: "Print it", sizeBytes: 2048, fileType: "pdf" } },
    { type: "quoteBlock", attrs: { variant: "testimonial", author: "Sam", role: "Designer", avatarUrl: "https://images.example.com/s.jpg" }, content: [p("It clicked."), p("Used it the next day.")] },
    { type: "blockQuiz", attrs: { quizId: "quiz_1", questions: [{ question_id: "q1", question: "Why?", answers: [{ answer_id: "a1", answer: "Because", correct: true }] }] } },
    // Editor Plus block upgrades: new attrs on existing blocks, the button group and inline math.
    { type: "heading", attrs: { level: 3, textAlign: "center" }, content: [{ type: "text", text: "Centered" }] },
    { type: "paragraph", attrs: { textAlign: "justify" }, content: [{ type: "text", text: "Area " }, { type: "inlineMath", attrs: { latex: "\\pi r^2" } }, { type: "text", text: " units" }] },
    { type: "codeBlock", attrs: { language: "js", filename: "a.js", showLineNumbers: true, highlightLines: "1,3-4", wrap: true }, content: [{ type: "text", text: "a\nb\nc\nd" }] },
    { type: "callout", attrs: { type: "info", kind: "question", title: "Think", collapsible: true, defaultOpen: false, tone: "purple" }, content: [p("Why?")] },
    { type: "toggleBlock", attrs: { summary: "More", variant: "filled", icon: "plus" }, content: [p("Hidden")] },
    { type: "blockImage", attrs: { blockObject: null, size: { width: 420 }, alignment: "center", frame: "polaroid" } },
    {
      type: "buttonGroup",
      attrs: { alignment: "center" },
      content: [
        { type: "button", attrs: { link: "https://example.com", color: "teal" }, content: [{ type: "text", text: "Start" }] },
        { type: "button", attrs: { variant: "outline", size: "lg" }, content: [{ type: "text", text: "Docs" }] },
      ],
    },
    {
      type: "blockQuiz",
      attrs: {
        quizId: "quiz_2",
        settings: { passMark: 70, showExplanations: false },
        questions: [
          { question_id: "q2", question: "Sky is blue", type: "true_false", response_type: "single", explanation: "Rayleigh", answers: [{ answer_id: "t", answer: "True", correct: true }, { answer_id: "f", answer: "False", correct: false }] },
          { question_id: "q3", question: "Capital of France", type: "short_answer", answers: [], accepted_answers: ["Paris"], accent_insensitive: true },
          { question_id: "q4", question: "g", type: "numeric", answers: [], correct_value: 9.81, tolerance: 0.05 },
        ],
      },
    },
    { type: "flipcardGrid", content: [{ type: "flipcard", attrs: { question: "Q", answer: "A" } }] },
    // Experiences family (one of each, spec schemas).
    { type: "expSort", attrs: { blockId: "b-sort", title: "Sort", instructions: "Group them", categories: [{ id: "c1", label: "A", color: "green" }, { id: "c2", label: "B", color: "orange" }], items: [{ id: "i1", text: "x", categoryId: "c1" }, { id: "i2", text: "y", categoryId: "c2", explanation: "why" }], shuffle: true } },
    { type: "expSequence", attrs: { blockId: "b-seq", title: "Order", instructions: "", items: [{ id: "i1", text: "one" }, { id: "i2", text: "two", detail: "1900" }, { id: "i3", text: "three" }], variant: "timeline" } },
    { type: "expMatch", attrs: { blockId: "b-match", title: "Match", instructions: "", pairs: [{ id: "p1", left: "L1", right: "R1" }, { id: "p2", left: "L2", right: "R2" }], mode: "memory" } },
    { type: "expHotspot", attrs: { blockId: "b-hot", title: "Find", instructions: "", imageUrl: "https://example.com/a.png", spots: [{ id: "s1", x: 40, y: 30, r: 8, label: "Here", explanation: "Because", correct: true }], mode: "find" } },
    { type: "expGaps", attrs: { blockId: "b-gaps", title: "Gaps", text: "The [[sky|heavens]] is blue.", mode: "bank", caseSensitive: false } },
    { type: "expMythFact", attrs: { blockId: "b-myth", title: "Myth", statements: [{ id: "s1", text: "Bats are blind", isTrue: false, explanation: "They see" }, { id: "s2", text: "Water is wet", isTrue: true, explanation: "Yes" }], labels: { true: "Fact", false: "Myth" } } },
    { type: "expSpeedRound", attrs: { blockId: "b-speed", title: "Speed", questions: [{ id: "q1", prompt: "2+2", options: ["3", "4"], answer: 1 }], secondsPerQuestion: 10, lives: 3 } },
    { type: "expEstimate", attrs: { blockId: "b-est", question: "How many?", min: 0, max: 100, step: 1, answer: 42, unit: "things", tolerancePct: 10, explanation: "Because" } },
    { type: "expSpotMistake", attrs: { blockId: "b-spot", title: "Spot", instructions: "", segments: [{ id: "s1", text: "Fine.", isMistake: false }, { id: "s2", text: "Wrong.", isMistake: true, correction: "Right.", explanation: "Why" }], kind: "code" } },
    { type: "expCodeLock", attrs: { blockId: "b-lock", title: "Lock", story: "Locked", clues: [{ id: "c1", question: "1+1?", answer: "2", hint: "Count" }], reward: "Open!" } },
    { type: "expVenn",  attrs: {"blockId": "b-venn", "title": "Venn", "instructions": "Compare", "sets": {"a": {"label": "Cats", "color": "sky"}, "b": {"label": "Dogs", "color": "amber"}}, "items": [{"id": "i1", "text": "Purrs", "zone": "a"}, {"id": "i2", "text": "Fur", "zone": "both", "explanation": "Both"}, {"id": "i3", "text": "Barks", "zone": "b"}, {"id": "i4", "text": "Feathers", "zone": "neither"}], "showNeither": true}},
    { type: "expLabel",  attrs: {"blockId": "b-label", "title": "Label", "instructions": "Name the parts", "imageUrl": "https://example.com/plant.png", "imageObject": null, "pins": [{"id": "p1", "x": 50, "y": 20, "label": "Flower"}, {"id": "p2", "x": 40, "y": 80, "label": "Roots"}], "distractors": ["Wing"]}},
    { type: "expWordGuess",  attrs: {"blockId": "b-word", "title": "Words", "words": [{"id": "w1", "answer": "atom", "clue": "Smallest unit", "explanation": "Why"}, {"id": "w2", "answer": "red-shift", "clue": "Light stretched"}], "maxGuesses": 6}},
    { type: "expConfidence",  attrs: {"blockId": "b-conf", "title": "Sure?", "questions": [{"id": "q1", "prompt": "2+2", "options": ["3", "4"], "answer": 1, "explanation": "Count"}]}},
    { type: "expMatrix",  attrs: {"blockId": "b-matrix", "title": "Grid", "instructions": "Tick", "rows": [{"id": "r1", "label": "Bat"}, {"id": "r2", "label": "Hen"}], "columns": [{"id": "c1", "label": "Flies"}, {"id": "c2", "label": "Lays eggs"}], "cells": {"r1:c1": true, "r2:c2": true}, "mode": "multi"}},
    { type: "expReflect",  attrs: {"blockId": "b-reflect", "title": "Reflect", "prompt": "What did you learn?", "guidingQuestions": ["Why?"], "minWords": 30, "modelAnswer": "A model answer.", "checklist": ["Point one", "Point two"]}},
    { type: "paragraph" },
  ],
};

/** Server seed -> wire -> the editor's Yjs binding -> the editor's document. */
function loadThroughCollab(content) {
  const serverDoc = server.prosemirrorJSONToYDoc(content);
  const clientDoc = new Y.Doc();
  Y.applyUpdate(clientDoc, server.encodeUpdate(serverDoc));
  return yXmlFragmentToProseMirrorRootNode(clientDoc.getXmlFragment("default"), schema);
}

/** The JSON the editor itself would have for this content (defaults filled in). */
function editorJSON(content) {
  return schema.nodeFromJSON(server.normalizeActivityContent(content)).toJSON();
}

describe.skipIf(!HAS_COLLAB)("collab seeding against the real editor schema", () => {
  test("the converter is the server's", () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(10);
  });

  for (const fixture of [{ activity_uuid: "every-block", content: EVERY_BLOCK }, ...fixtures]) {
    test(`loads ${fixture.activity_uuid} without loss`, () => {
      const node = loadThroughCollab(fixture.content);
      expect(() => node.check()).not.toThrow();
      expect(node.toJSON()).toEqual(editorJSON(fixture.content));
    });
  }

  test("seeds exactly what the editor's binding would write", () => {
    for (const content of [EVERY_BLOCK, ...fixtures.map((f) => f.content)]) {
      const normalized = server.normalizeActivityContent(content);
      const node = schema.nodeFromJSON(normalized);
      const theirs = new Y.Doc();
      prosemirrorJSONToYXmlFragment(schema, node.toJSON(), theirs.getXmlFragment("default"));
      const ours = new Y.Doc();
      Y.applyUpdate(ours, server.encodeUpdate(server.prosemirrorJSONToYDoc(normalized)));
      // The binding writes every attr default; the stored JSON may omit them.
      // Both must read back to the same editor document.
      expect(yXmlFragmentToProseMirrorRootNode(ours.getXmlFragment("default"), schema).toJSON()).toEqual(
        yXmlFragmentToProseMirrorRootNode(theirs.getXmlFragment("default"), schema).toJSON(),
      );
    }
  });

  test("overlapping comment threads keep both marks", () => {
    const node = loadThroughCollab(EVERY_BLOCK);
    const text = node.child(1).child(6);
    expect(text.text).toBe("two threads");
    expect(text.marks.map((m) => m.attrs.threadId).sort()).toEqual(["thread_a", "thread_b"]);
  });
});
