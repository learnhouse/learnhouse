import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";

import { audioMime, buildAtom, buildFeed, buildJsonFeed, buildPodcastRss, buildRss, itunesDuration, podcastGuid, xmlSafe } from "../lib/seo/feeds.ts";
import { feedDocFromApi, feedUrls, podcastFeedFromApi } from "../lib/seo/feedMapping.ts";
import { buildLlmsTxt, canonicalPathFor, markdownFor, markdownPath, parseMarkdownPath, pmToMarkdown } from "../lib/seo/markdown.ts";
import { seoRouteFor } from "../lib/seo/publicRoutes.ts";
import { AI_ANSWER_BOTS, AI_TRAINING_BOTS, blockedAiBots, buildRobotsTxt, contentSignal, sanitizeRobotsRules } from "../lib/seo/robots.ts";
import { buildManifest, imageMime, shortName } from "../lib/seo/manifest.ts";
import { canonicalQuery, communityFeedView, communityViewMetadata } from "../lib/seo/communityView.ts";
import { THREAD_SEGMENT_RE, threadPath, threadSegment } from "../lib/seo/paths.ts";
import { landingFaq } from "../lib/seo/landing.ts";
import { featureIndexable, feedsEnabled, llmsEnabled } from "../lib/seo/meta.ts";
import { threadRedirect } from "../lib/seo/legacyRedirect.ts";
import * as ld from "../lib/seo/jsonld.ts";
import { validateJsonLd } from "./fixtures/schemaorg.mjs";

/** Strict XML well-formedness (expat via python3); skipped where python3 is missing. */
function assertWellFormedXml(xml) {
  const res = spawnSync("python3", ["-c", "import sys,xml.dom.minidom as m; m.parseString(sys.stdin.buffer.read())"], { input: xml });
  if (res.error) return; // no python3 on this machine
  expect(res.stderr.toString()).toBe("");
  expect(res.status).toBe(0);
}

const SECRET = "Secret-Title-Never-Public";
const media = {
  course: (o, u, f) => `https://cdn/${o}/c/${u}/${f}`,
  path: (o, u, f) => `https://cdn/${o}/p/${u}/${f}`,
  podcast: (o, u, f) => `https://cdn/${o}/pod/${u}/${f}`,
  community: (o, u, f) => `https://cdn/${o}/com/${u}/${f}`,
  episodeImage: (o, p, e, f) => `https://cdn/${o}/pod/${p}/ep/${e}/${f}`,
  episodeAudio: (o, p, e, f) => `https://cdn/${o}/pod/${p}/ep/${e}/audio/${f}`,
  orgLogo: (o, f) => `https://cdn/${o}/logo/${f}`,
};
const org = { slug: "acme", org_uuid: "org_1", name: "Acme & Co", description: "Learn <fast>", logo: "l.png" };
const base = "https://learn.acme.com";

// ─── feeds ──────────────────────────────────────────────────────────────────

const doc = {
  title: "Acme & Co: what's new",
  homeUrl: `${base}/`,
  feedUrls: feedUrls(base, "/"),
  description: "New <things>",
  language: "en",
  image: "https://cdn/logo.png",
  author: "Acme",
  items: [
    {
      id: `${base}/course/a`, title: "A & B", url: `${base}/course/a`, summary: "Sum <x>", contentHtml: "<p>Hi ]]> there\u0001</p>",
      author: "Ada", published: "2026-11-05 01:33:02.1", updated: "2026-11-06 00:00:00", categories: ["Course", "Q&A"], image: "https://cdn/a.png",
    },
    { id: "episode_1", title: "Ep", url: `${base}/podcast/p#episode-1`, enclosure: { url: "https://cdn/a.mp3", length: 1234.4, type: "audio/mpeg" } },
  ],
};

