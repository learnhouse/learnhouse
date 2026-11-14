import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
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
const { Table } = await import("@tiptap/extension-table");
const { default: TableCell } = await import("@tiptap/extension-table-cell");
const { default: TableHeader } = await import("@tiptap/extension-table-header");
const { default: TableRow } = await import("@tiptap/extension-table-row");
const { default: Youtube } = await import("@tiptap/extension-youtube");
const { getLinkExtension } = await import("../components/Objects/Editor/EditorConf.ts");
const Blocks = await import("../components/Objects/Editor/Blocks/extensions");
const { default: CommentMark } = await import("../components/Objects/Editor/Comments/CommentMark.ts");
const { default: AIStreamingMark } = await import("../components/Objects/Editor/Extensions/AIStreaming/AIStreamingMark");
const { CommunityTag } = await import("../components/Objects/Communities/Tags/CommunityTag");

// The collab server's converter. It lives in apps/collab and uses that app's
// copy of yjs, so documents cross over as encoded updates (as on the wire).
const server = await import("../../collab/src/prosemirrorY.ts");

const ext = (path) => import(`../components/Objects/Editor/Extensions/${path}`).then((m) => m.default);
const BLOCK_EXTENSIONS = await Promise.all([
  "Callout/Callout", "Callout/Info/InfoCallout", "Callout/Warning/WarningCallout", "Image/ImageBlock",
  "Video/VideoBlock", "Audio/AudioBlock", "MathEquation/MathEquationBlock", "PDF/PDFBlock", "H5P/H5PBlock",
  "Library/LibraryBlock", "Quiz/QuizBlock", "EmbedObjects/EmbedObjects", "Badges/Badges", "Buttons/Buttons",
  "Users/UserBlock", "WebPreview/WebPreview", "Flipcard/Flipcard", "Flipcard/FlipcardGrid", "Scenarios/Scenarios",
  "CodePlayground/CodePlayground", "MagicBlocks/MagicBlock", "Dynamic/ConditionalBlock", "Dynamic/DynamicVariable",
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
  Table, TableRow, TableHeader, TableCell,
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
    { type: "blockQuiz", attrs: { quizId: "quiz_1", questions: [{ question_id: "q1", question: "Why?", answers: [{ answer_id: "a1", answer: "Because", correct: true }] }] } },
    { type: "flipcardGrid", content: [{ type: "flipcard", attrs: { question: "Q", answer: "A" } }] },
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

describe("collab seeding against the real editor schema", () => {
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
