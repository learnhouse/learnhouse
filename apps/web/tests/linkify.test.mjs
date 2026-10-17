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

  test("returns nothing for empty input", () => {
    expect(splitLinks("")).toEqual([]);
    expect(splitLinks(null)).toEqual([]);
    expect(splitLinks(undefined)).toEqual([]);
  });
});
