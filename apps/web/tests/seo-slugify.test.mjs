import { describe, expect, test } from "bun:test";

import { SLUG_MAX_LENGTH, isUuidKey, slugError, slugify, transliterate } from "../lib/seo/slugify.ts";

// Same fixtures as apps/api/src/tests/services/test_seo.py::test_slugify, so the
// live preview and the API agree.
const FIXTURES = [
  ["Intro to Python", "intro-to-python"],
  ["Café crème brûlée", "cafe-creme-brulee"],
  ["Straße & Æsir Øl", "strasse-aesir-ol"],
  ["Основы программирования", "osnovy-programmirovaniya"],
  ["Привіт Їжак", "privit-yizhak"],
  ["Μάθημα Ελληνικών", "mathima-ellinikon"],
  ["مقدمة في البرمجة", "mqdmh-fy-albrmjh"],
  ["שלום עולם", "shlvm-vlm"],
  ["Python 入门", "python"],
  ["入门课程", ""],
  ["Don't panic", "dont-panic"],
  ["ﬁle Ｆull", "file-full"],
  ["  --Hello--  ", "hello"],
  ["", ""],
  [null, ""],
];

describe("slugify", () => {
  for (const [input, expected] of FIXTURES) {
    test(`${JSON.stringify(input)} → ${JSON.stringify(expected)}`, () => {
      expect(slugify(input)).toBe(expected);
    });
  }

  test("truncates on a word boundary", () => {
    const slug = slugify("word ".repeat(40));
    expect(slug.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH);
    expect(slug.endsWith("-")).toBe(false);
    expect(slugify("a".repeat(120))).toBe("a".repeat(SLUG_MAX_LENGTH));
  });

  test("transliterate drops combining marks", () => {
    expect(transliterate("Ñandú")).toBe("nandu");
  });
});

describe("slugError", () => {
  test.each([
    ["", "empty"],
    ["a".repeat(SLUG_MAX_LENGTH + 1), "too_long"],
    ["Bad Slug", "invalid_characters"],
    ["double--dash", "invalid_characters"],
    ["65cddc73-8de4-437a-aa2a-08ae68b1492b", "looks_like_id"],
    ["new", "reserved"],
    ["fine-slug-2", null],
  ])("%s → %s", (slug, reason) => {
    expect(slugError(slug)).toBe(reason);
  });

  test("isUuidKey", () => {
    expect(isUuidKey("65CDDC73-8de4-437a-aa2a-08ae68b1492b")).toBe(true);
    expect(isUuidKey("seller-bootcamp")).toBe(false);
  });
});
