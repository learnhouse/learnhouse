import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";

import {
  EMBED_PROTOCOL_VERSION,
  embedMessage,
  embedSnippet,
  isHostMessage,
  parseEmbedOptions,
} from "../lib/embed/protocol.ts";

const params = (query) => new URLSearchParams(query);
const LOCALES = ["en", "fr", "de"];

describe("parseEmbedOptions", () => {
  test("defaults when nothing is set", () => {
    expect(parseEmbedOptions(params(""), LOCALES)).toEqual({
      bgcolor: null,
      textcolor: null,
      locale: null,
      showLogo: true,
    });
  });

  test("hex colors get a #, transparent passes through", () => {
    expect(parseEmbedOptions(params("bgcolor=fafafa&textcolor=111"), LOCALES)).toMatchObject({
      bgcolor: "#fafafa",
      textcolor: "#111",
    });
    expect(parseEmbedOptions(params("bgcolor=transparent"), LOCALES).bgcolor).toBe("transparent");
  });

  test("anything that isn't a hex color is dropped, so it can't reach a style", () => {
    const opts = parseEmbedOptions(params("bgcolor=red;}body{x:y&textcolor=url(x)"), LOCALES);
    expect(opts.bgcolor).toBeNull();
    expect(opts.textcolor).toBeNull();
  });

  test("locale is normalized and limited to supported languages", () => {
    expect(parseEmbedOptions(params("locale=FR-ca"), LOCALES).locale).toBe("fr");
    expect(parseEmbedOptions(params("locale=xx"), LOCALES).locale).toBeNull();
    expect(parseEmbedOptions(params("locale=fr"), []).locale).toBeNull();
  });

  test("the logo can be turned off", () => {
    expect(parseEmbedOptions(params("showlearnhouselogo=false"), LOCALES).showLogo).toBe(false);
    expect(parseEmbedOptions(params("showlearnhouselogo=true"), LOCALES).showLogo).toBe(true);
  });
});

describe("messages", () => {
  test("embedMessage stamps source, version, type and activity", () => {
    expect(embedMessage("resize", "activity_1", { height: 420 })).toEqual({
      height: 420,
      source: "learnhouse",
      version: EMBED_PROTOCOL_VERSION,
      type: "resize",
      activityId: "activity_1",
    });
  });

  test("data can't override the envelope", () => {
    const msg = embedMessage("ready", "a", { source: "evil", type: "complete" });
    expect(msg.source).toBe("learnhouse");
    expect(msg.type).toBe("ready");
  });

  test("isHostMessage accepts only host messages", () => {
    expect(isHostMessage({ source: "learnhouse-host", type: "hello" })).toBe(true);
    expect(isHostMessage({ source: "learnhouse", type: "hello" })).toBe(false);
    expect(isHostMessage({ source: "learnhouse-host" })).toBe(false);
    expect(isHostMessage(null)).toBe(false);
    expect(isHostMessage("hello")).toBe(false);
  });

  test("embedSnippet includes the iframe marker and the helper script", () => {
    const code = embedSnippet("https://acme.test/embed/acme/course/1/activity/2", "https://acme.test");
    expect(code).toContain('src="https://acme.test/embed/acme/course/1/activity/2"');
    expect(code).toContain("data-learnhouse-embed");
    expect(code).toContain('<script src="https://acme.test/embed.js" async></script>');
  });
});

// public/embed.js runs on other people's pages; drive it with a minimal DOM.
function loadHostScript() {
  const listeners = {};
  const frames = [];
  const makeFrame = (attrs = {}) => {
    const sent = [];
    const events = [];
    const frame = {
      style: {},
      contentWindow: { postMessage: (msg) => sent.push(msg) },
      getAttribute: (name) => attrs[name] ?? null,
      addEventListener: (type, fn) => (frame[`on${type}`] = fn),
      dispatchEvent: (event) => events.push(event),
      sent,
      events,
    };
    frames.push(frame);
    return frame;
  };
  let observerCallback = null;
  const context = {
    document: { querySelectorAll: () => frames, documentElement: {} },
    CustomEvent: class {
      constructor(type, init) {
        this.type = type;
        this.detail = init.detail;
        this.bubbles = init.bubbles;
      }
    },
    MutationObserver: class {
      constructor(cb) {
        observerCallback = cb;
      }
      observe() {}
    },
  };
  context.window = {
    addEventListener: (type, fn) => (listeners[type] = fn),
  };
  vm.createContext(context);
  vm.runInContext(readFileSync(new URL("../public/embed.js", import.meta.url), "utf8"), context);
  return {
    context,
    makeFrame,
    message: (data, source) => listeners.message({ data, source }),
    rescan: () => observerCallback?.(),
  };
}

describe("public/embed.js", () => {
  test("says hello to iframes on the page and to ones added later", () => {
    const host = loadHostScript();
    const late = host.makeFrame();
    host.rescan();
    expect(late.sent).toEqual([{ source: "learnhouse-host", type: "hello" }]);
    late.onload();
    expect(late.sent.length).toBe(2);
    host.rescan();
    expect(late.sent.length).toBe(2); // watched once
  });

  test("resizes the iframe the message came from and re-dispatches it", () => {
    const host = loadHostScript();
    const a = host.makeFrame();
    const b = host.makeFrame();
    host.message({ source: "learnhouse", version: 1, type: "resize", activityId: "x", height: 411.2 }, b.contentWindow);
    expect(a.style.height).toBeUndefined();
    expect(b.style.height).toBe("412px");
    expect(b.events[0].type).toBe("learnhouse:resize");
    expect(b.events[0].detail.height).toBe(411.2);
    expect(b.events[0].bubbles).toBe(true);
  });

  test("respects data-learnhouse-autoresize=false but still dispatches", () => {
    const host = loadHostScript();
    const frame = host.makeFrame({ "data-learnhouse-autoresize": "false" });
    host.message({ source: "learnhouse", version: 1, type: "resize", height: 300 }, frame.contentWindow);
    expect(frame.style.height).toBeUndefined();
    expect(frame.events[0].type).toBe("learnhouse:resize");
  });

  test("ignores messages from other windows, sources and versions", () => {
    const host = loadHostScript();
    const frame = host.makeFrame();
    host.message({ source: "learnhouse", version: 1, type: "complete" }, {});
    host.message({ source: "other", version: 1, type: "complete" }, frame.contentWindow);
    host.message({ source: "learnhouse", version: 2, type: "complete" }, frame.contentWindow);
    host.message(null, frame.contentWindow);
    expect(frame.events).toEqual([]);
  });

  test("forwards completion events", () => {
    const host = loadHostScript();
    const frame = host.makeFrame();
    host.message({ source: "learnhouse", version: 1, type: "complete", activityId: "x", reason: "scrolled_to_end" }, frame.contentWindow);
    expect(frame.events[0].type).toBe("learnhouse:complete");
    expect(frame.events[0].detail.reason).toBe("scrolled_to_end");
  });

  test("loading the script twice installs one listener", () => {
    const host = loadHostScript();
    host.context.window.__learnhouseEmbed = true;
    const before = host.context.window.addEventListener;
    let added = 0;
    host.context.window.addEventListener = () => added++;
    vm.runInContext(readFileSync(new URL("../public/embed.js", import.meta.url), "utf8"), host.context);
    expect(added).toBe(0);
    host.context.window.addEventListener = before;
  });
});
