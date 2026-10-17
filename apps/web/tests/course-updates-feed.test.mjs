import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

// The route pulls in server-side service modules; stub the few it uses so the
// test exercises only the feed assembly.
const courseMeta = {
  course_uuid: "course_abc",
  name: "Pattern Language",
  description: "A micro course",
  about: "",
  thumbnail_image: "cover.png",
  org_id: 1,
};
let orgInfo = { id: 1, org_uuid: "org_1", slug: "acme", name: "Acme" };
let orgBase = "/";

mock.module("@services/courses/courses", () => ({
  getCourseMetadata: async () => courseMeta,
}));
mock.module("@services/organizations/orgs", () => ({
  getOrganizationContextInfo: async () => {
    if (!orgInfo) throw new Error("Organization not found");
    return orgInfo;
  },
}));
mock.module("@services/config/config", () => ({
  getAPIUrl: () => "http://api.test/api/v1/",
  getUriWithOrg: () => orgBase,
}));
mock.module("@services/media/media", () => ({
  getCourseThumbnailMediaDirectory: (org, course, file) => `http://media.test/${org}/${course}/${file}`,
}));

const { GET } = await import("../app/api/course/[courseuuid]/updates/feed/route.ts");

const makeRequest = (headers = {}) =>
  new Request("http://acme.lvh.me:3000/api/course/abc/updates/feed", {
    headers: { host: "acme.lvh.me:3000", "x-forwarded-proto": "http", "X-Feed-Orgslug": "acme", ...headers },
  });

// Next's route handlers read `nextUrl`; a plain Request gets it bolted on here.
const withNextUrl = (request) => Object.assign(request, { nextUrl: new URL(request.url) });

let realFetch;
let fetched;

beforeEach(() => {
  realFetch = globalThis.fetch;
  fetched = [];
});

afterEach(() => {
  globalThis.fetch = realFetch;
  orgInfo = { id: 1, org_uuid: "org_1", slug: "acme", name: "Acme" };
  orgBase = "/";
});

describe("course updates RSS feed", () => {
  test("renders the course's updates as RSS items with escaped text", async () => {
    globalThis.fetch = async (url) => {
      fetched.push(String(url));
      return new Response(
        JSON.stringify([
          {
            id: 1,
            courseupdate_uuid: "courseupdate_1",
            title: "Week 2 <live>",
            content: "Q&A on Friday",
            creation_date: "2026-10-01T10:00:00Z",
          },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    };

    const response = await GET(withNextUrl(makeRequest()), {
      params: Promise.resolve({ courseuuid: "abc" }),
    });
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("application/rss+xml");
    expect(fetched).toEqual(["http://api.test/api/v1/courses/course_abc/updates"]);
    expect(body).toContain("<title>Pattern Language - Updates</title>");
    expect(body).toContain("<title>Week 2 &lt;live&gt;</title>");
    expect(body).toContain("<description>Q&amp;A on Friday</description>");
    expect(body).toContain('<guid isPermaLink="false">courseupdate_1</guid>');
    expect(body).toContain("<link>http://acme.lvh.me:3000/course/abc</link>");
    expect(body).toContain('href="http://acme.lvh.me:3000/course/abc/updates/feed"');
    expect(body).toContain("<url>http://media.test/org_1/course_abc/cover.png</url>");
  });

  test("links use the host the feed was fetched on, custom domains included", async () => {
    globalThis.fetch = async () => new Response("[]", { status: 200 });
    orgBase = "https://acme.learnhouse.test/";

    let response = await GET(
      withNextUrl(makeRequest({ host: "learn.acme-school.test", "x-forwarded-proto": "https" })),
      { params: Promise.resolve({ courseuuid: "abc" }) }
    );
    let body = await response.text();
    expect(body).toContain("<link>https://learn.acme-school.test/course/abc</link>");

    // Behind an internal host, fall back to the configured org URL.
    response = await GET(
      withNextUrl(makeRequest({ host: "localhost:3000", "x-forwarded-proto": "" })),
      { params: Promise.resolve({ courseuuid: "abc" }) }
    );
    body = await response.text();
    expect(body).toContain("<link>https://acme.learnhouse.test/course/abc</link>");
  });

  test("hides courses the anonymous API call may not read", async () => {
    globalThis.fetch = async () => new Response("{}", { status: 403 });

    const response = await GET(withNextUrl(makeRequest()), {
      params: Promise.resolve({ courseuuid: "abc" }),
    });

    expect(response.status).toBe(404);
  });

  test("unknown orgs and courses of another org are not found", async () => {
    globalThis.fetch = async () => new Response("[]", { status: 200 });

    orgInfo = null;
    let response = await GET(withNextUrl(makeRequest()), { params: Promise.resolve({ courseuuid: "abc" }) });
    expect(response.status).toBe(404);

    orgInfo = { id: 2, org_uuid: "org_2", slug: "other", name: "Other" };
    response = await GET(withNextUrl(makeRequest()), { params: Promise.resolve({ courseuuid: "abc" }) });
    expect(response.status).toBe(404);
  });

  test("requires the org context the proxy injects", async () => {
    const request = new Request("http://acme.lvh.me:3000/api/course/abc/updates/feed");
    const response = await GET(withNextUrl(request), {
      params: Promise.resolve({ courseuuid: "abc" }),
    });

    expect(response.status).toBe(400);
  });
});
