import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

// ProseMirror needs a DOM to build an editor view. happy-dom ships as a peer
// dependency of @tiptap/html, so it is always installed alongside the app.
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

const { Editor, Node, getSchema } = await import("@tiptap/core");
const { default: StarterKit } = await import("@tiptap/starter-kit");
const { Table } = await import("@tiptap/extension-table");
const { TableRow } = await import("@tiptap/extension-table-row");
const { TableHeader } = await import("@tiptap/extension-table-header");
const { TableCell } = await import("@tiptap/extension-table-cell");
const { AIStreamingMark } = await import(
  "../components/Objects/Editor/Extensions/AIStreaming/AIStreamingMark.ts"
);
const {
  AI_STREAMING_MARK,
  addStreamingMarks,
  extractTextFromTiptap,
  insertAIContent,
  normalizeAINodes,
  parseAIContentJson,
  prepareAIContent,
  repairJson,
  textToParagraphs,
  transformContentForInsertion,
  unwrapAIContent,
} = await import("../components/Objects/Editor/AI/aiEditorContent.ts");

// Plain stand-ins for the app's React node-view blocks: same names and
// content expressions, no node views.
const Flipcard = Node.create({
  name: "flipcard",
  group: "block",
  content: "text*",
  addAttributes() {
    return {
      question: { default: "q" },
      answer: { default: "a" },
      color: { default: "blue" },
      alignment: { default: "center" },
      size: { default: "medium" },
    };
  },
  renderHTML() {
    return ["flipcard-block", 0];
  },
});
const FlipcardGrid = Node.create({
  name: "flipcardGrid",
  group: "block",
  content: "flipcard+",
  addAttributes() {
    return { columns: { default: 2 } };
  },
  renderHTML() {
    return ["flipcard-grid", 0];
  },
});
const CalloutInfo = Node.create({
  name: "calloutInfo",
  group: "block",
  content: "text*",
  renderHTML() {
    return ["callout-info", 0];
  },
});

const extensions = [
  StarterKit,
  Table.configure({ resizable: true }),
  TableRow,
  TableHeader,
  TableCell,
  Flipcard,
  FlipcardGrid,
  CalloutInfo,
  AIStreamingMark,
];
const schema = getSchema(extensions);
const SPECIAL = new Set(["calloutInfo", "calloutWarning", "badge", "button", "flipcard", "blockQuiz"]);

const makeEditor = () =>
  new Editor({
    element: document.createElement("div"),
    extensions,
    content: {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Existing paragraph" }] },
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Existing heading" }] },
      ],
    },
  });

const collectMarks = (node, out = []) => {
  if (node.type === "text") {
    out.push({ text: node.text, marks: (node.marks || []).map((m) => m.type) });
  }
  for (const child of node.content || []) collectMarks(child, out);
  return out;
};

const collectTypes = (node, out = []) => {
  out.push(node.type);
  for (const child of node.content || []) collectTypes(child, out);
  return out;
};

// The payload from the bug report: heading, paragraph, table with inline code,
// heading, paragraph, flipcard grid, rule. The inline `code` mark is what made
// the whole insert throw and dump raw JSON.
const reportedPayload = [
  { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Traditional vs. Conventional Commits" }] },
  { type: "paragraph", content: [{ type: "text", text: "Before diving in, compare the two styles." }] },
  {
    type: "table",
    content: [
      {
        type: "tableRow",
        content: [
          { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "Traditional", marks: [{ type: "bold" }] }] }] },
          { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "Conventional", marks: [{ type: "bold" }] }] }] },
        ],
      },
      {
        type: "tableRow",
        content: [
          { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "fixed bug" }] }] },
          { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "fix(auth): resolve timeout", marks: [{ type: "code" }] }] }] },
        ],
      },
    ],
  },
  { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Core Concepts" }] },
  { type: "paragraph", content: [{ type: "text", text: "Click the cards below." }] },
  {
    type: "flipcardGrid",
    attrs: { columns: 2 },
    content: [
      { type: "flipcard", attrs: { question: "Type", answer: "The category.", color: "blue", size: "medium", alignment: "center" } },
      { type: "flipcard", attrs: { question: "Scope", answer: "An optional tag.", color: "purple", size: "medium", alignment: "center" } },
    ],
  },
  { type: "horizontalRule" },
];