describe("feeds", () => {
  test("RSS 2.0 is strict XML with self link, guid, content and enclosure", () => {
    const xml = buildRss(doc);
    assertWellFormedXml(xml);
    expect(xml).toContain('<atom:link href="https://learn.acme.com/feed.xml" rel="self" type="application/rss+xml"/>');
    expect(xml).toContain('<guid isPermaLink="true">https://learn.acme.com/course/a</guid>');
    expect(xml).toContain('<guid isPermaLink="false">episode_1</guid>');
    expect(xml).toContain("<pubDate>Thu, 05 Nov 2026 01:33:02 GMT</pubDate>");
    expect(xml).toContain("<category>Q&amp;A</category>");
    expect(xml).toContain('<enclosure url="https://cdn/a.mp3" length="1234" type="audio/mpeg"/>');
    expect(xml).toContain('<media:thumbnail url="https://cdn/a.png"/>');
    expect(xml).not.toContain("\u0001");
    expect(xml).toContain("<lastBuildDate>Fri, 06 Nov 2026 00:00:00 GMT</lastBuildDate>");
  });
  test("Atom 1.0 and JSON Feed 1.1", () => {
    const atom = buildAtom(doc);
    assertWellFormedXml(atom);
    expect(atom).toContain('<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="en">');
    expect(atom).toContain("<id>urn:learnhouse:episode_1</id>");
    expect(atom).toContain('<link rel="enclosure" type="audio/mpeg" length="1234" href="https://cdn/a.mp3"/>');
    expect(atom).toContain("<updated>2026-11-06T00:00:00.000Z</updated>");
    const minimal = buildAtom({ title: "T", homeUrl: base, feedUrls: {}, items: [] });
    assertWellFormedXml(minimal);
    expect(minimal).toContain("<author><name>T</name></author>");
    expect(minimal).toContain("<updated>1970-01-01T00:00:00.000Z</updated>");

    const json = JSON.parse(buildJsonFeed(doc));
    expect(json.version).toBe("https://jsonfeed.org/version/1.1");
    expect(json.feed_url).toBe("https://learn.acme.com/feed.json");
    expect(json.items[0]).toMatchObject({ id: `${base}/course/a`, content_html: "<p>Hi ]]> there\u0001</p>", tags: ["Course", "Q&A"], date_published: "2026-11-05T01:33:02.100Z" });
    expect(json.items[1]).toMatchObject({ content_text: "Ep", attachments: [{ url: "https://cdn/a.mp3", mime_type: "audio/mpeg", size_in_bytes: 1234.4 }] });
    expect(JSON.parse(buildJsonFeed({ title: "T", homeUrl: base, feedUrls: {}, items: [] }))).toEqual({ version: "https://jsonfeed.org/version/1.1", title: "T", home_page_url: base, items: [] });
    expect(buildFeed("atom", doc)).toBe(atom);
    expect(buildFeed("json", doc)).toContain("jsonfeed");
    expect(buildFeed("rss", doc)).toContain("<rss");
  });
  test("RSS without optional fields", () => {
    const xml = buildRss({ title: "T", homeUrl: base, feedUrls: {}, items: [{ id: "x", title: "X", url: `${base}/x` }] });
    assertWellFormedXml(xml);
    expect(xml).not.toContain("atom:link href");
    expect(xml).toContain("<description>T</description>");
  });
  test("podcast RSS is Apple/Spotify ready", async () => {
    const feedUrl = `${base}/podcast/show/feed`;
    const input = podcastFeedFromApi(
      {
        org,
        resource: { key: "show", uuid: "podcast_1", name: "Show & Tell", description: "About", image: "c.png", authors: ["Maya"], language: "FR", noindex: true, updated: "2026-11-01" },
        items: [
          { uuid: "episode_1", number: 2, title: "Two", description: "<b>Desc</b>", audio: "a.m4a", audio_length: 4000, duration_seconds: 3725, image: "e.png", published: "2026-11-02 00:00:00" },
          { uuid: "episode_2", number: 1, title: "One (sold)", audio: "", image: "" },
        ],
      },
      { base, media, feedUrl },
    );
    input.guid = await podcastGuid(feedUrl);
    const xml = buildPodcastRss(input);
    assertWellFormedXml(xml);
    expect(xml).toContain('<itunes:category text="Education"/>');
    expect(xml).toContain("<itunes:explicit>false</itunes:explicit>");
    expect(xml).toContain('<itunes:image href="https://cdn/org_1/pod/podcast_1/c.png"/>');
    expect(xml).toContain("<itunes:owner><itunes:name>Acme &amp; Co</itunes:name></itunes:owner>");
    expect(xml).toContain('<enclosure url="https://cdn/org_1/pod/podcast_1/ep/episode_1/audio/a.m4a" length="4000" type="audio/x-m4a"/>');
    expect(xml).toContain("<itunes:duration>01:02:05</itunes:duration><itunes:episode>2</itunes:episode>");
    expect(xml).toContain("<itunes:block>Yes</itunes:block>");
    expect(xml).toContain("<language>fr</language>");
    expect(xml).toMatch(/<podcast:guid>[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}<\/podcast:guid>/);
    // The sold episode is listed without audio.
    expect(xml.split("<item>")[2]).not.toContain("<enclosure");
    const plain = buildPodcastRss({ title: "P", homeUrl: base, feedUrls: {}, explicit: true, ownerEmail: "a@b.c", items: [{ id: "e", title: "E", url: base }] });
    assertWellFormedXml(plain);
    expect(plain).toContain("<itunes:explicit>true</itunes:explicit>");
    expect(plain).toContain("<itunes:email>a@b.c</itunes:email>");
    expect(plain).toContain("<language>en</language>");
  });
  test("helpers", async () => {
    expect(itunesDuration(59)).toBe("00:00:59");
    expect(itunesDuration(-3)).toBe("00:00:00");
    expect(["a.mp3", "a.M4A", "a.aac", "a.ogg", "a.opus", "a.wav", "a.flac", "a.webm", "a.mp4?x=1", "noext"].map(audioMime)).toEqual([
      "audio/mpeg", "audio/x-m4a", "audio/aac", "audio/ogg", "audio/opus", "audio/wav", "audio/flac", "audio/webm", "audio/x-m4a", "audio/mpeg",
    ]);
    expect(xmlSafe("a\u0000b\u000bc\td")).toBe("abc\td");
    // Same feed URL, same GUID, whatever the scheme or trailing slash.
    expect(await podcastGuid("https://a.com/feed/")).toBe(await podcastGuid("http://a.com/feed"));
  });
});

