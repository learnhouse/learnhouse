import { describe, expect, mock, test } from "bun:test";

import {
  buildScormShimSource,
  handleShimMessage,
  injectScormShim,
  normalizeHost,
  readLaunchTokenHost,
  scormShimScriptTag,
  SCORM_CONTENT_CSP,
  SCORM_IFRAME_SANDBOX,
} from "../ee/services/scorm/scormShim.ts";

/**
 * The shim is what a sandboxed SCORM package talks to instead of the player's
 * window.API. The SCORM API is synchronous, so every answer must come from the
 * shim's own cache, and every write must reach the player over postMessage.
 */

function makeWindow(seed, { storageThrows = false } = {}) {
  const parent = { postMessage: mock(() => {}) };
  const listeners = {};
  const appended = [];
  const document = {
    readyState: "complete",
    head: { appendChild: (node) => appended.push(node) },
    documentElement: { appendChild: (node) => appended.push(node) },
    getElementById: () => null,
    createElement: (tag) => ({ tag, children: [], appendChild(child) { this.children.push(child); } }),
    createTextNode: (text) => ({ text }),
    addEventListener: () => {},
  };
  const w = {
    parent,
    top: parent,
    frames: [],
    document,
    addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); },
  };
  if (seed) w.__LH_SCORM_SEED__ = seed;
  if (storageThrows) {
    Object.defineProperty(w, "localStorage", {
      configurable: true,
      get() { throw new Error("SecurityError: sandboxed"); },
    });
  }
  new Function("window", buildScormShimSource())(w);
  const dispatch = (type, event) => (listeners[type] || []).forEach((fn) => fn(event));
  const posted = () => parent.postMessage.mock.calls.map((c) => c[0]);
  return { w, parent, dispatch, posted, appended };
}

const seed12 = { version: "SCORM_12", cmi: { "cmi.core.entry": "resume", "cmi.suspend_data": "page=4" } };
const seed2004 = { version: "SCORM_2004", cmi: { "cmi.entry": "ab-initio", "cmi.location": "" } };

describe("SCORM 1.2 shim", () => {
  test("only the seeded version's API is defined", () => {
    const { w } = makeWindow(seed12);
    expect(typeof w.API.LMSInitialize).toBe("function");
    expect(w.API_1484_11).toBeUndefined();
  });

  test("reads answer synchronously from the seed, before and after Initialize", () => {
    const { w } = makeWindow(seed12);
    expect(w.API.LMSGetValue("cmi.suspend_data")).toBe("page=4");
    expect(w.API.LMSInitialize("")).toBe("true");
    expect(w.API.LMSGetValue("cmi.core.entry")).toBe("resume");
    expect(w.API.LMSGetValue("cmi.unknown")).toBe("");
    expect(w.API.LMSGetLastError()).toBe("0");
  });

  test("announces itself so the player can resync uncommitted state", () => {
    const { posted } = makeWindow(seed12);
    expect(posted()[0]).toEqual({ source: "lh-scorm", method: "hello", args: [] });
  });

  test("writes update the cache and are posted to the player", () => {
    const { w, parent, posted } = makeWindow(seed12);
    expect(w.API.LMSSetValue("cmi.core.lesson_status", "completed")).toBe("true");
    expect(w.API.LMSSetValue("cmi.core.score.raw", 90)).toBe("true");
    expect(w.API.LMSGetValue("cmi.core.lesson_status")).toBe("completed");
    expect(w.API.LMSGetValue("cmi.core.score.raw")).toBe("90");
    expect(posted().slice(1)).toEqual([
      { source: "lh-scorm", method: "setValue", args: ["cmi.core.lesson_status", "completed"] },
      { source: "lh-scorm", method: "setValue", args: ["cmi.core.score.raw", "90"] },
    ]);
    expect(parent.postMessage.mock.calls[1][1]).toBe("*");
  });

  test("read-only elements are refused locally and never posted", () => {
    const { w, posted } = makeWindow(seed12);
    expect(w.API.LMSSetValue("cmi.core.entry", "ab-initio")).toBe("false");
    expect(w.API.LMSGetLastError()).toBe("403");
    expect(w.API.LMSGetErrorString("403")).toBe("Element is read only");
    expect(w.API.LMSGetValue("cmi.core.entry")).toBe("resume");
    expect(posted()).toHaveLength(1); // just the hello
  });

  test("commit and finish are posted; nothing works after finish", () => {
    const { w, posted } = makeWindow(seed12);
    expect(w.API.LMSCommit("")).toBe("true");
    expect(w.API.LMSFinish("")).toBe("true");
    expect(posted().slice(1).map((m) => m.method)).toEqual(["commit", "terminate"]);
    expect(w.API.LMSGetValue("cmi.suspend_data")).toBe("");
    expect(w.API.LMSGetLastError()).toBe("101");
    expect(w.API.LMSSetValue("cmi.suspend_data", "x")).toBe("false");
    expect(w.API.LMSFinish("")).toBe("false");
    expect(posted()).toHaveLength(3);
  });
});

