import { describe, expect, test } from "bun:test";

import { duplicateTitles, effectiveDescription, scoreGrade, seoChecks, seoScore, wordCount } from "../lib/seo/score.ts";
import { brandColor, clampText, readableOn, titleFontSize } from "../lib/seo/ogCard.ts";
import { coursePath, resourceKey, resourcePath, resourceSegment, stripResourcePrefix } from "../lib/seo/paths.ts";
import { clearLandingCache, landingDecision, matchLanding } from "../lib/seo/legacyRedirect.ts";

const good = {
  type: "course",
  name: "Intro to Python for complete beginners",
  slug: "intro-to-python",
  description: "Learn Python from zero: variables, loops, functions and a real project you can show, in five short weeks.",
  body: "word ".repeat(200),
  hasImage: true,
  seo: { image_alt: "Python logo", keywords: "python", faq: [{ question: "Q", answer: "A" }] },
  titleSuffixLength: 0,
  learnings: 4,
  chapters: 5,
  isPublic: true,
};
const ids = (checks) => checks.map((c) => c.id);

describe("seo checks", () => {
  test("a complete course scores 100", () => {
    const checks = seoChecks(good);
    expect(checks.every((c) => c.level === "pass" || c.level === "info" || c.id === "faq_ok")).toBe(true);
    expect(seoScore(checks)).toBe(100);
    expect(scoreGrade(100)).toBe("good");
  });
  test("an empty course gets actionable failures", () => {
    const checks = seoChecks({ type: "course", name: "", slug: "", description: "", hasImage: false, seo: { robots_noindex: true, canonical_url: "https://x" }, isPublic: false });
    expect(ids(checks)).toEqual(
      expect.arrayContaining(["title_missing", "description_missing", "slug_missing", "image_missing", "content_thin", "learnings_short", "faq_missing", "noindex", "not_public", "canonical_elsewhere"]),
    );
    expect(seoScore(checks)).toBeLessThan(30);
    expect(scoreGrade(seoScore(checks))).toBe("poor");
  });
  test("length warnings and slug quality", () => {
    const long = seoChecks({ ...good, name: "x".repeat(70), slug: "a-b-c-d-e-f-g-h-i-j", description: "d".repeat(200) });
    expect(ids(long)).toEqual(expect.arrayContaining(["title_long", "description_long", "slug_long"]));
    const short = seoChecks({ ...good, name: "Py", description: "Short.", slug: "intro-to-python-2", hasImage: false, chapters: 0, learnings: 1 });
    expect(ids(short)).toEqual(expect.arrayContaining(["title_short", "description_short", "slug_numbered", "image_missing", "syllabus_empty", "learnings_short"]));
    expect(ids(short)).not.toContain("alt_missing");
    expect(ids(seoChecks({ ...good, slug: "65cddc73-8de4-437a-aa2a-08ae68b1492b" }))).toContain("slug_missing");
    expect(ids(seoChecks({ ...good, seo: {} }))).toContain("alt_missing");
    expect(ids(seoChecks({ ...good, chapters: undefined }))).not.toContain("syllabus_ok");
    expect(scoreGrade(60)).toBe("ok");
  });
  test("keyword placement", () => {
    expect(ids(seoChecks({ ...good, seo: { keywords: "django" } }))).toContain("keyword_not_in_title");
    expect(ids(seoChecks({ ...good, seo: { keywords: "beginners" } }))).toContain("keyword_not_in_description");
  });
  test("suffix counts toward the title length; non-course types skip course checks", () => {
    expect(ids(seoChecks({ ...good, titleSuffixLength: 30 }))).toContain("title_long");
    const pod = seoChecks({ ...good, type: "podcast" });
    expect(ids(pod)).not.toContain("learnings_ok");
    expect(seoScore([])).toBe(100);
  });
  test("helpers", () => {
    expect(wordCount("<p>one two</p> three")).toBe(3);
    expect(wordCount("")).toBe(0);
    expect(effectiveDescription({ ...good, seo: { description: "custom" } })).toBe("custom");
    expect([...duplicateTitles([{ uuid: "a", title: "Same" }, { uuid: "b", title: "same " }, { uuid: "c", title: "Other" }, { uuid: "d", title: "" }])].sort()).toEqual(["a", "b"]);
  });
});