describe("feed mapping", () => {
  test("what's new: courses, paths and podcasts with absolute URLs and images", () => {
    const d = feedDocFromApi(
      {
        org, kind: "org",
        items: [
          { type: "course", key: "py thon", uuid: "course_1", name: "Py", description: "d", image: "t.png", authors: ["Ada", "Bob"], tags: "a, b", published: "2026-01-01" },
          { type: "path", key: "p", uuid: "path_1", name: "Path", image: "x/y.png" },
          { type: "podcast", key: "pod", uuid: "podcast_1", name: "Pod" },
        ],
      },
      { base, prefix: "/", media, lang: "en" },
    );
    expect(d.title).toBe("Acme & Co: what's new");
    expect(d.homeUrl).toBe(`${base}/`);
    expect(d.image).toBe("https://cdn/org_1/logo/l.png");
    expect(d.items.map((i) => i.url)).toEqual([`${base}/course/py%20thon`, `${base}/path/p`, `${base}/podcast/pod`]);
    expect(d.items[0]).toMatchObject({ author: "Ada, Bob", categories: ["Course", "a", "b"], image: "https://cdn/org_1/c/course_1/t.png" });
    expect(d.items[1].image).toBeUndefined();
    expect(d.items[2].categories).toEqual(["Podcast"]);
    const courses = feedDocFromApi({ org: { ...org, logo: "" }, kind: "courses", items: [] }, { base, prefix: "/courses/", media });
    expect(courses.homeUrl).toBe(`${base}/courses`);
    expect(courses.feedUrls.atom).toBe(`${base}/courses/feed.atom`);
    expect(courses.image).toBeUndefined();
  });
  test("threads", () => {
    const t = { community_key: "club", segment: "4-hi", title: "Hi", content: '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Body"}]}]}', label: "question", community_name: "Club", author: "Ada", published: "2026-01-01" };
    const all = feedDocFromApi({ org, kind: "communities", sort: "top", items: [t] }, { base, prefix: "/communities/", media });
    expect(all.title).toContain("top discussions");
    expect(all.items[0]).toMatchObject({ url: `${base}/community/club/4-hi`, summary: "Body", categories: ["Q&A", "Club"] });
    const latest = feedDocFromApi({ org, kind: "communities", items: [{ ...t, label: "custom", content: "", author: "" }] }, { base, prefix: "/communities/", media });
    expect(latest.title).toContain("latest discussions");
    expect(latest.items[0]).toMatchObject({ summary: undefined, author: undefined, categories: ["custom", "Club"] });
    const one = feedDocFromApi(
      { org, kind: "community", sort: "new", resource: { key: "club", uuid: "community_1", name: "Club", description: "", image: "c.png" }, items: [] },
      { base, prefix: "/community/club/", media },
    );
    expect(one).toMatchObject({ title: "Club · Acme & Co", homeUrl: `${base}/community/club`, description: "Discussions in Club.", image: "https://cdn/org_1/com/community_1/c.png" });
    const top = feedDocFromApi({ org, kind: "community", sort: "top", resource: { key: "c", name: "C" }, items: [] }, { base, prefix: "/community/c/", media });
    expect(top.title).toBe("C (top) · Acme & Co");
    expect(top.image).toBe("https://cdn/org_1/logo/l.png");
  });
  test("podcast defaults", () => {
    const p = podcastFeedFromApi({ org: {}, resource: { key: "k", uuid: "podcast_1", name: "N" } }, { base, media, feedUrl: "f" });
    expect(p).toMatchObject({ description: "N", language: "en", items: [], explicit: false, block: false });
  });
});

// ─── Markdown + llms.txt ────────────────────────────────────────────────────

const pmDoc = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Intro" }] },
    { type: "paragraph", content: [
      { type: "text", text: "Bold", marks: [{ type: "bold" }] }, { type: "text", text: " and " },
      { type: "text", text: "it", marks: [{ type: "italic" }] }, { type: "text", text: " " },
      { type: "text", text: "link", marks: [{ type: "link", attrs: { href: "https://x.com/a b" } }] },
      { type: "text", text: " bad", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] },
      { type: "hardBreak" }, { type: "text", text: "a`b", marks: [{ type: "code" }] }, { type: "text", text: "gone", marks: [{ type: "strike" }] },
      { type: "mention", attrs: { label: "maya" } }, { type: "inlineMath", attrs: { latex: "x^2" } }, { type: "unknownInline", content: [{ type: "text", text: "[x]" }] },
    ] },
    { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "one" }] }, { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "nested" }] }] }] }] }] },
    { type: "orderedList", attrs: { start: 3 }, content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "three" }] }] }] },
    { type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: "quote" }] }] },
    { type: "codeBlock", attrs: { language: "py<>" }, content: [{ type: "text", text: "print(1)\n```" }] },
    { type: "horizontalRule" },
    { type: "image", attrs: { src: "https://cdn/i.png", alt: "Alt" } },
    { type: "image", attrs: { src: "data:x" } },
    { type: "table", content: [
      { type: "tableRow", content: [{ type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "H|1" }] }] }, { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "H2" }] }] }] },
      { type: "tableRow", content: [{ type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "c" }] }] }] },
    ] },
    { type: "table", content: [] },
    { type: "videoEmbed", attrs: { src: "https://youtu.be/x", title: "Clip" } },
    { type: "callout", content: [{ type: "paragraph", content: [{ type: "text", text: "Note" }] }] },
    { type: "paragraph", content: [] },
  ],
};

