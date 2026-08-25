import { describe, expect, test } from "bun:test";

import {
  clampHeight,
  parseH5PMessage,
  replyTarget,
  shouldPrepareResize,
  MAX_HEIGHT,
  MIN_HEIGHT,
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
