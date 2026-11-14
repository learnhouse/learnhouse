import { describe, expect, test } from "bun:test";

import {
  breadcrumbJsonLd,
  collectionJsonLd,
  communityJsonLd,
  compact,
  courseJsonLd,
  discussionJsonLd,
  eventJsonLd,
  faqJsonLd,
  isoDuration,
  itemListJsonLd,
  learningResourceJsonLd,
  organizationJsonLd,
  pathJsonLd,
  plainText,
  podcastSeriesJsonLd,
  rootId,
  toIsoDate,
  websiteJsonLd,
} from "../lib/seo/jsonld.ts";

const org = { name: "Acme Academy", url: "https://learn.acme.com", logo: "https://cdn.acme.com/logo.png" };

describe("helpers", () => {
  test("toIsoDate handles API dates", () => {
    expect(toIsoDate("2026-11-05 01:33:02.174979")).toBe("2026-11-05T01:33:02.174Z");
    expect(toIsoDate("2026-11-02T09:35:42.112875")).toBe("2026-11-02T09:35:42.112Z");
    expect(toIsoDate("2026-11-25T00:33:00Z")).toBe("2026-11-25T00:33:00.000Z");
    expect(toIsoDate("garbage")).toBeUndefined();
    expect(toIsoDate(null)).toBeUndefined();
  });
  test("isoDuration", () => {
    expect(isoDuration(90)).toBe("PT1H30M");
    expect(isoDuration(45)).toBe("PT45M");
    expect(isoDuration(120)).toBe("PT2H");
    expect(isoDuration(0)).toBeUndefined();
    expect(isoDuration(0.2)).toBe("PT1M");
  });
  test("compact drops empties recursively", () => {
    expect(compact({ a: "", b: null, c: [], d: { e: undefined }, f: [{ g: "" }, "x"], h: 0, i: false })).toEqual({ f: ["x"], h: 0, i: false });
  });
  test("plainText strips tags and whitespace", () => {
    expect(plainText("<p>Hello <b>world</b></p>\n\n")).toBe("Hello world");
    expect(plainText("")).toBeUndefined();
  });
  test("rootId", () => {
    expect(rootId("https://x.com/", "organization")).toBe("https://x.com/#organization");
  });
});

describe("organization + website", () => {
  test("organization", () => {
    const o = organizationJsonLd({ ...org, description: "<b>Learn</b>", sameAs: ["https://x.com/acme", "javascript:alert(1)"] });
    expect(o["@type"]).toBe("EducationalOrganization");
    expect(o["@id"]).toBe("https://learn.acme.com/#organization");
    expect(o.description).toBe("Learn");
    expect(o.sameAs).toEqual(["https://x.com/acme"]);
    expect(organizationJsonLd({ ...org, type: "CollegeOrUniversity" })["@type"]).toBe("CollegeOrUniversity");
  });
  test("website links its publisher", () => {
    const w = websiteJsonLd({ name: "Acme", url: org.url, inLanguage: "fr", searchUrlTemplate: `${org.url}/search?q={search_term_string}` });
    expect(w.publisher).toEqual({ "@id": "https://learn.acme.com/#organization" });
    expect(w.potentialAction["@type"]).toBe("SearchAction");
    expect(websiteJsonLd({ name: "Acme", url: org.url }).potentialAction).toBeUndefined();
  });
});

describe("course", () => {
  const base = {
    name: "Intro to Python",
    description: "Learn Python from scratch.",
    url: "https://learn.acme.com/course/intro-to-python",
    image: "https://cdn/x.png",
    org,
    authors: [{ name: "Maya Okafor" }],
    datePublished: "2026-11-02 10:34:19.733259",
    dateModified: "2026-11-05 01:33:02.174979",
    inLanguage: "en",
    educationalLevel: "beginner",
    teaches: ["Variables", "Loops", ""],
    syllabus: [{ name: "Week 1" }, { name: "Week 2", description: "<p>Loops</p>" }],
    workloadMinutes: 150,
    prerequisites: "None",
    audience: "Beginners",
  };
  test("free course has the fields Google's course info needs", () => {
    const c = courseJsonLd(base);
    expect(c["@type"]).toBe("Course");
    expect(c.provider.name).toBe("Acme Academy");
    expect(c.offers).toEqual([{ "@type": "Offer", category: "Free", price: 0, priceCurrency: "USD", url: base.url, availability: "https://schema.org/InStock" }]);
    expect(c.isAccessibleForFree).toBe(true);
    expect(c.hasCourseInstance[0]).toEqual({ "@type": "CourseInstance", courseMode: "Online", courseWorkload: "PT2H30M", inLanguage: "en" });
    expect(c.teaches).toEqual(["Variables", "Loops"]);
    expect(c.syllabusSections[1]).toEqual({ "@type": "Syllabus", name: "Week 2", description: "Loops" });
    expect(c.datePublished).toBe("2026-11-02T10:34:19.733Z");
    expect(c.audience).toEqual({ "@type": "EducationalAudience", audienceType: "Beginners" });
    expect(c.aggregateRating).toBeUndefined();
  });
  test("paid course lists paid offers only", () => {
    const c = courseJsonLd({ ...base, isFree: false, offers: [{ price: 0, currency: "EUR" }, { price: 49, currency: "EUR", name: "Pro", recurring: true }] });
    expect(c.offers).toHaveLength(1);
    expect(c.offers[0]).toMatchObject({ category: "Subscription", price: 49, priceCurrency: "EUR", name: "Pro" });
    expect(c.isAccessibleForFree).toBe(false);
  });
  test("description falls back to the name; ratings only when counted", () => {
    const c = courseJsonLd({ name: "X", url: "https://a/x", org, aggregateRating: { ratingValue: 4.5, ratingCount: 12 } });
    expect(c.description).toBe("X");
    expect(c.aggregateRating).toMatchObject({ ratingValue: 4.5, ratingCount: 12 });
    expect(courseJsonLd({ name: "X", url: "https://a/x", org, aggregateRating: { ratingValue: 0, ratingCount: 0 } }).aggregateRating).toBeUndefined();
    expect(courseJsonLd({ name: "X", url: "https://a/x", org, isFree: false }).offers).toBeUndefined();
  });
});

