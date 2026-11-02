import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

describe("root not-found page", () => {
  // A prerendered 404 turns an unknown Server Action posted to a missing path
  // into a 500 ("Expected RSC response, got text/plain") instead of a 404.
  test("is rendered per request", () => {
    const source = readFileSync(new URL("../app/not-found.tsx", import.meta.url), "utf8");
    expect(source).toMatch(/export const dynamic = 'force-dynamic'/);
  });
});