describe("unwrapAIContent", () => {
  test("strips content markers, including a missing end marker", () => {
    expect(unwrapAIContent('<<<CONTENT>>>\n{"type":"paragraph"}\n<<<END_CONTENT>>>')).toBe('{"type":"paragraph"}');
    expect(unwrapAIContent('<<<CONTENT>>>\n{"type":"paragraph"}')).toBe('{"type":"paragraph"}');
  });

  test("unwraps a code fence around the whole payload", () => {
    expect(unwrapAIContent('```json\n{"type":"paragraph"}\n```')).toBe('{"type":"paragraph"}');
    expect(unwrapAIContent('```json{"type":"paragraph"}```')).toBe('{"type":"paragraph"}');
    expect(unwrapAIContent('```\n[{"type":"paragraph"}]')).toBe('[{"type":"paragraph"}]');
  });

  test("leaves a fence inside a code block alone", () => {
    const payload = '{"type":"codeBlock","content":[{"type":"text","text":"```js\\nfoo\\n```"}]}';
    expect(unwrapAIContent(payload)).toBe(payload);
  });

  test("unwraps a JSON string literal", () => {
    expect(unwrapAIContent('"{\\"type\\":\\"paragraph\\"}"')).toBe('{"type":"paragraph"}');
    expect(unwrapAIContent('"Just a sentence."')).toBe("Just a sentence.");
  });

  test("drops control characters but keeps tabs and newlines", () => {
    expect(unwrapAIContent("a\u0001b\u007fc\td\ne")).toBe("abc\td\ne");
  });
});

describe("repairJson", () => {
  test("escapes newlines only inside string literals", () => {
    const pretty = '{\n  "type": "paragraph",\n  "content": [{"type": "text", "text": "line one\nline two"}]\n}';
    const parsed = JSON.parse(repairJson(pretty));
    expect(parsed.content[0].text).toBe("line one\nline two");
  });

  test("removes trailing commas and closes truncated structures", () => {
    expect(JSON.parse(repairJson('{"a":[1,2,],"b":{"c":1,},}'))).toEqual({ a: [1, 2], b: { c: 1 } });
    expect(JSON.parse(repairJson('[{"type":"paragraph","content":[{"type":"text","text":"cut off'))).toEqual([
      { type: "paragraph", content: [{ type: "text", text: "cut off" }] },
    ]);
  });

  test("does not touch commas or brackets inside strings", () => {
    const input = '{"text":"a, ] } [ {"}';
    expect(JSON.parse(repairJson(input))).toEqual({ text: "a, ] } [ {" });
  });
});

describe("parseAIContentJson", () => {
  test("returns undefined for prose", () => {
    expect(parseAIContentJson("Plain sentence.")).toBeUndefined();
  });

  test("parses valid, repaired, and embedded JSON", () => {
    expect(parseAIContentJson('{"type":"paragraph"}')).toEqual({ type: "paragraph" });
    expect(parseAIContentJson('{"type":"paragraph",}')).toEqual({ type: "paragraph" });
    expect(parseAIContentJson('{"type":"paragraph"} trailing words')).toEqual({ type: "paragraph" });
  });
});

describe("text helpers", () => {
  test("extractTextFromTiptap flattens nested nodes", () => {
    expect(extractTextFromTiptap(reportedPayload[2])).toContain("fix(auth): resolve timeout");
    expect(extractTextFromTiptap({ type: "horizontalRule" })).toBe("");
  });

  test("textToParagraphs splits blank lines into paragraphs and newlines into hard breaks", () => {
    expect(textToParagraphs("one\ntwo\n\nthree")).toEqual([
      { type: "paragraph", content: [{ type: "text", text: "one" }, { type: "hardBreak" }, { type: "text", text: "two" }] },
      { type: "paragraph", content: [{ type: "text", text: "three" }] },
    ]);
  });

  test("transformContentForInsertion unwraps paragraphs inside direct-text blocks", () => {
    const callout = { type: "calloutInfo", content: [{ type: "paragraph", content: [{ type: "text", text: "Tip" }] }] };
    expect(transformContentForInsertion(callout)).toEqual({ type: "calloutInfo", content: [{ type: "text", text: "Tip" }] });
  });
});

describe("normalizeAINodes", () => {
  test("unwraps a doc wrapper and keeps known nodes", () => {
    const doc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }] };
    expect(normalizeAINodes(doc, schema)).toEqual(doc.content);
  });

  test("downgrades unknown node types to paragraphs with their text", () => {
    const nodes = normalizeAINodes([{ type: "fancyBlock", content: [{ type: "text", text: "kept" }] }, { type: "mystery" }], schema);
    expect(nodes).toEqual([{ type: "paragraph", content: [{ type: "text", text: "kept" }] }]);
  });

  test("keeps a bare text node so selections can be replaced inline", () => {
    expect(normalizeAINodes({ type: "text", text: "replacement" }, schema)).toEqual([{ type: "text", text: "replacement" }]);
  });
});