describe("SCORM 2004 shim", () => {
  test("defines API_1484_11 with 2004 error codes", () => {
    const { w, posted } = makeWindow(seed2004);
    expect(w.API).toBeUndefined();
    const api = w.API_1484_11;
    expect(api.Initialize("")).toBe("true");
    expect(api.SetValue("cmi.learner_id", "x")).toBe("false");
    expect(api.GetLastError()).toBe("404");
    expect(api.SetValue("cmi.suspend_data", "abc")).toBe("true");
    expect(api.GetValue("cmi.suspend_data")).toBe("abc");
    expect(api.Terminate("")).toBe("true");
    expect(api.Terminate("")).toBe("false");
    expect(api.GetLastError()).toBe("113");
    expect(api.GetErrorString("113")).toBe("Termination After Termination");
    expect(api.GetDiagnostic("0")).toBe("No Error");
    expect(posted().map((m) => m.method)).toEqual(["hello", "setValue", "terminate"]);
  });

  test("without a seed both APIs are offered", () => {
    const { w } = makeWindow(null);
    expect(w.API).toBeDefined();
    expect(w.API_1484_11).toBeDefined();
  });
});

describe("player resync", () => {
  test("state from the player fills the cache, but this page's own writes win", () => {
    const { w, parent, dispatch } = makeWindow(seed2004);
    w.API_1484_11.SetValue("cmi.location", "slide-9");
    dispatch("message", {
      source: parent,
      data: { source: "lh-scorm-sync", cmi: { "cmi.location": "slide-2", "cmi.suspend_data": "blob" } },
    });
    expect(w.API_1484_11.GetValue("cmi.location")).toBe("slide-9");
    expect(w.API_1484_11.GetValue("cmi.suspend_data")).toBe("blob");
  });

  test("sync messages from anyone but the parent are ignored", () => {
    const { w, dispatch } = makeWindow(seed2004);
    dispatch("message", { source: {}, data: { source: "lh-scorm-sync", cmi: { "cmi.location": "evil" } } });
    expect(w.API_1484_11.GetValue("cmi.location")).toBe("");
  });

  test("a nested frame's writes are applied and relayed up", () => {
    const { w, dispatch, posted } = makeWindow(seed12);
    const child = { postMessage: mock(() => {}) };
    w.frames.push(child);
    const msg = { source: "lh-scorm", method: "setValue", args: ["cmi.core.lesson_location", "p2"] };
    dispatch("message", { source: child, data: msg });
    expect(w.API.LMSGetValue("cmi.core.lesson_location")).toBe("p2");
    expect(posted().at(-1)).toEqual(msg);
    // And player state is passed down to it.
    dispatch("message", { source: w.parent, data: { source: "lh-scorm-sync", cmi: {} } });
    expect(child.postMessage).toHaveBeenCalled();
  });
});

describe("sandbox compatibility", () => {
  test("storage that throws in an opaque origin is replaced in memory", () => {
    const { w } = makeWindow(seed12, { storageThrows: true });
    w.localStorage.setItem("k", 1);
    expect(w.localStorage.getItem("k")).toBe("1");
    expect(w.localStorage.length).toBe(1);
  });

  test("layout CSS is applied inside the frame", () => {
    const { appended } = makeWindow(seed12);
    expect(appended[0].tag).toBe("style");
    expect(appended[0].children[0].text).toContain("#navDiv");
  });
});

