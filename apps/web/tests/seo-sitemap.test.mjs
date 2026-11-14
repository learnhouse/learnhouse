import { describe, expect, test } from "bun:test";

import { buildSitemapIndex, buildUrlset, latestDate, sitemapDate, sitemapIndexEntries, sitemapUrls, xmlEscape } from "../lib/seo/sitemap.ts";
import { ROBOTS_DISALLOW, buildRobotsTxt, sanitizeRobotsRules } from "../lib/seo/robots.ts";

const data = {
  org: { slug: "acme", org_uuid: "org_1", name: "Acme", indexing_disabled: false, noindex_communities: false },
  courses: [
    { key: "intro-to-python", uuid: "course_1", name: "Intro & more", lastmod: "2026-11-05 01:33:02.174979", image: "t.png" },
    { key: "sql", uuid: "course_2", name: "SQL", lastmod: "2026-11-06 10:00:00", image: "" },
  ],
  activities: [{ course_key: "intro-to-python", key: "a1", lastmod: "2026-11-01 00:00:00" }],
  paths: [],
  podcasts: [{ key: "show", uuid: "podcast_1", name: "Show", lastmod: "", image: "" }],
  communities: [],
  discussions: [{ community_key: "club", key: "d1", name: "Hi", lastmod: "2026-11-07 00:00:00" }],
  folders: [],
};
const ctx = { base: "https://learn.acme.com", imageUrl: (type, e) => (e.image ? `https://cdn/${type}/${e.image}` : "") };

describe("xml helpers", () => {
  test("escape", () => {
    expect(xmlEscape(`a&b<c>"d'`)).toBe("a&amp;b&lt;c&gt;&quot;d&apos;");
  });
  test("dates are W3C datetimes", () => {
    expect(sitemapDate("2026-11-05 01:33:02.174979")).toBe("2026-11-05T01:33:02Z");
    expect(sitemapDate("")).toBeUndefined();
    expect(latestDate(["2026-01-01 00:00:00", "", "2026-03-01 00:00:00"])).toBe("2026-03-01T00:00:00.000Z");
  });
});

describe("urlset", () => {
  test("courses with image extension", () => {
    const xml = buildUrlset(sitemapUrls("courses", data, ctx));
    expect(xml).toContain('xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"');
    expect(xml).toContain("<loc>https://learn.acme.com/course/intro-to-python</loc>");
    expect(xml).toContain("<lastmod>2026-11-05T01:33:02Z</lastmod>");
    expect(xml).toContain("<image:loc>https://cdn/course/t.png</image:loc><image:title>Intro &amp; more</image:title>");
    expect(xml.match(/<url>/g)).toHaveLength(2);
  });
  test("no image namespace without images; no lastmod when unknown", () => {
    const xml = buildUrlset(sitemapUrls("podcasts", data, ctx));
    expect(xml).not.toContain("xmlns:image");
    expect(xml).not.toContain("<lastmod>");
  });
  test("activities and discussions nest under their parent slug", () => {
    expect(sitemapUrls("activities", data, ctx)[0].loc).toBe("https://learn.acme.com/course/intro-to-python/activity/a1");
    expect(sitemapUrls("discussions", data, ctx)[0].loc).toBe("https://learn.acme.com/community/club/discussion/d1");
    expect(sitemapUrls("folders", { ...data, folders: [{ key: "f", uuid: "folder_1", name: "F", lastmod: "", image: "" }] }, ctx)[0].loc).toBe(
      "https://learn.acme.com/library/folder/f",
    );
    expect(sitemapUrls("paths", data, ctx)).toEqual([]);
    expect(sitemapUrls("communities", data, ctx)).toEqual([]);
  });
  test("pages list only sections with content and that are shown", () => {
    const locs = sitemapUrls("pages", data, ctx).map((u) => u.loc);
    expect(locs).toEqual(["https://learn.acme.com/", "https://learn.acme.com/courses", "https://learn.acme.com/podcasts"]);
    const hidden = sitemapUrls("pages", data, { ...ctx, sections: { podcasts: false } }).map((u) => u.loc);
    expect(hidden).not.toContain("https://learn.acme.com/podcasts");
    const full = sitemapUrls("pages", { ...data, paths: data.podcasts, communities: data.podcasts, folders: data.podcasts }, ctx);
    expect(full).toHaveLength(6);
  });
  test("priority is clamped", () => {
    expect(buildUrlset([{ loc: "https://a", priority: 3 }])).toContain("<priority>1.0</priority>");
  });
});

describe("index", () => {
  test("lists non-empty child sitemaps with lastmod", () => {
    const entries = sitemapIndexEntries(data, "https://learn.acme.com");
    expect(entries.map((e) => e.loc.split("type=")[1])).toEqual(["pages", "courses", "activities", "podcasts", "discussions"]);
    const xml = buildSitemapIndex(entries);
    expect(xml).toContain("<sitemap><loc>https://learn.acme.com/sitemap.xml?type=courses</loc><lastmod>2026-11-06T10:00:00Z</lastmod></sitemap>");
    expect(buildSitemapIndex([{ loc: "https://a/s.xml" }])).toContain("<sitemap><loc>https://a/s.xml</loc></sitemap>");
  });
});

describe("robots.txt", () => {
  test("default rules + sitemap", () => {
    const txt = buildRobotsTxt({ sitemapUrl: "https://a/sitemap.xml" });
    expect(txt.startsWith("User-agent: *\nAllow: /\n")).toBe(true);
    for (const p of ROBOTS_DISALLOW) expect(txt).toContain(`Disallow: ${p}\n`);
    expect(txt.trim().endsWith("Sitemap: https://a/sitemap.xml")).toBe(true);
  });
  test("indexing disabled blocks everything", () => {
    expect(buildRobotsTxt({ sitemapUrl: "x", seo: { indexing_disabled: true } })).toBe("User-agent: *\nDisallow: /\n");
  });
  test("extra rules are filtered to known directives", () => {
    expect(sanitizeRobotsRules("User-agent: GPTBot\nDisallow: /\n# comment\n<script>\nnonsense\n\nCrawl-delay: 5")).toEqual([
      "User-agent: GPTBot",
      "Disallow: /",
      "Crawl-delay: 5",
    ]);
    expect(sanitizeRobotsRules(null)).toEqual([]);
    expect(buildRobotsTxt({ sitemapUrl: "x", seo: { robots_extra_rules: "User-agent: GPTBot\nDisallow: /" } })).toContain("# Custom rules\nUser-agent: GPTBot\nDisallow: /\n");
  });
});
