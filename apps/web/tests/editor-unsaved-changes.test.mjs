import { describe, expect, test } from "bun:test";

import {
  createBeforeUnloadHandler,
  getEditorContentSnapshot,
  hasEditorContentChanged,
  shouldGuardNavigationClick,
} from "../components/Objects/Editor/unsavedChangesGuard.ts";

const ORIGIN = "https://app.example.com";
const plainLeftClick = {
  defaultPrevented: false,
  button: 0,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
};
const inAppAnchor = {
  href: `${ORIGIN}/`,
  target: "",
  origin: ORIGIN,
  hasDownload: false,
};

describe("editor unsaved changes guard", () => {
  test("does not block unload when the editor is clean", () => {
    let prevented = false;
    const event = {
      preventDefault() {
        prevented = true;
      },
      returnValue: undefined,
    };

    const result = createBeforeUnloadHandler(() => false)(event);

    expect(result).toBeUndefined();
    expect(prevented).toBe(false);
    expect(event.returnValue).toBeUndefined();
  });

  test("blocks unload when the editor has unsaved changes", () => {
    let prevented = false;
    const event = {
      preventDefault() {
        prevented = true;
      },
      returnValue: undefined,
    };

    const result = createBeforeUnloadHandler(() => true)(event);

    expect(result).toBe("");
    expect(prevented).toBe(true);
    expect(event.returnValue).toBe("");
  });

  test("detects content changes against the last saved snapshot", () => {
    const savedContent = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Saved" }] }],
    };
    const changedContent = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Draft" }] }],
    };
    const savedSnapshot = getEditorContentSnapshot(savedContent);

    expect(hasEditorContentChanged(savedSnapshot, savedContent)).toBe(false);
    expect(hasEditorContentChanged(savedSnapshot, changedContent)).toBe(true);
  });

  test("guards a same-tab in-app navigation click", () => {
    expect(shouldGuardNavigationClick(plainLeftClick, inAppAnchor, ORIGIN)).toBe(true);
  });

  test("does not guard clicks without an anchor", () => {
    expect(shouldGuardNavigationClick(plainLeftClick, null, ORIGIN)).toBe(false);
  });

  test("does not guard target=_blank, downloads, or modified/non-left clicks", () => {
    expect(
      shouldGuardNavigationClick(plainLeftClick, { ...inAppAnchor, target: "_blank" }, ORIGIN)
    ).toBe(false);
    expect(
      shouldGuardNavigationClick(plainLeftClick, { ...inAppAnchor, hasDownload: true }, ORIGIN)
    ).toBe(false);
    expect(
      shouldGuardNavigationClick({ ...plainLeftClick, metaKey: true }, inAppAnchor, ORIGIN)
    ).toBe(false);
    expect(
      shouldGuardNavigationClick({ ...plainLeftClick, button: 1 }, inAppAnchor, ORIGIN)
    ).toBe(false);
    expect(
      shouldGuardNavigationClick({ ...plainLeftClick, defaultPrevented: true }, inAppAnchor, ORIGIN)
    ).toBe(false);
  });

  test("does not guard external-origin links (beforeunload already covers them)", () => {
    expect(
      shouldGuardNavigationClick(
        plainLeftClick,
        { ...inAppAnchor, href: "https://other.example.com/", origin: "https://other.example.com" },
        ORIGIN
      )
    ).toBe(false);
  });
});

