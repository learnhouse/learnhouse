import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

import {
  formatCurrency,
  formatDate,
  formatNumber,
  formatPercent,
  normalizeLanguageTag,
} from "../lib/format.ts";

/**
 * A language tag is untrusted input. It comes from `navigator.language` (glibc
 * hosts report POSIX forms like `en-US@posix`), from a user-supplied `?lng=`,
 * or from the `i18next` cookie / `i18nextLng` localStorage entry that i18next
 * writes back. Any of them reaching an Intl constructor raw throws
 * `RangeError: Invalid language tag` and takes the render down — and because
 * the detector CACHES what it accepted, the crash then repeats on every load
 * until the user clears site data.
 *
 * So the invariant is blunt: no tag, however malformed, may make a formatter
 * throw, and every one must still produce a usable string.
 */

// The exact tag from the production RangeError, plus the neighbouring shapes a
// POSIX/glibc host or a hand-edited cookie realistically produces.
const BAD_TAGS = [
  "en-US@posix",
  "en_US",
  "en_US@posix",
  "C",
  "POSIX",
  "zz",
  "",
  "   ",
  "!!! not a locale !!!",
  "en-US-u-nu-latn@euro",
  undefined,
  null,
];

const GOOD_TAGS = ["en", "en-US", "ar", "fa", "fr", "pt-BR", "zh-Hans-CN"];

describe("normalizeLanguageTag", () => {
  test("every tag, good or malformed, yields a tag Intl accepts", () => {
    for (const tag of [...BAD_TAGS, ...GOOD_TAGS]) {
      const normalized = normalizeLanguageTag(tag);
      expect(typeof normalized).toBe("string");
      expect(normalized.length).toBeGreaterThan(0);
      // The oracle: if Intl.getCanonicalLocales accepts it, so do the
      // DateTimeFormat/NumberFormat constructors.
      expect(() => Intl.getCanonicalLocales(normalized)).not.toThrow();
    }
  });

  test("recoverable spellings keep the language, they do not fall back to English", () => {
    expect(normalizeLanguageTag("en-US@posix")).toBe("en-US");
    expect(normalizeLanguageTag("en_US")).toBe("en-US");
    expect(normalizeLanguageTag("fr_CA@euro")).toBe("fr-CA");
    // A valid tag is returned untouched.
    expect(normalizeLanguageTag("pt-BR")).toBe("pt-BR");
  });

  test("unrecoverable input degrades to English rather than throwing", () => {
    expect(normalizeLanguageTag("C")).toBe("en");
    expect(normalizeLanguageTag("!!! not a locale !!!")).toBe("en");
    expect(normalizeLanguageTag("")).toBe("en");
    expect(normalizeLanguageTag(undefined)).toBe("en");
    expect(normalizeLanguageTag(null)).toBe("en");
  });
});

describe("formatters survive a malformed tag", () => {
  // Everything in lib/format.ts routes through intlLocale(), so one bad tag
  // would otherwise crash dates, numbers, prices and percentages alike.
  test("no formatter throws on any malformed tag", () => {
    for (const tag of BAD_TAGS) {
      expect(() => formatDate(0, tag)).not.toThrow();
      expect(() => formatNumber(1234.5, tag)).not.toThrow();
      expect(() => formatCurrency(10, "USD", tag)).not.toThrow();
      expect(() => formatPercent(0.42, tag)).not.toThrow();
    }
  });

  test("en-US@posix formats exactly as en-US does", () => {
    expect(formatDate(0, "en-US@posix")).toBe(formatDate(0, "en-US"));
    expect(formatCurrency(10, "USD", "en-US@posix")).toBe(formatCurrency(10, "USD", "en-US"));
  });

  test("Arabic and Persian still get Latin digits", () => {
    // The deliberate `-u-nu-latn` product decision must survive normalisation —
    // including for a tag that only became usable after the '@modifier' strip.
    const easternDigits = /[٠-٩۰-۹]/;
    expect(formatNumber(2024, "ar")).not.toMatch(easternDigits);
    expect(formatNumber(2024, "ar")).toMatch(/2.?024/);
    expect(formatNumber(2024, "fa-IR@calendar=persian")).not.toMatch(easternDigits);
    expect(formatNumber(2024, "fa-IR@calendar=persian")).toMatch(/2.?024/);
  });
});

describe("the detector cannot cache a poisoned tag", () => {
  // i18next's `caches: ['localStorage', 'cookie']` writes back whatever the
  // detector accepted. Without convertDetectedLanguage a single `en-US@posix`
  // sticks to the user forever; guarding format.ts alone would not unstick them.
  test("lib/i18n.ts canonicalises detected languages before they are cached", () => {
    const src = fs.readFileSync(
      path.join(path.resolve(import.meta.dirname, ".."), "lib/i18n.ts"),
      "utf8",
    );
    // Anchored on the exact option key: a renamed or misspelt key is silently
    // ignored by i18next, so `toContain("convertDetectedLanguage")` would still
    // pass for `convertDetectedLanguageDISABLED` and pin nothing.
    expect(src).toMatch(
      /\bconvertDetectedLanguage\s*:\s*\([^)]*\)\s*=>\s*normalizeLanguageTag\(/,
    );
    expect(src).toMatch(/\bcaches\s*:/);
  });
});
