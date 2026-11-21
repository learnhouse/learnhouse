// /plays and /copilot are friendly aliases. Done as a page-level redirect()
// they rendered inside the org layout and streamed a client redirect with a
// hydration error; they are real redirects in next.config.js instead.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../next.config.js", import.meta.url), "utf8");

describe("route alias redirects", () => {
  for (const [from, to] of [["/plays", "/playgrounds"], ["/copilot", "/messages"]]) {
    test(`${from} redirects to ${to}`, () => {
      const re = new RegExp(`source:\\s*'${from}',\\s*destination:\\s*'${to}',\\s*permanent:\\s*false`);
      expect(src).toMatch(re);
    });
  }
});
