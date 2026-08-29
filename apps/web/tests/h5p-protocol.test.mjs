import { describe, expect, test } from "bun:test";

import {
  clampHeight,
  isAutoSized,
  normalizeSizeMode,
  parseH5PMessage,
  replyTarget,
  resolveManualHeight,
  shouldPrepareResize,
  DEFAULT_HEIGHT,
  MAX_HEIGHT,
  MIN_HEIGHT,
  SIZE_MODES,
} from "../lib/media/h5pProtocol.ts";

describe("parseH5PMessage — the shapes H5P sends", () => {
  test("hello", () => {
    expect(parseH5PMessage({ context: "h5p", action: "hello" })).toEqual({ kind: "hello" });
  });

  test("prepareResize carries both heights", () => {
    expect(
      parseH5PMessage({ context: "h5p", action: "prepareResize", clientHeight: 400, scrollHeight: 812 })
    ).toEqual({ kind: "prepareResize", clientHeight: 400, scrollHeight: 812 });
  });

  test("resize carries the content height", () => {
    expect(parseH5PMessage({ context: "h5p", action: "resize", scrollHeight: 812 })).toEqual({
      kind: "resize",
      scrollHeight: 812,
    });
  });

  test("a JSON-string payload is parsed", () => {
    const raw = JSON.stringify({ context: "h5p", action: "resize", scrollHeight: 500 });
    expect(parseH5PMessage(raw)).toEqual({ kind: "resize", scrollHeight: 500 });
  });
});

describe("parseH5PMessage — everything else is ignored", () => {
  test("another library's messages", () => {
    expect(parseH5PMessage({ context: "iframe-resizer", action: "resize", scrollHeight: 900 })).toBeNull();
    expect(parseH5PMessage({ action: "resize", scrollHeight: 900 })).toBeNull();
  });

  test("unknown h5p actions", () => {
    expect(parseH5PMessage({ context: "h5p", action: "resizePrepared" })).toBeNull();
    expect(parseH5PMessage({ context: "h5p", action: "exitFullScreen" })).toBeNull();
  });

  test("non-numeric or non-positive heights", () => {
    expect(parseH5PMessage({ context: "h5p", action: "resize", scrollHeight: "tall" })).toBeNull();
    expect(parseH5PMessage({ context: "h5p", action: "resize", scrollHeight: 0 })).toBeNull();
    expect(parseH5PMessage({ context: "h5p", action: "resize" })).toBeNull();
    expect(
      parseH5PMessage({ context: "h5p", action: "prepareResize", clientHeight: null, scrollHeight: 10 })
    ).toBeNull();
  });

  test("garbage", () => {
    expect(parseH5PMessage("not json")).toBeNull();
    expect(parseH5PMessage(null)).toBeNull();
    expect(parseH5PMessage(42)).toBeNull();
    expect(parseH5PMessage([{ context: "h5p", action: "hello" }])).toBeNull();
  });
});

describe("shouldPrepareResize — the anti-oscillation guard", () => {
  test("stays silent once frame, content and scroll heights agree", () => {
    expect(shouldPrepareResize(600, { clientHeight: 600, scrollHeight: 600 })).toBe(false);
  });

  test("answers while the content is taller than the frame", () => {
    expect(shouldPrepareResize(400, { clientHeight: 400, scrollHeight: 812 })).toBe(true);
  });

  test("answers while the content has shrunk below the frame", () => {
    expect(shouldPrepareResize(812, { clientHeight: 812, scrollHeight: 300 })).toBe(true);
  });
});

describe("clampHeight", () => {
  test("keeps realistic content heights untouched", () => {
    expect(clampHeight(812)).toBe(812);
    expect(clampHeight(6000)).toBe(6000);
  });

  test("rounds and bounds absurd values", () => {
    expect(clampHeight(812.4)).toBe(812);
    expect(clampHeight(-1)).toBe(MIN_HEIGHT);
    expect(clampHeight(1e9)).toBe(MAX_HEIGHT);
  });
});

