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

const { Editor, Node } = await import("@tiptap/core");
const { default: StarterKit } = await import("@tiptap/starter-kit");
const { CALLOUT_CONTENT, normalizeCalloutContent } = await import(
  "../components/Objects/Editor/Extensions/Callout/calloutContent.ts"
);

// Stand-in for the callout node: same name, attrs and content expression as
// Callout.ts, without the React node view.
const Callout = Node.create({
  name: "callout",
  group: "block",
  content: CALLOUT_CONTENT,
  addAttributes() {
    return { type: { default: "info" }, dismissible: { default: false } };
  },
  parseHTML() {
    return [{ tag: "callout" }];
  },
  renderHTML() {
    return ["callout", 0];
  },
});

const makeEditor = (content) =>
  new Editor({
    extensions: [StarterKit, Callout],
    content,
    enableContentCheck: true,
  });

// A callout as saved before this change: text directly inside the node.
const legacyDoc = {
  type: "doc",
  content: [
    {
      type: "callout",
      attrs: { type: "warning", dismissible: false },
      content: [
        { type: "text", text: "Mind the " },
        { type: "text", text: "gap", marks: [{ type: "bold" }] },
      ],
    },
    { type: "paragraph", content: [{ type: "text", text: "After" }] },
  ],
};

const findCallout = (editor) => {
  let found = null;
  editor.state.doc.descendants((node, pos) => {
    if (!found && node.type.name === "callout") found = { node, pos };
  });
  return found;
};

// Put the cursor at the end of the callout's last text.
const focusEndOfCallout = (editor) => {
  const { node, pos } = findCallout(editor);
  editor.commands.setTextSelection(pos + node.nodeSize - 2);
};

describe("callout content", () => {
  test("a saved legacy callout is invalid for the new schema as is", () => {
    const editor = makeEditor({ type: "doc", content: [{ type: "paragraph" }] });
    const raw = editor.schema.nodeFromJSON(legacyDoc);
    expect(() => raw.check()).toThrow();
    editor.destroy();
  });

  test("normalizing wraps legacy text in a paragraph and keeps marks and attrs", () => {
    const editor = makeEditor(normalizeCalloutContent(legacyDoc));
    expect(() => editor.state.doc.check()).not.toThrow();
    const callout = editor.getJSON().content[0];
    expect(callout.attrs.type).toBe("warning");
    expect(callout.content).toEqual([
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Mind the " },
          { type: "text", text: "gap", marks: [{ type: "bold" }] },
        ],
      },
    ]);
    editor.destroy();
  });

  test("normalizing fills an empty legacy callout and leaves new callouts alone", () => {
    const current = {
      type: "callout",
      attrs: { type: "tip" },
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Intro" }] },
        { type: "bulletList", content: [] },
      ],
    };
    const normalized = normalizeCalloutContent({
      type: "doc",
      content: [{ type: "callout", attrs: { type: "info" } }, current],
    });
    expect(normalized.content[0].content).toEqual([{ type: "paragraph" }]);
    expect(normalized.content[1]).toEqual(current);
    expect(normalizeCalloutContent(null)).toBe(null);
    expect(normalizeCalloutContent("text")).toBe("text");
  });

  test("a bullet list can be created inside a callout", () => {
    const editor = makeEditor(normalizeCalloutContent(legacyDoc));
    focusEndOfCallout(editor);
    expect(editor.commands.toggleBulletList()).toBe(true);
    expect(editor.commands.splitListItem("listItem")).toBe(true);
    editor.commands.insertContent("second point");

    expect(() => editor.state.doc.check()).not.toThrow();
    const callout = editor.getJSON().content[0];
    expect(callout.type).toBe("callout");
    expect(callout.content.map((n) => n.type)).toEqual(["bulletList"]);
    const items = callout.content[0].content.map((li) =>
      li.content[0].content.map((t) => t.text).join("")
    );
    expect(items).toEqual(["Mind the gap", "second point"]);
    editor.destroy();
  });

  test("an ordered list can be created inside a callout", () => {
    const editor = makeEditor(normalizeCalloutContent(legacyDoc));
    focusEndOfCallout(editor);
    expect(editor.commands.toggleOrderedList()).toBe(true);
    expect(editor.getJSON().content[0].content[0].type).toBe("orderedList");
    editor.destroy();
  });

  test("typing '- ' at the start of a callout line starts a bullet list", () => {
    const editor = makeEditor({
      type: "doc",
      content: [{ type: "callout", content: [{ type: "paragraph" }] }],
    });
    const { pos } = findCallout(editor);
    const { view } = editor;
    editor.commands.setTextSelection(pos + 2);
    editor.commands.insertContent("-");
    const afterDash = editor.state.selection.from;
    // Same entry point the browser uses for typed text, so input rules run.
    expect(
      view.someProp("handleTextInput", (f) =>
        f(view, afterDash, afterDash, " ", () => view.state.tr.insertText(" ", afterDash))
      )
    ).toBe(true);
    expect(editor.getJSON().content[0].content[0].type).toBe("bulletList");
    expect(() => editor.state.doc.check()).not.toThrow();
    editor.destroy();
  });

  test("a callout keeps several paragraphs, and Enter on an empty last line leaves it", () => {
    const editor = makeEditor(normalizeCalloutContent(legacyDoc));
    focusEndOfCallout(editor);
    editor.commands.enter();
    editor.commands.insertContent("Second line");
    expect(findCallout(editor).node.childCount).toBe(2);

    editor.commands.enter();
    editor.commands.enter();
    editor.commands.insertContent("Outside");
    const json = editor.getJSON();
    expect(json.content[0].content).toHaveLength(2);
    expect(json.content[1]).toEqual({
      type: "paragraph",
      content: [{ type: "text", text: "Outside" }],
    });
    editor.destroy();
  });

  test("the toolbar and slash command insert a valid empty callout", () => {
    const editor = makeEditor({ type: "doc", content: [{ type: "paragraph" }] });
    expect(
      editor.commands.insertContent({
        type: "callout",
        attrs: { type: "error" },
        content: [{ type: "paragraph" }],
      })
    ).toBe(true);
    expect(() => editor.state.doc.check()).not.toThrow();
    expect(findCallout(editor).node.attrs.type).toBe("error");
    editor.destroy();
  });
});
