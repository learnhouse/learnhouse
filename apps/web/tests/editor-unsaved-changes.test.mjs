import { describe, expect, test } from "bun:test";

import {
  createBeforeUnloadHandler,
  getEditorContentSnapshot,
  hasEditorContentChanged,
} from "../components/Objects/Editor/unsavedChangesGuard.ts";

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
});