describe("og card helpers", () => {
  test("brand color + contrast", () => {
    expect(brandColor("#ff0000")).toBe("#ff0000");
    expect(brandColor("red")).toBe("#111827");
    expect(readableOn("#ffffff")).toBe("#111827");
    expect(readableOn("#111827")).toBe("#ffffff");
  });
  test("text clamp + title size", () => {
    expect(clampText("hello world again", 12)).toBe("hello world…");
    expect(clampText(null, 5)).toBe("");
    expect(clampText("short", 10)).toBe("short");
    expect([titleFontSize("x".repeat(20)), titleFontSize("x".repeat(40)), titleFontSize("x".repeat(60)), titleFontSize("x".repeat(90))]).toEqual([72, 60, 52, 44]);
  });
});

describe("public paths", () => {
  test("slug first, uuid fallback", () => {
    expect(coursePath({ slug: "py", course_uuid: "course_1" })).toBe("/course/py");
    expect(coursePath({ course_uuid: "course_1" })).toBe("/course/1");
    expect(resourcePath("folder", { folder_uuid: "folder_9" })).toBe("/library/folder/9");
    expect(resourceKey("path", null, "path_3")).toBe("3");
    expect(stripResourcePrefix("community", undefined)).toBe("");
    expect(resourceSegment("podcast")).toBe("/podcast/");
  });
});

describe("proxy landing decisions", () => {
  const UUID = "65cddc73-8de4-437a-aa2a-08ae68b1492b";
  const respond = (status, body) => async () => ({ status, ok: status < 300, json: async () => body });

  test("matchLanding", () => {
    expect(matchLanding(`/course/${UUID.toUpperCase()}`)).toEqual({ type: "course", key: UUID, segment: "/course/", isUuid: true });
    expect(matchLanding("/library/folder/shelf/")).toMatchObject({ type: "folder", key: "shelf", isUuid: false });
    expect(matchLanding("/course/x/activity/y")).toBeNull();
    expect(matchLanding("/course/%E0%A4%A")).toBeNull();
  });
  test("uuid URLs redirect for everyone; slugs only checked for bots", async () => {
    clearLandingCache();
    const redirect = respond(200, { redirect: true, canonical_key: "intro-to-python" });
    expect(await landingDecision("api/", "acme", `/course/${UUID}`, { isBot: false }, redirect)).toEqual({ redirect: "/course/intro-to-python" });
    // cached
    expect(await landingDecision("api/", "acme", `/course/${UUID}`, { isBot: false }, async () => { throw new Error("no fetch"); })).toEqual({ redirect: "/course/intro-to-python" });
    expect(await landingDecision("api/", "acme", "/course/old-slug", { isBot: false }, redirect)).toBeNull();
    expect(await landingDecision("api/", "acme", "/course/old-slug", { isBot: true }, redirect)).toEqual({ redirect: "/course/intro-to-python" });
    expect(await landingDecision("api/", "acme", "/course/current", { isBot: true }, respond(200, { redirect: false, canonical_key: "current" }))).toBeNull();
  });
  test("slug redirects are never cached (a rename back must not loop)", async () => {
    clearLandingCache();
    const toB = respond(200, { redirect: true, canonical_key: "b" });
    expect(await landingDecision("api/", "acme", "/course/a", { isBot: true }, toB)).toEqual({ redirect: "/course/b" });
    // "a" became current again: the next lookup must ask the API, not reuse the redirect.
    expect(await landingDecision("api/", "acme", "/course/a", { isBot: true }, respond(200, { redirect: false, canonical_key: "a" }))).toBeNull();
    // ...while that "no redirect" answer is cached briefly, then expires.
    const boom = async () => { throw new Error("no fetch"); };
    expect(await landingDecision("api/", "acme", "/course/a", { isBot: true }, boom, Date.now() + 1000)).toBeNull();
    expect(await landingDecision("api/", "acme", "/course/a", { isBot: true }, toB, Date.now() + 60_000)).toEqual({ redirect: "/course/b" });
  });
  test("missing resources 404 for bots only; API errors never block", async () => {
    clearLandingCache();
    expect(await landingDecision("api/", "acme", "/podcast/gone", { isBot: true }, respond(404, {}))).toEqual({ notFound: true });
    expect(await landingDecision("api/", "acme", `/podcast/${UUID}`, { isBot: false }, respond(404, {}))).toBeNull();
    expect(await landingDecision("api/", "acme", "/path/x", { isBot: true }, respond(500, {}))).toBeNull();
    expect(await landingDecision("api/", "acme", "/path/y", { isBot: true }, async () => { throw new Error("down"); })).toBeNull();
    expect(await landingDecision("api/", "acme", "/courses", { isBot: true }, respond(200, {}))).toBeNull();
  });
});