describe("markdown", () => {
  test("ProseMirror to Markdown", () => {
    const md = pmToMarkdown(pmDoc);
    expect(md).toContain("## Intro");
    expect(md).toContain("**Bold** and *it* [link](https://x.com/a%20b) bad  \n`aˋb`~~gone~~@maya$x^2$\\[x\\]");
    expect(md).toContain("- one\n  - nested");
    expect(md).toContain("3. three");
    expect(md).toContain("> quote");
    expect(md).toContain("```py\nprint(1)\nˋˋˋ\n```");
    expect(md).toContain("---");
    expect(md).toContain("![Alt](https://cdn/i.png)");
    expect(md).not.toContain("data:x");
    expect(md).toContain("| H\\|1 | H2 |\n| --- | --- |\n| c |  |");
    expect(md).toContain("[Clip](https://youtu.be/x)");
    expect(md).toContain("Note");
    expect(pmToMarkdown(JSON.stringify(pmDoc))).toBe(md);
    expect(pmToMarkdown("plain *text*")).toBe("plain *text*");
    expect(pmToMarkdown("  ")).toBe("");
    expect(pmToMarkdown(null)).toBe("");
    expect(pmToMarkdown({ content: [{ type: "paragraph", content: [{ type: "text", text: "no type" }] }] })).toBe("no type");
  });

  const orgInfo = { org: { name: "Acme" } };
  const ctx = { base, canonical: `${base}/x` };
  test("course, lesson, path, podcast pages", () => {
    const course = markdownFor({
      ...orgInfo, type: "course",
      course: { key: "py", name: "Py", description: "Learn", authors: ["Ada"], learnings: '["Loops", {"text":"Types"}]', about: "About text", updated: "2026-11-01 10:00:00", language: "fr",
        outline: [{ chapter: "C1", key: "a1", name: "L1", public: true }, { chapter: "C1", key: "a2", name: "L2", public: false }, { chapter: "C2", key: "a3", name: "L3", public: true }] },
    }, ctx);
    expect(course).toStartWith('---\ntitle: "Py"\nsource: "https://learn.acme.com/x"\nsite: "Acme"\nupdated: "2026-11-01"\nlanguage: "fr"\n---');
    expect(course).toContain("Instructors: Ada");
    expect(course).toContain("## What you will learn\n\n- Loops\n- Types");
    expect(course).toContain("### C1\n\n- [L1](https://learn.acme.com/course/py/activity/a1)\n- L2 (members only)\n### C2");
    expect(markdownFor({ ...orgInfo, type: "course", course: { key: "k", name: "Bare" } }, ctx)).not.toContain("outline");

    const lesson = markdownFor({ ...orgInfo, type: "activity", course: { key: "py", name: "Py" }, activity: { name: "L1", chapter: "C1", content: pmDoc, updated: "" } }, ctx);
    expect(lesson).toContain("Part of [Py](https://learn.acme.com/course/py), chapter “C1”.");
    expect(lesson).toContain("## Intro");
    const video = markdownFor({ ...orgInfo, type: "activity", course: { key: "py", name: "Py" }, activity: { name: "V", type: "TYPE_VIDEO", content: null } }, ctx);
    expect(video).toContain("This lesson is a video activity. Open it on the website: https://learn.acme.com/x");

    const path = markdownFor({ ...orgInfo, type: "path", path: { key: "p", name: "Path", description: "d", level: "Beginner", about: "a", courses: [{ key: "c", name: "C", description: "cd", required: false }, { key: "d", name: "D" }] } }, ctx);
    expect(path).toContain("Level: Beginner");
    expect(path).toContain("1. [C](https://learn.acme.com/course/c) (elective): cd\n2. [D](https://learn.acme.com/course/d)");
    expect(markdownFor({ ...orgInfo, type: "path", path: { key: "p", name: "P" } }, ctx)).not.toContain("Courses in this path");

    const pod = markdownFor({ ...orgInfo, type: "podcast", podcast: { key: "s", name: "Show", description: "d", about: "a", episodes: [{ number: 1, title: "E1", duration_seconds: 125, description: "ed" }, { title: "E2" }] } }, ctx);
    expect(pod).toContain("### 1. E1 (2 min)\n\ned");
    expect(pod).toContain("### E2");
    expect(markdownFor({ ...orgInfo, type: "podcast", podcast: { key: "s", name: "S" } }, ctx)).not.toContain("Episodes");
  });
  test("community and thread pages", () => {
    const community = markdownFor({ ...orgInfo, type: "community", community: { key: "club", name: "Club", description: "d" }, threads: [{ title: "T", segment: "1-t", replies: 1, answered: true }, { title: "U", segment: "2-u", replies: 0 }] }, ctx);
    expect(community).toContain("- [T](https://learn.acme.com/community/club/1-t) · 1 reply · answered\n- [U](https://learn.acme.com/community/club/2-u) · 0 replies");
    expect(markdownFor({ ...orgInfo, type: "community", community: { key: "c", name: "C" } }, ctx)).not.toContain("Recent");
    const thread = markdownFor({
      ...orgInfo, type: "thread", community: { key: "club", name: "Club" },
      thread: { title: "Q?", author: "Ada", published: "2026-11-01 00:00:00", upvotes: 3, content: pmDoc,
        comments: [{ author: "Bo", content: "Answer", upvotes: 2, accepted: true }, { author: "", content: "Other", upvotes: 0, published: "2026-11-02" }] },
    }, ctx);
    expect(thread).toContain("Asked in [Club](https://learn.acme.com/community/club) by Ada on 2026-11-01 · 3 upvotes");
    expect(thread).toContain("## Accepted answer\n\n**Bo** (2 upvotes):\n\nAnswer");
    expect(thread).toContain("## Replies (1)\n\n**Member** · 2026-11-02 · 0 upvotes\n\nOther");
    const bare = markdownFor({ ...orgInfo, type: "thread", community: { key: "c", name: "C" }, thread: { title: "Q", upvotes: 0, content: "" } }, ctx);
    expect(bare).not.toContain("Replies");
    expect(markdownFor({ type: "nope" }, ctx)).toBe("");
  });
  test("canonical paths and URL parsing", () => {
    expect(canonicalPathFor({ type: "course", course: { key: "a b" } })).toBe("/course/a%20b");
    expect(canonicalPathFor({ type: "activity", course: { key: "c" }, activity: { key: "x" } })).toBe("/course/c/activity/x");
    expect(canonicalPathFor({ type: "path", path: { key: "p" } })).toBe("/path/p");
    expect(canonicalPathFor({ type: "podcast", podcast: { key: "p" } })).toBe("/podcast/p");
    expect(canonicalPathFor({ type: "community", community: { key: "c" } })).toBe("/community/c");
    expect(canonicalPathFor({ type: "thread", community: { key: "c" }, thread: { segment: "1-x" } })).toBe("/community/c/1-x");
    expect(canonicalPathFor(null)).toBeNull();
    expect(markdownPath("/course/x/?a=1")).toBe("/course/x.md");
    expect(markdownPath("/")).toBe("/index.md");
    expect(parseMarkdownPath("/course/x/activity/y.md")).toEqual({ type: "activity", key: "x", sub: "y" });
    expect(parseMarkdownPath("/community/c/12-hello.md")).toEqual({ type: "thread", key: "c", sub: "12-hello" });
    expect(parseMarkdownPath("/podcast/p%20q.md")).toEqual({ type: "podcast", key: "p q" });
    expect(parseMarkdownPath("/course/%E0%A4%A.md")).toEqual({ type: "course", key: "%E0%A4%A" });
    expect(parseMarkdownPath("/index.md")).toEqual({ type: "home", key: "" });
    expect(parseMarkdownPath("/dash/x.md")).toBeNull();
  });
  test("llms.txt", () => {
    const data = {
      org: { name: "Acme", description: "Short", about: "Longer about" },
      seo: { default_meta_description: "" },
      courses: [{ key: "py", name: "Py", description: "Learn", authors: ["Ada"], outline: [{ key: "a1", name: "L1", public: true }, { key: "a2", name: "L2", public: false }] }],
      paths: [{ key: "p", name: "Path", description: "d", courses: [{ name: "Py", required: false }, { name: "Go" }] }],
      podcasts: [{ key: "s", name: "Show", episodes: [{ number: 1, title: "E1" }, { title: "E2" }] }],
      communities: [{ key: "club", name: "Club", threads: [{ segment: "1-q", title: "Q", answered: true }, { segment: "2-r", title: "R" }] }],
      folders: [{ key: "f", name: "Shelf" }],
    };
    const short = buildLlmsTxt(data, base, { extra: [{ title: "Pages", links: [{ name: "About", url: `${base}/p/about`, note: "Who we are" }] }, { title: "Empty", links: [] }] });
    expect(short).toStartWith("# Acme\n\n> Short\n\nLonger about\n\n");
    expect(short).toContain("## Courses\n\n- [Py](https://learn.acme.com/course/py): Learn\n");
    expect(short).not.toContain("L1");
    expect(short).toContain("## Pages\n\n- [About](https://learn.acme.com/p/about): Who we are");
    expect(short).not.toContain("## Empty");
    expect(short).toContain("- [Full content index](https://learn.acme.com/llms-full.txt)");
    const full = buildLlmsTxt(data, base, { full: true });
    expect(full).toContain("  - Instructors: Ada\n  - [L1](https://learn.acme.com/course/py/activity/a1)");
    expect(full).not.toContain("L2");
    expect(full).toContain("  - Py (elective)\n  - Go");
    expect(full).toContain("  - 1. E1\n  - E2");
    expect(full).toContain("  - [Q](https://learn.acme.com/community/club/1-q) (answered)\n  - [R](https://learn.acme.com/community/club/2-r)");
    expect(full).not.toContain("Full content index");
    expect(buildLlmsTxt({ org: { name: "X" } }, base)).toContain("> X learning platform");
    expect(buildLlmsTxt({ org: { name: "X", about: "A", description: "A" } }, base)).not.toContain("\n\nA\n\nLearning");
  });
});