describe("prepareAIContent", () => {
  test("turns prose into paragraphs", () => {
    expect(prepareAIContent("Hello there.", schema)).toEqual({
      nodes: [{ type: "paragraph", content: [{ type: "text", text: "Hello there." }] }],
    });
  });

  test("handles fenced, quoted, and pretty-printed replies", () => {
    const fenced = '```json\n[\n  {"type":"paragraph","content":[{"type":"text","text":"a\nb"}]}\n]\n```';
    expect(prepareAIContent(fenced, schema).nodes).toEqual([
      { type: "paragraph", content: [{ type: "text", text: "a\nb" }] },
    ]);
    const quoted = JSON.stringify('{"type":"paragraph","content":[{"type":"text","text":"q"}]}');
    expect(prepareAIContent(quoted, schema).nodes).toEqual([
      { type: "paragraph", content: [{ type: "text", text: "q" }] },
    ]);
  });

  test("refuses to turn broken TipTap JSON into prose", () => {
    expect(prepareAIContent('{"type":"paragraph" "content":[{"type":"text","text":"x"}]}', schema)).toMatchObject({
      nodes: [],
      error: "unparseable",
    });
    expect(prepareAIContent("", schema)).toEqual({ nodes: [] });
  });

  test("recovers a reply truncated mid-string", () => {
    expect(prepareAIContent('[{"type":"paragraph","content":[{"type":"text","text":"cut off', schema).nodes).toEqual([
      { type: "paragraph", content: [{ type: "text", text: "cut off" }] },
    ]);
  });
});

describe("addStreamingMarks", () => {
  test("marks ordinary text but skips text with an exclusive mark", () => {
    const marked = addStreamingMarks(reportedPayload[2], schema, SPECIAL);
    const texts = collectMarks(marked);
    expect(texts.find((t) => t.text === "Traditional").marks).toEqual(["bold", AI_STREAMING_MARK]);
    expect(texts.find((t) => t.text === "fix(auth): resolve timeout").marks).toEqual(["code"]);
  });

  test("skips text inside nodes that forbid marks and inside special blocks", () => {
    const codeBlock = addStreamingMarks({ type: "codeBlock", content: [{ type: "text", text: "const a = 1" }] }, schema, SPECIAL);
    expect(codeBlock.content[0].marks).toBeUndefined();
    const callout = addStreamingMarks({ type: "calloutInfo", content: [{ type: "text", text: "tip" }] }, schema, SPECIAL);
    expect(callout.content[0].marks).toBeUndefined();
  });

  test("produces content the schema accepts", () => {
    const marked = addStreamingMarks(reportedPayload, schema, SPECIAL);
    for (const node of marked) {
      expect(() => schema.nodeFromJSON(node).check()).not.toThrow();
    }
  });
});

describe("insertAIContent", () => {
  test("inserts the reported payload block by block without dumping JSON", () => {
    const editor = makeEditor();
    editor.commands.setTextSelection(1);

    const result = insertAIContent(editor, reportedPayload, SPECIAL);
    expect(result.inserted).toBe(reportedPayload.length);
    expect(result.failed).toBe(0);
    expect(result.to).toBeGreaterThan(result.from);

    const types = collectTypes(editor.getJSON());
    for (const type of ["heading", "table", "tableHeader", "tableCell", "flipcardGrid", "flipcard", "horizontalRule"]) {
      expect(types).toContain(type);
    }
    expect(editor.getText()).not.toContain('"type"');

    const texts = collectMarks(editor.getJSON());
    expect(texts.find((t) => t.text === "Traditional vs. Conventional Commits").marks).toEqual([AI_STREAMING_MARK]);
    expect(texts.find((t) => t.text === "fix(auth): resolve timeout").marks).toEqual(["code"]);
    expect(texts.find((t) => t.text === "Existing paragraph").marks).toEqual([]);
  });

  test("keeps going when one node is invalid and keeps its text", () => {
    const editor = makeEditor();
    editor.commands.setTextSelection(1);
    const nodes = [
      { type: "paragraph", content: [{ type: "text", text: "before" }] },
      { type: "flipcardGrid", content: [{ type: "paragraph", content: [{ type: "text", text: "wrong child" }] }] },
      { type: "paragraph", content: [{ type: "text", text: "after" }] },
    ];

    const result = insertAIContent(editor, nodes, SPECIAL);
    expect(result.inserted).toBe(3);
    const text = editor.getText();
    expect(text).toContain("before");
    expect(text).toContain("wrong child");
    expect(text).toContain("after");
    expect(text).not.toContain('"type"');
  });

  test("streaming marks can be removed from the inserted range afterwards", () => {
    const editor = makeEditor();
    editor.commands.setTextSelection(1);
    const { from, to } = insertAIContent(editor, reportedPayload, SPECIAL);

    editor.chain().setTextSelection({ from, to }).unsetMark(AI_STREAMING_MARK).run();
    const remaining = collectMarks(editor.getJSON()).filter((t) => t.marks.includes(AI_STREAMING_MARK));
    expect(remaining).toEqual([]);
  });
});