describe("getEditorContentSnapshot: H5P height", () => {
  const doc = (height, url = "https://team.h5p.com/content/1/embed") => ({
    type: "doc",
    content: [{ type: "blockH5P", attrs: { h5pUrl: url, title: "Quiz", height } }],
  });

  test("a host-reported height change alone does not make the doc dirty", () => {
    const saved = getEditorContentSnapshot(doc(400));
    expect(hasEditorContentChanged(saved, doc(812))).toBe(false);
  });

  test("a real edit alongside the height change still counts", () => {
    const saved = getEditorContentSnapshot(doc(400));
    expect(
      hasEditorContentChanged(saved, doc(812, "https://team.h5p.com/content/2/embed"))
    ).toBe(true);
  });

  test("a node type that collides with Object.prototype does not crash", () => {
    const doc = { type: "doc", content: [{ type: "__proto__", attrs: { a: 1 } }] };
    expect(() => getEditorContentSnapshot(doc)).not.toThrow();
    expect(hasEditorContentChanged(getEditorContentSnapshot(doc), doc)).toBe(false);
  });

  test("a height an author dragged does make the doc dirty", () => {
    // Under `custom` the height IS the author's edit, and a drag on a block
    // already set to custom moves no other attribute, so if this were treated
    // as volatile the resize would be lost with no leave-confirm.
    const dragged = (height) => ({
      type: "doc",
      content: [
        {
          type: "blockH5P",
          attrs: { h5pUrl: "https://team.h5p.com/content/1/embed", sizeMode: "custom", height },
        },
      ],
    });
    expect(hasEditorContentChanged(getEditorContentSnapshot(dragged(500)), dragged(900))).toBe(true);
  });

  test("a preset size still counts the height it pinned", () => {
    const preset = (height) => ({
      type: "doc",
      content: [
        {
          type: "blockH5P",
          attrs: { h5pUrl: "https://team.h5p.com/content/1/embed", sizeMode: "widescreen", height },
        },
      ],
    });
    expect(hasEditorContentChanged(getEditorContentSnapshot(preset(540)), preset(720))).toBe(true);
  });

  test("an explicit auto is as volatile as a missing sizeMode", () => {
    const auto = (height) => ({
      type: "doc",
      content: [
        {
          type: "blockH5P",
          attrs: { h5pUrl: "https://team.h5p.com/content/1/embed", sizeMode: "auto", height },
        },
      ],
    });
    expect(hasEditorContentChanged(getEditorContentSnapshot(auto(400)), auto(812))).toBe(false);
  });

  test("height is ignored only on blockH5P", () => {
    const saved = getEditorContentSnapshot({
      type: "doc",
      content: [{ type: "blockVideo", attrs: { height: 400 } }],
    });
    expect(
      hasEditorContentChanged(saved, {
        type: "doc",
        content: [{ type: "blockVideo", attrs: { height: 812 } }],
      })
    ).toBe(true);
  });
});

describe("trailing empty paragraph", () => {
  const quiz = { type: "blockQuiz", attrs: { quizId: "q1" } };
  const doc = (...content) => ({ type: "doc", content });

  test("the paragraph the editor appends on load is not an edit", () => {
    const saved = getEditorContentSnapshot(doc(quiz));
    expect(hasEditorContentChanged(saved, doc(quiz, { type: "paragraph" }))).toBe(false);
    expect(hasEditorContentChanged(saved, doc(quiz, { type: "paragraph", content: [] }))).toBe(false);
  });

  test("text typed into it is an edit", () => {
    const saved = getEditorContentSnapshot(doc(quiz));
    const typed = doc(quiz, { type: "paragraph", content: [{ type: "text", text: "hi" }] });
    expect(hasEditorContentChanged(saved, typed)).toBe(true);
  });

  test("empty paragraphs between blocks still count", () => {
    const saved = getEditorContentSnapshot(doc(quiz, quiz));
    expect(hasEditorContentChanged(saved, doc(quiz, { type: "paragraph" }, quiz))).toBe(true);
  });

  test("only the document's own trailing paragraphs are ignored", () => {
    const cell = (...content) => ({ type: "tableCell", content });
    const saved = getEditorContentSnapshot(doc(cell({ type: "paragraph", content: [{ type: "text", text: "a" }] })));
    const changed = doc(cell({ type: "paragraph", content: [{ type: "text", text: "a" }] }, { type: "paragraph" }));
    expect(hasEditorContentChanged(saved, changed)).toBe(true);
  });
});