// ─── routing, robots, manifest, community views ─────────────────────────────

describe("public SEO routes", () => {
  test("map to internal handlers", () => {
    expect(seoRouteFor("/llms.txt")).toBe("/api/seo/llms");
    expect(seoRouteFor("/llms-full.txt")).toBe("/api/seo/llms?full=1");
    expect(seoRouteFor("/manifest.webmanifest")).toBe("/api/seo/manifest");
    expect(seoRouteFor("/rss.xml")).toBe("/api/seo/feed?kind=org&format=rss");
    expect(seoRouteFor("/feed.atom")).toBe("/api/seo/feed?kind=org&format=atom");
    expect(seoRouteFor("/communities/feed.json", "?sort=top")).toBe("/api/seo/feed?kind=communities&format=json&sort=top");
    expect(seoRouteFor("/community/my%20club/feed.xml", "?sort=new")).toBe("/api/seo/feed?kind=community&key=my%20club&format=rss");
    expect(seoRouteFor("/newsletter/weekly/feed.atom")).toBe("/api/seo/feed?kind=newsletter&key=weekly&format=atom");
    expect(seoRouteFor("/podcast/show/feed")).toBe("/api/seo/feed?kind=podcast&key=show&format=rss");
    expect(seoRouteFor("/podcast/show/feed.json")).toBe("/api/seo/feed?kind=podcast&key=show&format=json");
    expect(seoRouteFor("/podcast/%E0%A4%A/feed")).toBe("/api/seo/feed?kind=podcast&key=%25E0%25A4%25A&format=rss");
    expect(seoRouteFor("/0123456789abcdef.txt")).toBe("/api/seo/indexnow?key=0123456789abcdef"); // gitleaks:allow
    expect(seoRouteFor("/course/x.md")).toBe("/api/seo/markdown?path=%2Fcourse%2Fx.md");
    expect(seoRouteFor("/index.md")).toBe("/api/seo/markdown?path=%2Findex.md");
    for (const p of ["/robots.txt", "/ads.txt", "/course/x", "/dash/a.md", "/feed.rss"]) expect(seoRouteFor(p)).toBeNull();
  });
});

