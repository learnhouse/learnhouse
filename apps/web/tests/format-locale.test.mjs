import { describe, expect, test } from "bun:test";

import { formatDate, formatNumber, intlLocale } from "../lib/format.ts";

describe("intlLocale", () => {
  test("keeps valid tags and forces Latin digits for ar/fa", () => {
    expect(intlLocale("fr")).toBe("fr");
    expect(intlLocale("pt-BR")).toBe("pt-BR");
    expect(intlLocale("ar")).toBe("ar-u-nu-latn");
    expect(intlLocale("fa-IR")).toBe("fa-u-nu-latn");
  });

  test("repairs underscore tags instead of throwing", () => {
    expect(intlLocale("en_US")).toBe("en-US");
    expect(intlLocale("ar_EG")).toBe("ar-u-nu-latn");
  });

  test("falls back to English for missing or malformed tags", () => {
    expect(intlLocale(undefined)).toBe("en");
    expect(intlLocale("")).toBe("en");
    expect(intlLocale("!!")).toBe("en");
  });
});

describe("formatters never throw on a bad locale", () => {
  test("formatDate", () => {
    expect(() => formatDate("2026-01-15T10:00:00Z", "en_US")).not.toThrow();
    expect(() => formatDate("2026-01-15T10:00:00Z", "not a locale")).not.toThrow();
  });

  test("formatNumber", () => {
    expect(() => formatNumber(1234.5, "@@")).not.toThrow();
  });
});