describe("replyTarget", () => {
  test("replies to the sender's origin", () => {
    expect(replyTarget("https://team.h5p.com")).toBe("https://team.h5p.com");
  });

  test("a sandboxed frame reports 'null', which postMessage rejects", () => {
    expect(replyTarget("null")).toBe("*");
    expect(replyTarget("")).toBe("*");
    expect(replyTarget(undefined)).toBe("*");
  });
});

describe("SIZE_MODES", () => {
  test("is exactly the picker's six buttons, in order", () => {
    // Pinned as a list, not iterated: the component renders one button per
    // entry, and handleSizeModeChange is the only producer of 'auto'. Drop
    // 'auto' from here and a manually sized block can never be handed back to
    // the H5P handshake.
    expect(SIZE_MODES).toEqual(["auto", "widescreen", "classic", "short", "medium", "tall"]);
  });

  test("'custom' is deliberately not a button — dragging produces it", () => {
    expect(SIZE_MODES).not.toContain("custom");
    expect(normalizeSizeMode("custom")).toBe("custom");
  });
});

describe("normalizeSizeMode", () => {
  test("keeps every mode the picker can produce", () => {
    for (const mode of SIZE_MODES) {
      expect(normalizeSizeMode(mode)).toBe(mode);
    }
    expect(normalizeSizeMode("custom")).toBe("custom");
  });

  test("a document written before sizing existed reads as auto", () => {
    expect(normalizeSizeMode(undefined)).toBe("auto");
    expect(normalizeSizeMode(null)).toBe("auto");
    expect(normalizeSizeMode("")).toBe("auto");
    expect(normalizeSizeMode("cinema")).toBe("auto");
    expect(normalizeSizeMode(16 / 9)).toBe("auto");
  });

  test("isAutoSized follows it", () => {
    expect(isAutoSized(undefined)).toBe(true);
    expect(isAutoSized("auto")).toBe(true);
    expect(isAutoSized("widescreen")).toBe(false);
    expect(isAutoSized("custom")).toBe(false);
  });
});

describe("resolveManualHeight", () => {
  test("auto leaves the height to the content", () => {
    expect(resolveManualHeight("auto", 960, 812)).toBeNull();
    expect(resolveManualHeight("nonsense", 960, 812)).toBeNull();
  });

  test("ratio modes follow the block's width", () => {
    expect(resolveManualHeight("widescreen", 960, 400)).toBe(540);
    expect(resolveManualHeight("classic", 960, 400)).toBe(720);
    // A narrow phone gets a proportionally shorter frame, not the desktop one.
    expect(resolveManualHeight("widescreen", 320, 400)).toBe(180);
  });

  test("a ratio falls back to the stored height until the block has a width", () => {
    expect(resolveManualHeight("widescreen", 0, 812)).toBe(812);
    expect(resolveManualHeight("widescreen", Number.NaN, 812)).toBe(812);
  });

  test("fixed modes ignore both the width and the stored height", () => {
    expect(resolveManualHeight("short", 960, 812)).toBe(320);
    expect(resolveManualHeight("medium", 320, 812)).toBe(520);
    expect(resolveManualHeight("tall", 0, 812)).toBe(760);
  });

  test("custom is whatever was dragged, within bounds", () => {
    expect(resolveManualHeight("custom", 960, 812)).toBe(812);
    expect(resolveManualHeight("custom", 960, 5)).toBe(MIN_HEIGHT);
    expect(resolveManualHeight("custom", 960, 1e9)).toBe(MAX_HEIGHT);
  });

  test("a missing stored height does not reach a style attribute as NaN", () => {
    expect(resolveManualHeight("custom", 960, Number.NaN)).toBe(DEFAULT_HEIGHT);
    expect(resolveManualHeight("widescreen", 0, Number.NaN)).toBe(DEFAULT_HEIGHT);
  });
});
