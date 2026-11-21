// removeQueryParamsFromAddressBar must pass a null state to replaceState, so
// Next's patched replaceState moves the router's canonical URL along. With
// Next's own state passed in, the router kept the token URL and Safari later
// hard-loaded it again: magic links were redeemed twice ("already used").

import { afterEach, describe, expect, test } from "bun:test";

const { removeQueryParamsFromAddressBar } = await import("../services/utils/ts/scrubUrl.ts");

function fakeWindow(href) {
  const calls = [];
  globalThis.window = {
    location: { href },
    history: {
      state: { __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: { tree: 1 } },
      replaceState: (...args) => calls.push(args),
    },
  };
  return calls;
}

afterEach(() => { delete globalThis.window; });

describe("removeQueryParamsFromAddressBar", () => {
  test("drops the token and replaces with a null state", () => {
    const calls = fakeWindow("http://x.test/auth/magic?token=abc&next=%2Fhome#h");
    removeQueryParamsFromAddressBar(["token"]);
    expect(calls).toEqual([[null, "", "/auth/magic?next=%2Fhome#h"]]);
  });

  test("does nothing when the param is absent", () => {
    const calls = fakeWindow("http://x.test/auth/magic?next=%2Fhome");
    removeQueryParamsFromAddressBar(["token"]);
    expect(calls).toEqual([]);
  });

  test("never throws (no window)", () => {
    expect(() => removeQueryParamsFromAddressBar(["token"])).not.toThrow();
  });
});