describe("robots.txt AI policy", () => {
  test("allow: content signals only", () => {
    const txt = buildRobotsTxt({ sitemapUrl: `${base}/sitemap.xml`, llmsUrl: `${base}/llms.txt` });
    expect(txt).toStartWith("# Content-Signal: search=yes, ai-input=yes, ai-train=yes\nUser-agent: *");
    expect(txt).not.toContain("GPTBot");
    expect(txt).toContain("# LLM-readable summary: https://learn.acme.com/llms.txt");
  });
  test("block training keeps answer engines", () => {
    const seo = { ai_crawler_policy: "block_training", ai_crawlers_blocked: ["MyBot", "bad name", "GPTBot"] };
    const txt = buildRobotsTxt({ sitemapUrl: "x", seo });
    expect(txt).toContain("# Content-Signal: search=yes, ai-input=yes, ai-train=no");
    expect(txt).toContain("User-agent: GPTBot\nUser-agent: ClaudeBot");
    expect(txt).toContain("User-agent: MyBot\nDisallow: /");
    expect(txt).not.toContain("OAI-SearchBot");
    expect(txt).not.toContain("bad name");
    expect(blockedAiBots(seo).filter((b) => b === "GPTBot")).toHaveLength(1);
  });
  test("block all", () => {
    const seo = { ai_crawler_policy: "block_all" };
    expect(blockedAiBots(seo)).toEqual([...AI_TRAINING_BOTS, ...AI_ANSWER_BOTS]);
    expect(contentSignal(seo)).toBe("# Content-Signal: search=yes, ai-input=no, ai-train=no");
    expect(blockedAiBots(undefined)).toEqual([]);
    expect(sanitizeRobotsRules("Content-Signal: ai-train=no\nDisallow: /x\nfoo")).toEqual(["Disallow: /x"]);
    expect(buildRobotsTxt({ sitemapUrl: "x", seo: { ...seo, indexing_disabled: true } })).toBe("User-agent: *\nDisallow: /\n");
  });
});

describe("org switches", () => {
  test("features, feeds and llms", () => {
    expect(featureIndexable({}, "courses")).toBe(true);
    expect(featureIndexable({ indexable_features: { courses: false } }, "courses")).toBe(false);
    expect(featureIndexable({ indexing_disabled: true }, "live")).toBe(false);
    expect(featureIndexable({ noindex_communities: true }, "communities")).toBe(false);
    expect(featureIndexable(undefined, "communities")).toBe(true);
    expect(llmsEnabled({})).toBe(true);
    expect(llmsEnabled({ ai_crawler_policy: "block_all" })).toBe(false);
    expect(llmsEnabled({ llms_txt_enabled: false })).toBe(false);
    expect(feedsEnabled({ feeds_enabled: false })).toBe(false);
    expect(feedsEnabled(undefined)).toBe(true);
  });
});

describe("manifest", () => {
  test("org name, colors and icons; never LearnHouse icons", () => {
    const m = buildManifest({ name: "Kitebase Academy", description: "d".repeat(400), lang: "fr", themeColor: "#123456", icons: [{ src: "https://cdn/a.png", purpose: "any" }, { src: "https://cdn/a.png" }, { src: "https://cdn/b.ico" }, { src: "https://cdn/c" }] });
    expect(m).toMatchObject({ name: "Kitebase Academy", short_name: "Kitebase", lang: "fr", theme_color: "#123456", start_url: "/", display: "standalone" });
    expect(m.description).toHaveLength(300);
    expect(m.icons).toEqual([
      { src: "https://cdn/a.png", sizes: "any", type: "image/png", purpose: "any" },
      { src: "https://cdn/b.ico", sizes: "any", type: "image/x-icon" },
      { src: "https://cdn/c", sizes: "any" },
    ]);
    expect(buildManifest({ name: "X", icons: [] })).not.toHaveProperty("icons");
    expect(buildManifest({ name: "X", icons: [] })).toMatchObject({ lang: "en", theme_color: "#ffffff" });
    expect(shortName("Short")).toBe("Short");
    expect(shortName("Supercalifragilistic Academy")).toBe("Supercalifra");
    expect(imageMime("a.svg?v=1")).toBe("image/svg+xml");
  });
});

describe("community views", () => {
  test("parse sort, label and page", () => {
    expect(communityFeedView({})).toEqual({ sort: "latest", apiSort: "recent", label: null, page: 1 });
    expect(communityFeedView({ sort: "top", label: "question", page: "3" })).toEqual({ sort: "top", apiSort: "upvotes", label: "question", page: 3 });
    expect(communityFeedView({ sort: ["hot"], label: "nope", page: "-2" })).toMatchObject({ sort: "hot", label: null, page: 1 });
    expect(communityFeedView({ page: "99999" }).page).toBe(500);
    expect(communityFeedView(null).sort).toBe("latest");
    expect(canonicalQuery({ label: "idea", page: 2 })).toBe("?label=idea&page=2");
    expect(canonicalQuery({ label: null, page: 1 })).toBe("");
  });
  const ctx = { seo: {}, url: async (p) => `${base}${p}` };
  const meta = { title: "Club | Acme", robots: { index: true, follow: true, googleBot: { index: true } }, alternates: { canonical: `${base}/community/club` }, openGraph: { title: "Club" } };
  test("label and page views are indexable with their own canonical; re-sorted views are not", async () => {
    const page2 = await communityViewMetadata(meta, { ctx, key: "club", view: communityFeedView({ label: "question", page: "2" }), indexable: true, name: "Club" });
    expect(page2.alternates.canonical).toBe(`${base}/community/club?label=question&page=2`);
    expect(page2.title).toBe("Club (Q&A, page 2) | Acme");
    expect(page2.robots.index).toBe(true);
    expect(page2.alternates.types["application/rss+xml"]).toBe(`${base}/community/club/feed.xml`);
    expect(page2.alternates.types["text/markdown"]).toBeUndefined();
    const sorted = await communityViewMetadata(meta, { ctx, key: "club", view: communityFeedView({ sort: "top", page: "4" }), indexable: true, name: "Club" });
    expect(sorted.robots.index).toBe(false);
    expect(sorted.robots.googleBot.index).toBe(false);
    expect(sorted.alternates.canonical).toBe(`${base}/community/club`);
    const home = await communityViewMetadata(meta, { ctx, key: "club", view: communityFeedView({}), indexable: true, name: "Club" });
    expect(home.alternates.types["text/markdown"]).toBe(`${base}/community/club.md`);
    const hidden = await communityViewMetadata({ ...meta, robots: { index: false }, title: undefined }, { ctx: { ...ctx, seo: { feeds_enabled: false } }, key: "club", view: communityFeedView({}), indexable: false, name: "Club" });
    expect(hidden.alternates.types).toBeUndefined();
    expect(hidden.robots.index).toBe(false);
    const own = await communityViewMetadata({ ...meta, alternates: { canonical: "https://elsewhere.com/x" } }, { ctx, key: "club", view: communityFeedView({ page: "2" }), indexable: true, name: "Club" });
    expect(own.alternates.canonical).toBe("https://elsewhere.com/x");
  });
});

