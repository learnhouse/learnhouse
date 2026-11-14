import { describe, expect, test } from "bun:test";

import {
  clipDescription,
  keywordList,
  ogLocale,
  orgLanguage,
  parseLearnings,
  prosemirrorText,
  robotsMetadata,
  seoImageUrl,
  verificationMetadata,
} from "../lib/seo/meta.ts";
import { buildPageTitle } from "../lib/seo/utils.ts";

describe("metadata helpers", () => {
  test("robots combine org switch, resource settings and visibility", () => {
    expect(robotsMetadata({}).index).toBe(true);
    expect(robotsMetadata({ orgSeo: { indexing_disabled: true } })).toMatchObject({ index: false, follow: false });
    expect(robotsMetadata({ seo: { robots_noindex: true } })).toMatchObject({ index: false, follow: true });
    expect(robotsMetadata({ seo: { robots_nofollow: true } })).toMatchObject({ index: true, follow: false });
    expect(robotsMetadata({ indexable: false }).googleBot).toMatchObject({ index: false, "max-image-preview": "large" });
  });
  test("verification tags", () => {
    expect(verificationMetadata({})).toBeUndefined();
    expect(verificationMetadata({ google_site_verification: "g", yandex_verification: "y", bing_site_verification: "b", pinterest_verification: "p" })).toEqual({
      google: "g",
      yandex: "y",
      other: { "msvalidate.01": "b", "p:domain_verify": "p" },
    });
  });
  test("share image: absolute URL or uploaded file name", () => {
    expect(seoImageUrl("org_1", "https://cdn/x.png")).toBe("https://cdn/x.png");
    expect(seoImageUrl("org_1", "og_1.png")).toContain("content/orgs/org_1/og_images/og_1.png");
    expect(seoImageUrl("org_1", "../x")).toBeUndefined();
    expect(seoImageUrl(undefined, "og_1.png")).toBeUndefined();
    expect(seoImageUrl("org_1", null)).toBeUndefined();
  });
  test("locale", () => {
    expect(orgLanguage({ config: { config: { customization: { general: { default_language: "pt-BR" } } } } })).toBe("pt");
    expect(orgLanguage(null)).toBe("en");
    expect(ogLocale("fr")).toBe("fr_FR");
    expect(ogLocale("xx")).toBe("xx_XX");
  });
  test("text helpers", () => {
    expect(keywordList("a, b,,c")).toEqual(["a", "b", "c"]);
    expect(keywordList(["x", " "])).toEqual(["x"]);
    expect(keywordList("")).toBeUndefined();
    expect(parseLearnings('[{"text":"Loops"},"Vars","",null,"null"]')).toEqual(["Loops", "Vars"]);
    expect(parseLearnings("one\ntwo")).toEqual(["one", "two"]);
    expect(parseLearnings(42)).toEqual([]);
    expect(clipDescription("short")).toBe("short");
    const clipped = clipDescription("word ".repeat(60));
    expect(clipped.length).toBeLessThanOrEqual(160);
    expect(clipped.endsWith("…")).toBe(true);
    expect(clipDescription(null)).toBe("");
  });
  test("prosemirror text", () => {
    const doc = { type: "doc", content: [{ type: "heading", content: [{ type: "text", text: "Title" }] }, { type: "paragraph", content: [{ type: "text", text: "Body text" }] }] };
    expect(prosemirrorText(doc)).toBe("Title Body text");
    expect(prosemirrorText(JSON.stringify(doc), 5)).toBe("Title");
    expect(prosemirrorText("plain")).toBe("plain");
    expect(prosemirrorText(null)).toBe("");
  });
  test("title template", () => {
    expect(buildPageTitle("Intro", "Acme", { default_title_template: "%s · %org" })).toBe("Intro · Acme");
    expect(buildPageTitle("Intro", "Acme", { default_meta_title_suffix: " - Acme" })).toBe("Intro - Acme");
    expect(buildPageTitle("Intro", "Acme", {})).toBe("Intro | Acme");
    expect(buildPageTitle("Intro", "Acme", undefined)).toBe("Intro | Acme");
  });
});
