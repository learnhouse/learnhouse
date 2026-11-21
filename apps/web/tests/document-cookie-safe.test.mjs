// document.cookie throws in an iframe sandboxed without allow-same-origin.
// Shared code goes through lib/cookies so a blocked jar reads as empty and
// writes are dropped, instead of crashing embedded pages.

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const { readDocumentCookie, writeDocumentCookie } = await import("../lib/cookies.ts");

const blockedDocument = () => {
  const doc = {};
  Object.defineProperty(doc, "cookie", {
    get() { throw new Error("SecurityError: sandboxed"); },
    set() { throw new Error("SecurityError: sandboxed"); },
  });
  return doc;
};

afterEach(() => { delete globalThis.document; });

describe("lib/cookies", () => {
  test("no document: empty string, writes ignored", () => {
    expect(readDocumentCookie()).toBe("");
    expect(() => writeDocumentCookie("a=1")).not.toThrow();
  });

  test("normal document: passes through", () => {
    globalThis.document = { cookie: "LH_session=1; x=2" };
    expect(readDocumentCookie()).toBe("LH_session=1; x=2");
    writeDocumentCookie("y=3");
    expect(globalThis.document.cookie).toBe("y=3");
  });

  test("blocked document: reads empty, writes are no-ops", () => {
    globalThis.document = blockedDocument();
    expect(readDocumentCookie()).toBe("");
    expect(() => writeDocumentCookie("a=1")).not.toThrow();
  });
});

describe("shared code uses it", () => {
  const files = [
    "../components/Contexts/AuthContext.tsx",
    "../components/Auth/TurnstileWidget.tsx",
    "../components/Impersonation/ImpersonationBanner.tsx",
    "../lib/auth/impersonation.ts",
    "../services/auth/redirects.ts",
    "../services/auth/sessionMarker.ts",
    "../services/billing/region.ts",
  ];
  for (const f of files) {
    test(`${f.replace("../", "")} has no raw document.cookie access`, () => {
      const src = readFileSync(new URL(f, import.meta.url), "utf8");
      expect(src).not.toMatch(/document\.cookie/);
      expect(src).toContain("from '@/lib/cookies'");
    });
  }
});