describe("thread URLs", () => {
  test("segment mirrors the API's thread_segment", () => {
    // Same vectors as the API tests (src/tests/services/test_seo_public.py).
    expect(threadSegment(42, "How do payouts work?")).toBe("42-how-do-payouts-work");
    expect(threadSegment(7, "入门")).toBe("7");
    expect(threadSegment(1, "Café crème brûlée")).toBe("1-cafe-creme-brulee");
    expect(threadPath("club", { id: 3, title: "Hello" })).toBe("/community/club/3-hello");
    expect(THREAD_SEGMENT_RE.test("12-a-b")).toBe(true);
    expect(THREAD_SEGMENT_RE.test("abc")).toBe(false);
    expect(threadSegment(5, "word ".repeat(30)).length).toBeLessThanOrEqual(63);
  });
  test("legacy uuid thread URLs 301 to the readable URL; bots also get stale slugs fixed", async () => {
    const calls = [];
    const fetcher = async (url) => {
      calls.push(url);
      if (url.includes("/locked/")) return new Response(JSON.stringify({ locked: true, community_key: "locked" }), { status: 200 });
      if (url.includes("/gone/")) return new Response("{}", { status: 404 });
      if (url.includes("/down/")) return new Response("{}", { status: 500 });
      if (url.includes("/throw/")) throw new Error("x");
      return new Response(JSON.stringify({ segment: "4-hello", community_key: "club" }), { status: 200 });
    };
    const uuid = "36480b5b-ac61-4f8a-bd7c-8ac27662d34c";
    expect(await threadRedirect("http://api/", "acme", `/community/club/discussion/${uuid}`, fetcher, 1)).toBe("/community/club/4-hello");
    expect(await threadRedirect("http://api/", "acme", `/community/club/discussion/${uuid}`, fetcher, 2)).toBe("/community/club/4-hello");
    expect(calls).toHaveLength(1); // cached
    expect(await threadRedirect("http://api/", "acme", `/community/locked/discussion/${uuid}`, fetcher, 1)).toBeNull();
    expect(await threadRedirect("http://api/", "acme", `/community/gone/discussion/${uuid}`, fetcher, 1)).toBeNull();
    expect(await threadRedirect("http://api/", "acme", `/community/down/discussion/${uuid}`, fetcher, 1)).toBeNull();
    expect(await threadRedirect("http://api/", "acme", `/community/throw/discussion/${uuid}`, fetcher, 1)).toBeNull();
    expect(await threadRedirect("http://api/", "acme", "/community/club/4-old", fetcher, 1)).toBeNull(); // people: page handles it
    expect(await threadRedirect("http://api/", "acme", "/community/club/4-old", fetcher, 1, { isBot: true })).toBe("/community/club/4-hello");
    expect(await threadRedirect("http://api/", "acme", "/community/club/4-hello", fetcher, 1, { isBot: true })).toBeNull();
    expect(await threadRedirect("http://api/", "acme", "/course/x", fetcher, 1, { isBot: true })).toBeNull();
  });
});

describe("landing FAQ", () => {
  test("visible FAQ blocks only", () => {
    const doc = {
      root: [
        { type: "section", children: [{ type: "faq", props: { items: [{ question: " Q1 ", answer: "A1" }, { question: "", answer: "x" }] } }] },
        { type: "faq", visibility: "logged_in", props: { items: [{ question: SECRET, answer: "x" }] } },
        { type: "faq", hidden: { desktop: true, tablet: true, mobile: true }, props: { items: [{ question: SECRET, answer: "x" }] } },
        { type: "faq", hidden: { mobile: true }, props: { items: [{ question: "Q2", answer: "A2" }] } },
        null,
      ],
    };
    expect(landingFaq(doc)).toEqual([{ question: "Q1", answer: "A1" }, { question: "Q2", answer: "A2" }]);
    expect(landingFaq(null)).toEqual([]);
  });
});

// ─── structured data validity ───────────────────────────────────────────────

