// The browser's backend event sets must match the web events in the API's
// catalog (apps/api/src/services/analytics/events.py): the API drops events
// it doesn't know, and members-only ones from visitors who aren't signed in.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const { BACKEND_EVENTS, MEMBER_ONLY_BACKEND_EVENTS, BACKEND_ONLY_EVENTS } = await import("../services/analytics/events.ts");

const catalogPath = fileURLToPath(new URL("../../api/src/services/analytics/events.py", import.meta.url));
const source = readFileSync(catalogPath, "utf8");

// NAME = "wire_name" constants, then the _spec(NAME, ..., public=True|web=True) entries.
const names = Object.fromEntries([...source.matchAll(/^([A-Z][A-Z0-9_]*)\s*=\s*"([a-z0-9_]+)"/gm)].map((m) => [m[1], m[2]]));
const specs = [...source.matchAll(/_spec\(\s*([A-Z][A-Z0-9_]*)([^)]*)\)/g)].map((m) => ({
  name: names[m[1]],
  public: /public\s*=\s*True/.test(m[2]),
  web: /(public|web)\s*=\s*True/.test(m[2]),
}));
const webEvents = new Set(specs.filter((s) => s.web).map((s) => s.name));
const publicEvents = new Set(specs.filter((s) => s.public).map((s) => s.name));

const sorted = (set) => [...set].map(String).sort();

describe("backend event sets match the API catalog", () => {
  test("the catalog was parsed", () => {
    expect(webEvents.size).toBeGreaterThan(5);
    expect(webEvents.has("page_view")).toBe(true);
  });

  test("BACKEND_EVENTS is exactly the catalog's web events", () => {
    expect(sorted(BACKEND_EVENTS)).toEqual(sorted(webEvents));
  });

  test("MEMBER_ONLY_BACKEND_EVENTS is exactly the web events that aren't public", () => {
    expect(sorted(MEMBER_ONLY_BACKEND_EVENTS)).toEqual(sorted([...webEvents].filter((e) => !publicEvents.has(e))));
  });

  test("backend-only events are backend events", () => {
    for (const event of BACKEND_ONLY_EVENTS) expect(BACKEND_EVENTS.has(event)).toBe(true);
  });
});