describe("other entities", () => {
  test("breadcrumbs skip empty items and number from 1", () => {
    const b = breadcrumbJsonLd([{ name: "Home", url: "https://a" }, { name: "", url: "https://a/x" }, { name: "Course", url: "https://a/c" }]);
    expect(b.itemListElement.map((i) => [i.position, i.name])).toEqual([[1, "Home"], [2, "Course"]]);
  });
  test("item list", () => {
    const l = itemListJsonLd("Courses", [{ url: "https://a/1", name: "One" }, { url: "https://a/2" }]);
    expect(l.numberOfItems).toBe(2);
    expect(l.itemListElement[1]).toEqual({ "@type": "ListItem", position: 2, url: "https://a/2" });
  });
  test("learning resource is part of its course", () => {
    const r = learningResourceJsonLd({ name: "Lesson", url: "https://a/c/activity/1", courseName: "C", courseUrl: "https://a/c", type: "Video", isFree: true });
    expect(r.isPartOf["@id"]).toBe("https://a/c#course");
    expect(r.learningResourceType).toBe("Video");
  });
  test("path", () => {
    const p = pathJsonLd({ name: "Data", url: "https://a/p", org, courses: [{ name: "C1", url: "https://a/c1" }] });
    expect(p["@type"]).toBe("EducationalOccupationalProgram");
    expect(p.hasCourse).toEqual([{ "@type": "Course", name: "C1", url: "https://a/c1" }]);
  });
  test("podcast series and episodes", () => {
    const p = podcastSeriesJsonLd({
      name: "Show",
      url: "https://a/podcast/show",
      org,
      feedUrl: "https://a/podcast/x/feed",
      episodes: [{ name: "Ep 1", durationSeconds: 1830, episodeNumber: 1, datePublished: "2026-01-01 00:00:00" }, { name: "Ep 2" }],
    });
    expect(p.webFeed).toBe("https://a/podcast/x/feed");
    expect(p.episode[0]).toMatchObject({ "@type": "PodcastEpisode", timeRequired: "PT31M", episodeNumber: 1 });
    expect(p.episode[1]).toEqual({ "@type": "PodcastEpisode", name: "Ep 2" });
  });
  test("community and discussion", () => {
    const c = communityJsonLd({ name: "Club", url: "https://a/community/club", org, threads: [{ name: "Hi", url: "https://a/t/1" }] });
    expect(c["@type"]).toBe("CollectionPage");
    expect(c.mainEntity.itemListElement).toHaveLength(1);
    expect(communityJsonLd({ name: "Club", url: "https://a", org, threads: [] }).mainEntity).toBeUndefined();
    const d = discussionJsonLd({
      headline: "x".repeat(200),
      url: "https://a/t/1",
      text: "",
      author: { name: "" },
      upvotes: 3,
      commentCount: 1,
      comments: [{ text: "Thanks", author: "Bo", upvotes: 1 }],
      communityName: "Club",
      communityUrl: "https://a/community/club",
    });
    expect(d.headline).toHaveLength(110);
    expect(d.text).toBe(d.headline.padEnd(200, "x"));
    expect(d.author).toEqual({ "@type": "Person", name: "Member" });
    expect(d.interactionStatistic).toHaveLength(2);
    expect(d.comment[0].author.name).toBe("Bo");
  });
  test("faq only with real questions", () => {
    expect(faqJsonLd([])).toBeNull();
    expect(faqJsonLd([{ question: " ", answer: "x" }])).toBeNull();
    expect(faqJsonLd([{ question: "Q?", answer: " A " }]).mainEntity[0]).toEqual({ "@type": "Question", name: "Q?", acceptedAnswer: { "@type": "Answer", text: "A" } });
  });
  test("event", () => {
    const e = eventJsonLd({ name: "AMA", url: "https://a/live/1", startDate: "2026-11-25T00:33:00Z", endDate: "2026-11-25T02:03:00Z", org, performers: [{ name: "Maya" }], cancelled: true, isFree: true });
    expect(e.eventStatus).toBe("https://schema.org/EventCancelled");
    expect(e.eventAttendanceMode).toBe("https://schema.org/OnlineEventAttendanceMode");
    expect(e.location).toEqual({ "@type": "VirtualLocation", url: "https://a/live/1" });
    expect(eventJsonLd({ name: "AMA", url: "https://a", startDate: "2026-11-25T00:33:00Z", org }).eventStatus).toBe("https://schema.org/EventScheduled");
  });
  test("collection", () => {
    const c = collectionJsonLd({ name: "Shelf", url: "https://a/f", org, items: [{ name: "C", url: "https://a/c" }] });
    expect(c.mainEntity.itemListElement[0].position).toBe(1);
  });
});
