// The SaaS-only anti-abuse gates (Turnstile, disposable-email) key off
// isSaaSMode(). It must come from the backend, never from the client-settable
// LH_mode cookie. All fixtures are synthetic.

import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

mock.module("next/headers", () => ({
  cookies: async () => ({ get: (name) => (name === "LH_mode" ? { value: "oss" } : undefined) }),
  headers: async () => new Headers(),
}));

mock.module("@lib/eeGate", () => ({
  fetchInstanceMode: async () => "saas",
}));

const { isSaaSMode } = await import("../lib/saas.ts");

describe("isSaaSMode", () => {
  test("ignores a forged LH_mode=oss cookie", async () => {
    expect(await isSaaSMode()).toBe(true);
  });
});
