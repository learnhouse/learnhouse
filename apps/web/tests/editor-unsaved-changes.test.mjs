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