describe("player-side message handling", () => {
  const runtime = () => ({
    setValue: mock(() => true),
    requestCommit: mock(() => "true"),
    requestTerminate: mock(() => "true"),
    getCmiSnapshot: mock(() => ({ "cmi.location": "slide-3" })),
  });

  test("writes, commits and terminates reach the runtime", () => {
    const r = runtime();
    handleShimMessage(r, { source: "lh-scorm", method: "setValue", args: ["cmi.location", "a"] });
    handleShimMessage(r, { source: "lh-scorm", method: "commit", args: [] });
    handleShimMessage(r, { source: "lh-scorm", method: "terminate", args: [] });
    expect(r.setValue).toHaveBeenCalledWith("cmi.location", "a");
    expect(r.requestCommit).toHaveBeenCalledTimes(1);
    expect(r.requestTerminate).toHaveBeenCalledTimes(1);
  });

  test("hello is answered with the live CMI", () => {
    expect(handleShimMessage(runtime(), { source: "lh-scorm", method: "hello" })).toEqual({
      source: "lh-scorm-sync",
      cmi: { "cmi.location": "slide-3" },
    });
  });

  test("anything else is ignored", () => {
    const r = runtime();
    for (const data of [
      null,
      "setValue",
      { source: "other", method: "commit" },
      { source: "lh-scorm", method: "setValue", args: ["a", { toString: () => "x" }] },
      { source: "lh-scorm", method: "constructor", args: [] },
    ]) {
      expect(handleShimMessage(r, data)).toBeNull();
    }
    expect(r.setValue).not.toHaveBeenCalled();
    expect(r.requestCommit).not.toHaveBeenCalled();
  });
});

describe("injection", () => {
  const inject = (html) => new TextDecoder().decode(injectScormShim(new TextEncoder().encode(html)));
  const TAG = new TextDecoder().decode(scormShimScriptTag());

  test("the tag is a single, ASCII script element", () => {
    expect(TAG.match(/<\/script>/g)).toHaveLength(1);
    expect([...TAG].every((ch) => ch.charCodeAt(0) < 128)).toBe(true);
  });

  test("goes after <head>, else <html>, else after the doctype", () => {
    expect(inject('<html><HEAD lang="x"><title>')).toBe(`<html><HEAD lang="x">${TAG}<title>`);
    expect(inject("<html><body><header>")).toBe(`<html>${TAG}<body><header>`);
    expect(inject("<!DOCTYPE html><p>x")).toBe(`<!DOCTYPE html>${TAG}<p>x`);
    expect(inject("<p>x")).toBe(`${TAG}<p>x`);
  });

  test("keeps non-UTF-8 bytes intact", () => {
    const latin1 = new Uint8Array([0x3c, 0x68, 0x65, 0x61, 0x64, 0x3e, 0xe9, 0x80]);
    const out = injectScormShim(latin1);
    expect(Array.from(out.slice(-2))).toEqual([0xe9, 0x80]);
    expect(out.length).toBe(latin1.length + scormShimScriptTag().length);
  });

  test("UTF-16 documents are left alone", () => {
    const bytes = new Uint8Array([0xff, 0xfe, 0x3c, 0x00]);
    expect(injectScormShim(bytes)).toBe(bytes);
  });
});

describe("token host and policy", () => {
  test("reads the host claim the API signed", () => {
    const payload = Buffer.from(JSON.stringify({ h: "org.example.com" })).toString("base64url");
    expect(readLaunchTokenHost(`v1.${payload}.sig`)).toBe("org.example.com");
    expect(readLaunchTokenHost("v1.!!.sig")).toBeNull();
    expect(readLaunchTokenHost("garbage")).toBeNull();
  });

  test("hosts compare without port or case", () => {
    expect(normalizeHost("Org.Example.com:3000")).toBe("org.example.com");
    expect(normalizeHost("[::1]:3000")).toBe("[::1]");
  });

  test("iframe sandbox matches the CSP and never allows same-origin", () => {
    expect(SCORM_CONTENT_CSP).toBe(`sandbox ${SCORM_IFRAME_SANDBOX}`);
    expect(SCORM_IFRAME_SANDBOX).not.toContain("allow-same-origin");
  });
});
