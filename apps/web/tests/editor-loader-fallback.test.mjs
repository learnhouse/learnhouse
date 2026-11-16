import { describe, expect, test } from "bun:test";

const { editorLoaderView, LOADER_STALL_MS, EDITOR_READY_FALLBACK_MS } = await import(
  "../components/Objects/Editor/editorLoaderState.ts"
);
const { healSessionMarker, needsSessionMarker } = await import("../lib/auth/sessionMarker.ts");

const base = { hasData: false, hasError: false, hasToken: false, authStatus: "loading", stalled: false };

describe("editor loader", () => {
  test("shows the editor as soon as the data is there, whatever else happened", () => {
    expect(editorLoaderView({ ...base, hasData: true })).toBe("editor");
    expect(editorLoaderView({ ...base, hasData: true, hasError: true, stalled: true, authStatus: "unauthenticated" })).toBe("editor");
  });

  test("keeps the skeleton only while something is on its way", () => {
    expect(editorLoaderView(base)).toBe("loading");
    expect(editorLoaderView({ ...base, hasToken: true, authStatus: "authenticated" })).toBe("loading");
  });

  test("no session to load with: says so instead of waiting forever", () => {
    expect(editorLoaderView({ ...base, authStatus: "unauthenticated" })).toBe("signed_out");
    // A token in hand means the request is (or will be) running
    expect(editorLoaderView({ ...base, hasToken: true, authStatus: "unauthenticated" })).toBe("loading");
  });

  test("failed or stalled loads offer a reload", () => {
    expect(editorLoaderView({ ...base, hasError: true })).toBe("error");
    expect(editorLoaderView({ ...base, stalled: true })).toBe("stalled");
    expect(editorLoaderView({ ...base, hasError: true, stalled: true })).toBe("error");
  });

  test("timeouts stay bounded", () => {
    expect(LOADER_STALL_MS).toBeLessThanOrEqual(20_000);
    expect(EDITOR_READY_FALLBACK_MS).toBeLessThanOrEqual(10_000);
  });
});

describe("session marker", () => {
  const jar = (values) => ({ get: (name) => (name in values ? { value: values[name] } : undefined) });
  const response = () => {
    const set = [];
    return { set, cookies: { set: (c) => set.push(c) } };
  };

  test("is restored when the refresh cookie outlived it", () => {
    expect(needsSessionMarker(jar({ LH_refresh: "r" }))).toBe(true);
    const res = response();
    expect(healSessionMarker({ cookies: jar({ LH_refresh: "r" }), nextUrl: { protocol: "https:" } }, res)).toBe(true);
    expect(res.set).toEqual([
      { name: "LH_session", value: "1", path: "/", maxAge: 30 * 24 * 60 * 60, httpOnly: false, sameSite: "lax", secure: true },
    ]);
  });

  test("is left alone for anonymous visitors and intact sessions", () => {
    for (const values of [{}, { LH_access: "a" }, { LH_refresh: "r", LH_session: "1" }, { LH_refresh: "" }]) {
      const res = response();
      expect(healSessionMarker({ cookies: jar(values), nextUrl: { protocol: "http:" } }, res)).toBe(false);
      expect(res.set).toEqual([]);
    }
  });

  test("is not marked Secure on plain http (local dev)", () => {
    const res = response();
    healSessionMarker({ cookies: jar({ LH_refresh: "r" }), nextUrl: { protocol: "http:" } }, res);
    expect(res.set[0].secure).toBe(false);
  });
});
