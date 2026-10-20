import { describe, expect, test } from "bun:test";

import { splitLinks } from "../lib/text/linkify.ts";

describe("splitLinks", () => {
  test("turns a bare https URL inside a sentence into a link segment", () => {
    expect(splitLinks("Refer to https://learnhouse.io to learn more.")).toEqual([
      { type: "text", value: "Refer to " },
      { type: "link", value: "https://learnhouse.io", href: "https://learnhouse.io" },
      { type: "text", value: " to learn more." },
    ]);
  });

  test("keeps paths and query strings but drops sentence punctuation", () => {
    const [, link] = splitLinks("See https://example.com/docs/page?x=1&y=2, then continue.");
    expect(link).toEqual({
      type: "link",
      value: "https://example.com/docs/page?x=1&y=2",
      href: "https://example.com/docs/page?x=1&y=2",
    });
  });

  test("prefixes www. hosts with https", () => {
    expect(splitLinks("Visit www.example.org!")).toEqual([
      { type: "text", value: "Visit " },
      { type: "link", value: "www.example.org", href: "https://www.example.org" },
      { type: "text", value: "!" },
    ]);
  });

  test("ignores non-web schemes", () => {
    expect(splitLinks("mail me at mailto:a@b.c or javascript:alert(1)")).toEqual([
      { type: "text", value: "mail me at mailto:a@b.c or javascript:alert(1)" },
    ]);
  });

  test("handles several links and multi-line text", () => {
    const segments = splitLinks("a https://one.test\nb https://two.test");
    expect(segments.filter((s) => s.type === "link").map((s) => s.href)).toEqual([
      "https://one.test",
      "https://two.test",
    ]);
    expect(segments[2]).toEqual({ type: "text", value: "\nb " });
  });

  test("keeps a balanced closing parenthesis that is part of the URL", () => {
    const [, link, rest] = splitLinks("see https://en.wikipedia.org/wiki/Foo_(bar)).");
    expect(link.value).toBe("https://en.wikipedia.org/wiki/Foo_(bar)");
    expect(rest).toEqual({ type: "text", value: ")." });
  });

  test("stops at Arabic and CJK punctuation", () => {
    expect(splitLinks("راجع www.example.com، ثم")[1].href).toBe("https://www.example.com");
    expect(splitLinks("https://example.com。next")[0].value).toBe("https://example.com");
  });

  test("stays linear on long adversarial input", () => {
    const n = 100_000;
    const inputs = [
      "https://a" + "(".repeat(n / 2) + ")".repeat(n / 2),
      "www.a" + ".".repeat(n) + "b",
      "www.a" + ".".repeat(n),
      "https://a" + ")".repeat(n),
    ];
    const started = performance.now();
    for (const input of inputs) splitLinks(input);
    expect(performance.now() - started).toBeLessThan(500);
  });

  test("returns nothing for empty input", () => {
    expect(splitLinks("")).toEqual([]);
    expect(splitLinks(null)).toEqual([]);
    expect(splitLinks(undefined)).toEqual([]);
  });
});
