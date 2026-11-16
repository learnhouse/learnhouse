import { describe, expect, test } from "bun:test";

import {
  contentLangCookie,
  contentLangStorageKeys,
  courseDefaultLocale,
  courseLocales,
  hasTranslations,
  langParam,
  parseLangParam,
  resolveContentLanguagePrefs,
  servedLocale,
  showsTranslationFallback,
} from "../lib/contentLanguage.ts";
import {
  canonicalForLocale,
  courseLanguageSeo,
  courseLocaleList,
  languageAlternates,
  publishedLocaleFor,
  sitemapLanguageLinks,
  withLangParam,
} from "../lib/seo/alternates.ts";
import { buildUrlset, languageVersions, sitemapUrls } from "../lib/seo/sitemap.ts";
import { ogLocale } from "../lib/seo/meta.ts";

const BASE = "https://acme.test/course/intro";

describe("content language preferences", () => {
  test("parseLangParam takes the first valid locale", () => {
    expect(parseLangParam("fr")).toBe("fr");
    expect(parseLangParam("pt_br,en")).toBe("pt-BR");
    expect(parseLangParam(["!!", "de"])).toBe(null);
    expect(parseLangParam("!!,de")).toBe("de");
    expect(parseLangParam("")).toBe(null);
    expect(parseLangParam(undefined)).toBe(null);
  });

  test("explicit URL beats the tab copy, which beats the remembered choice", () => {
    const base = { uiLanguage: "en", browser: ["de-DE", "de"] };
    expect(resolveContentLanguagePrefs({ ...base, urlLang: "fr", sessionLang: "es", storedLang: "it" })).toEqual(["fr", "en", "de-DE", "de"]);
    expect(resolveContentLanguagePrefs({ ...base, sessionLang: "es", storedLang: "it" })[0]).toBe("es");
    expect(resolveContentLanguagePrefs({ ...base, storedLang: "it" })[0]).toBe("it");
  });

  test("without a choice: UI language, then browser languages, deduplicated", () => {
    expect(resolveContentLanguagePrefs({ uiLanguage: "ar", browser: ["fr-FR", "ar", "en"] })).toEqual(["ar", "fr-FR", "en"]);
    expect(resolveContentLanguagePrefs({ urlLang: "nope!", uiLanguage: "en" })).toEqual(["en"]);
    expect(langParam(["fr", "en"])).toBe("fr,en");
    expect(langParam([])).toBe("");
  });

  test("remembered choice is per user with a global fallback", () => {
    expect(contentLangStorageKeys(42)).toEqual(["lh_content_lang:42", "lh_content_lang"]);
    expect(contentLangStorageKeys(null)).toEqual(["lh_content_lang"]);
    expect(contentLangCookie("fr")).toContain("lh_content_lang=fr; path=/; max-age=31536000");
    expect(contentLangCookie(null)).toContain("max-age=0");
  });

  test("course locales: default first, then published translations", () => {
    const course = { default_locale: "en", available_locales: ["fr", "pt_br", "fr"], locale: "fr" };
    expect(courseLocales(course)).toEqual(["en", "fr", "pt-BR"]);
    expect(hasTranslations(course)).toBe(true);
    expect(hasTranslations({ default_locale: "en", available_locales: [] })).toBe(false);
    expect(courseDefaultLocale({}, "de")).toBe("de");
    expect(courseDefaultLocale({})).toBe("en");
    expect(servedLocale(course)).toBe("fr");
    expect(servedLocale({ default_locale: "es" })).toBe("es");
  });

  test("fallback notice only when the course is read in another language", () => {
    const course = { default_locale: "en", available_locales: ["fr"], locale: "fr" };
    expect(showsTranslationFallback({ translation_fallback: true }, course)).toBe(true);
    expect(showsTranslationFallback({ translation_fallback: false }, course)).toBe(false);
    expect(showsTranslationFallback({ translation_fallback: true }, { ...course, locale: "en" })).toBe(false);
    expect(showsTranslationFallback(undefined, course)).toBe(false);
  });
});

