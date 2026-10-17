import { describe, expect, test } from "bun:test";

import { iframeSandboxFor, urlEmbedSandboxFor } from "../lib/media/embedSanitize.ts";

const BASE = "allow-scripts allow-popups allow-presentation allow-forms";
const TRUSTED = `${BASE} allow-popups-to-escape-sandbox allow-downloads allow-same-origin`;

describe("iframeSandboxFor", () => {
  test("known embed providers keep their own origin", () => {
    expect(iframeSandboxFor("https://www.youtube.com/embed/abc")).toBe(TRUSTED);
    expect(iframeSandboxFor("https://player.vimeo.com/video/1")).toBe(TRUSTED);
  });

  test("unknown, look-alike and non-https hosts get the base sandbox", () => {
    expect(iframeSandboxFor("https://evil.example/x")).not.toContain("allow-popups-to-escape-sandbox");
    expect(iframeSandboxFor("https://evil.example/x")).toBe(BASE);
    expect(iframeSandboxFor("https://youtube.com.evil.example/x")).toBe(BASE);
    expect(iframeSandboxFor("http://www.youtube.com/embed/abc")).toBe(BASE);
  });

  test("relative or missing src gets the base sandbox", () => {
    expect(iframeSandboxFor("/api/v1/whatever")).toBe(BASE);
    expect(iframeSandboxFor(null)).toBe(BASE);
  });
});

describe("urlEmbedSandboxFor", () => {
  const PAGE = "https://org.example.test";

  test("an external site keeps its origin but never gets top navigation", () => {
    const sandbox = urlEmbedSandboxFor("https://forms.example.com/f/1", PAGE);
    expect(sandbox).toBe(TRUSTED);
    expect(sandbox).not.toContain("allow-top-navigation");
  });

  test("an external site can open links in a normal tab and download files", () => {
    const sandbox = urlEmbedSandboxFor("https://docs.google.com/document/d/1", PAGE).split(" ");
    expect(sandbox).toContain("allow-popups-to-escape-sandbox");
    expect(sandbox).toContain("allow-downloads");
  });

  test("a URL on our own origin loses allow-same-origin", () => {
    expect(urlEmbedSandboxFor("https://org.example.test/api/v1/x", PAGE)).toBe(BASE);
    expect(urlEmbedSandboxFor("/api/v1/x", PAGE)).toBe(BASE);
  });

  test("an unparseable src gets the base sandbox", () => {
    expect(urlEmbedSandboxFor("not a url")).toBe(BASE);
    expect(urlEmbedSandboxFor(null)).toBe(BASE);
  });
});