describe("JSON-LD is valid schema.org", () => {
  const o = { name: "Acme", url: base, logo: "https://cdn/logo.png" };
  const samples = {
    organization: ld.organizationJsonLd({ ...o, description: "d", sameAs: ["https://x.com/acme"], type: "CollegeOrUniversity" }),
    website: ld.websiteJsonLd({ name: "Acme", url: base, inLanguage: "en", searchUrlTemplate: `${base}/search?q={search_term_string}` }),
    breadcrumb: ld.breadcrumbJsonLd([{ name: "Home", url: base }, { name: "C", url: `${base}/c` }]),
    itemList: ld.itemListJsonLd("Courses", [{ url: `${base}/a`, name: "A" }]),
    course: ld.courseJsonLd({
      name: "Py", url: `${base}/course/py`, description: "Learn", image: "https://cdn/c.png", org: o, authors: [{ name: "Ada" }],
      inLanguage: "en", educationalLevel: "beginner", workloadMinutes: 150, offers: [{ price: 10, currency: "USD" }], teaches: ["Loops"],
      prerequisites: "None", audience: "Beginners", datePublished: "2026-01-01", dateModified: "2026-02-01", keywords: "py",
      syllabus: [{ name: "C1", description: "First" }], availableLanguage: ["en", "fr"], about: "About", aggregateRating: { ratingValue: 4.5, ratingCount: 10 }, enrollmentCount: 12,
    }),
    lesson: ld.learningResourceJsonLd({ name: "L", url: `${base}/l`, description: "d", courseName: "Py", courseUrl: `${base}/course/py`, dateModified: "2026-01-01", inLanguage: "en", isFree: true }),
    path: ld.pathJsonLd({ name: "P", url: `${base}/path/p`, description: "d", org: o, courses: [{ name: "C", url: `${base}/c` }], educationalLevel: "beginner", inLanguage: "en" }),
    podcast: ld.podcastSeriesJsonLd({ name: "S", url: `${base}/p`, org: o, authors: [{ name: "Ada" }], feedUrl: `${base}/p/feed`, episodes: [{ name: "E", durationSeconds: 60, audioUrl: "https://cdn/a.mp3", episodeNumber: 1, datePublished: "2026-01-01" }] }),
    community: ld.communityJsonLd({ name: "Club", url: `${base}/community/club`, org: o, threads: [{ name: "T", url: `${base}/community/club/1-t` }] }),
    discussion: ld.discussionJsonLd({ headline: "T", url: `${base}/t`, text: "Body", author: { name: "Ada" }, datePublished: "2026-01-01", dateModified: "2026-01-02", upvotes: 2, commentCount: 1, comments: [{ text: "Hi", author: "Bo", upvotes: 1, datePublished: "2026-01-02" }], communityName: "Club", communityUrl: `${base}/c` }),
    qa: ld.qaPageJsonLd({ name: "Q?", url: `${base}/q`, text: "Body", author: "Ada", datePublished: "2026-01-01", upvotes: 3, answers: [{ text: "A", author: "Bo", upvotes: 2, accepted: true, datePublished: "2026-01-02" }, { text: "B", author: "", upvotes: 0 }] }),
    faq: ld.faqJsonLd([{ question: "Q", answer: "A" }]),
    event: ld.eventJsonLd({ name: "AMA", url: `${base}/live/x`, startDate: "2026-11-25T00:33:00Z", endDate: "2026-11-25T01:33:00Z", org: o, performers: [{ name: "Ada" }], isFree: true }),
    collection: ld.collectionJsonLd({ name: "Shelf", url: `${base}/f`, org: o, items: [{ name: "A", url: `${base}/a` }] }),
    credential: ld.credentialJsonLd({ name: "Certified", url: `${base}/certificates/X/verify`, description: "d", issuedOn: "2026-10-31 11:12:46", org: o, courseName: "Py", courseUrl: `${base}/course/py`, credentialId: "X" }),
    product: ld.productJsonLd({ name: "Pro", url: `${base}/store/offers/1`, description: "d", price: 19, currency: "eur", org: o }),
  };
  for (const [name, data] of Object.entries(samples)) {
    test(name, () => {
      expect(data).not.toBeNull();
      expect(validateJsonLd(data)).toEqual([]);
    });
  }
  test("QAPage picks the accepted answer and suggests the rest", () => {
    expect(samples.qa.mainEntity.acceptedAnswer.text).toBe("A");
    expect(samples.qa.mainEntity.suggestedAnswer).toHaveLength(1);
    expect(samples.qa.mainEntity.answerCount).toBe(2);
    const none = ld.qaPageJsonLd({ name: "Q", url: base, author: "", answers: [{ text: "", author: "x" }] });
    expect(none.mainEntity.acceptedAnswer).toBeUndefined();
    expect(none.mainEntity.suggestedAnswer[0].text).toBe("…");
    expect(none.mainEntity.author.name).toBe("Member");
  });
  test("product offer price formatting; no offer without a price", () => {
    expect(samples.product.offers).toMatchObject({ price: "19.00", priceCurrency: "EUR" });
    expect(ld.productJsonLd({ name: "Free", url: base, org: o }).offers).toBeUndefined();
    expect(ld.credentialJsonLd({ name: "C", url: base, org: o }).about).toBeUndefined();
  });
  test("the validator catches mistakes", () => {
    expect(validateJsonLd({ "@context": "https://schema.org", "@type": "PodcastSeries", episode: [] })).toContain("$: PodcastSeries has no property episode");
    expect(validateJsonLd({ "@type": "Nope" })).toEqual(["$: @context must be https://schema.org", "$: unknown type Nope"]);
    expect(validateJsonLd({ "@context": "https://schema.org", "@type": "Event", name: "" })).toContain("$: Event is missing startDate");
    expect(validateJsonLd([{ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: [] }])).toContain("$[0].mainEntity: empty value");
  });
});