describe("hreflang and canonical", () => {
  test("published locale matching: exact, then base language, never the default", () => {
    expect(publishedLocaleFor("fr", "en", ["fr", "de"])).toBe("fr");
    expect(publishedLocaleFor("fr-CA", "en", ["fr"])).toBe("fr");
    expect(publishedLocaleFor("en", "en", ["fr"])).toBe(null);
    expect(publishedLocaleFor("en-GB", "en", ["fr"])).toBe(null);
    expect(publishedLocaleFor("it", "en", ["fr"])).toBe(null);
    expect(publishedLocaleFor(null, "en", ["fr"])).toBe(null);
  });

  test("withLangParam keeps other params and the hash", () => {
    expect(withLangParam(BASE, "fr")).toBe(`${BASE}?lang=fr`);
    expect(withLangParam(`${BASE}?a=1#x`, "fr")).toBe(`${BASE}?a=1&lang=fr#x`);
    expect(withLangParam(`${BASE}?lang=fr`, null)).toBe(BASE);
  });

  test("alternates: one per version plus x-default; none for single-language courses", () => {
    expect(languageAlternates(BASE, "en", ["fr", "ar"])).toEqual({
      en: BASE,
      fr: `${BASE}?lang=fr`,
      ar: `${BASE}?lang=ar`,
      "x-default": BASE,
    });
    expect(languageAlternates(BASE, "en", [])).toBeUndefined();
    expect(languageAlternates(BASE, "en", null)).toBeUndefined();
    expect(courseLocaleList(null, ["fr"])).toEqual(["en", "fr"]);
  });

  test("canonical carries ?lang only for a served translation", () => {
    expect(canonicalForLocale(BASE, "fr", "en")).toBe(`${BASE}?lang=fr`);
    expect(canonicalForLocale(BASE, "en", "en")).toBe(BASE);
    expect(canonicalForLocale(BASE, null, "en")).toBe(BASE);
  });

  test("courseLanguageSeo: requested + served translation", () => {
    const seo = courseLanguageSeo({ baseUrl: BASE, requested: "fr", servedByApi: "fr", defaultLocale: "en", available: ["fr", "de"] });
    expect(seo.translation).toBe("fr");
    expect(seo.locale).toBe("fr");
    expect(seo.canonical).toBe(`${BASE}?lang=fr`);
    expect(seo.alternateLocales).toEqual(["en", "de"]);
    expect(seo.languages?.["x-default"]).toBe(BASE);
  });

  test("courseLanguageSeo: unknown or unpublished lang is the default version", () => {
    const unknown = courseLanguageSeo({ baseUrl: BASE, requested: "it", servedByApi: "en", defaultLocale: "en", available: ["fr"] });
    expect(unknown.translation).toBe(null);
    expect(unknown.canonical).toBe(BASE);
    // API not serving it (e.g. still ignoring `lang`): default version too.
    const ignored = courseLanguageSeo({ baseUrl: BASE, requested: "fr", servedByApi: undefined, defaultLocale: "en", available: ["fr"] });
    expect(ignored.canonical).toBe(BASE);
    // No ?lang at all on a multilingual course.
    const none = courseLanguageSeo({ baseUrl: BASE, requested: null, servedByApi: "fr", defaultLocale: "en", available: ["fr"] });
    expect(none.translation).toBe(null);
    expect(none.alternateLocales).toEqual(["fr"]);
  });

  test("courseLanguageSeo: single-language course changes nothing", () => {
    const seo = courseLanguageSeo({ baseUrl: BASE, requested: "fr", servedByApi: "en", defaultLocale: "en", available: [] });
    expect(seo.canonical).toBe(BASE);
    expect(seo.languages).toBeUndefined();
    expect(seo.alternateLocales).toEqual([]);
  });

  test("ogLocale handles regions and scripts", () => {
    expect(ogLocale("fr")).toBe("fr_FR");
    expect(ogLocale("pt-BR")).toBe("pt_BR");
    expect(ogLocale("zh-Hant")).toBe("zh_TW");
    expect(ogLocale("zh-Hans")).toBe("zh_CN");
    expect(ogLocale("es-419")).toBe("es_LA");
  });
});

describe("sitemap language versions", () => {
  test("sitemapLanguageLinks mirrors the page's hreflang set", () => {
    expect(sitemapLanguageLinks(BASE, "en", ["fr"])).toEqual([
      { hreflang: "en", href: BASE },
      { hreflang: "fr", href: `${BASE}?lang=fr` },
      { hreflang: "x-default", href: BASE },
    ]);
    expect(sitemapLanguageLinks(BASE, "en", [])).toEqual([]);
  });

  test("one <url> per version, each with every alternate", () => {
    const urls = languageVersions({ loc: BASE, priority: 0.9, images: [{ loc: "https://cdn/t.png" }] }, { default_locale: "en", available_locales: ["fr"] });
    expect(urls.map((u) => u.loc)).toEqual([BASE, `${BASE}?lang=fr`]);
    expect(urls[0].alternates).toHaveLength(3);
    expect(urls[1].alternates).toEqual(urls[0].alternates);
    expect(urls[1].images).toBeUndefined();
    expect(languageVersions({ loc: BASE }, { default_locale: "en", available_locales: [] })).toEqual([{ loc: BASE }]);
  });

  test("courses child sitemap: xhtml links + namespace only when needed", () => {
    const data = {
      org: { slug: "acme", org_uuid: "org_1", name: "Acme", indexing_disabled: false, noindex_communities: false },
      courses: [
        { key: "intro", uuid: "course_1", name: "Intro", lastmod: "2026-11-05 01:33:02", image: "", default_locale: "en", available_locales: ["fr"] },
        { key: "sql", uuid: "course_2", name: "SQL", lastmod: "2026-11-06 10:00:00", image: "" },
      ],
      activities: [], paths: [], podcasts: [], communities: [], discussions: [], folders: [],
    };
    const ctx = { base: "https://acme.test", imageUrl: () => "" };
    const urls = sitemapUrls("courses", data, ctx);
    expect(urls.map((u) => u.loc)).toEqual(["https://acme.test/course/intro", "https://acme.test/course/intro?lang=fr", "https://acme.test/course/sql"]);
    const xml = buildUrlset(urls);
    expect(xml).toContain('xmlns:xhtml="http://www.w3.org/1999/xhtml"');
    expect(xml).toContain('<xhtml:link rel="alternate" hreflang="fr" href="https://acme.test/course/intro?lang=fr"/>');
    expect(xml).toContain('<loc>https://acme.test/course/intro?lang=fr</loc>');
    expect(xml).toContain('hreflang="x-default" href="https://acme.test/course/intro"');
    const plain = buildUrlset(sitemapUrls("courses", { ...data, courses: [data.courses[1]] }, ctx));
    expect(plain).not.toContain("xhtml");
  });
});
