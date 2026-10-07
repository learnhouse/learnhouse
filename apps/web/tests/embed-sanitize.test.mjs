import { describe, expect, test } from "bun:test";

import { iframeSandboxFor } from "../lib/media/embedSanitize.ts";

const BASE = "allow-scripts allow-popups allow-presentation allow-forms";

describe("iframeSandboxFor", () => {
  test("known embed providers keep their own origin", () => {
    expect(iframeSandboxFor("https://www.youtube.com/embed/abc")).toBe(`${BASE} allow-same-origin`);
    expect(iframeSandboxFor("https://player.vimeo.com/video/1")).toBe(`${BASE} allow-same-origin`);
  });

  test("unknown, look-alike and non-https hosts get the base sandbox", () => {
    expect(iframeSandboxFor("https://evil.example/x")).toBe(BASE);
    expect(iframeSandboxFor("https://youtube.com.evil.example/x")).toBe(BASE);
    expect(iframeSandboxFor("http://www.youtube.com/embed/abc")).toBe(BASE);
  });

  test("relative or missing src gets the base sandbox", () => {
    expect(iframeSandboxFor("/api/v1/whatever")).toBe(BASE);
    expect(iframeSandboxFor(null)).toBe(BASE);
  });
});
