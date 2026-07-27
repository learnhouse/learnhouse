// Contract test for the platform key used by pack activation and active-user
// overage billing.
//
// Same class of failure as the internal plan key: the key was read with a
// `|| ""` fallback, so an unset env var sent an empty header and the backend
// answered 500 "not configured on the server" — which read as a backend fault
// rather than a missing credential here. Both call sites must resolve it
// through one helper that fails loud.

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const { platformApiKey } = await import("../services/billing/packs.ts");

let original;

beforeEach(() => {
  original = process.env.LEARNHOUSE_PLATFORM_API_KEY;
});

afterEach(() => {
  if (original === undefined) delete process.env.LEARNHOUSE_PLATFORM_API_KEY;
  else process.env.LEARNHOUSE_PLATFORM_API_KEY = original;
});

describe("platformApiKey", () => {
  test("returns the configured key", () => {
    process.env.LEARNHOUSE_PLATFORM_API_KEY = "platform-key";
    expect(platformApiKey()).toBe("platform-key");
  });

  test("throws when unset instead of returning an empty key", () => {
    delete process.env.LEARNHOUSE_PLATFORM_API_KEY;
    expect(() => platformApiKey()).toThrow(/LEARNHOUSE_PLATFORM_API_KEY is unset/);
  });

  test("treats an empty string as unset", () => {
    process.env.LEARNHOUSE_PLATFORM_API_KEY = "";
    expect(() => platformApiKey()).toThrow(/LEARNHOUSE_PLATFORM_API_KEY is unset/);
  });
});
