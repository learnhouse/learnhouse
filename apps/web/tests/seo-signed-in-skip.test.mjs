// The lesson's structured data (JSON-LD) is built from the anonymous view for
// crawlers. A signed-in reader's page already fetched the lesson and course
// with their token, so the slot must not fetch them a second time.
//
// All fixtures are synthetic.

import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

let jar = {};
mock.module("next/headers", () => ({
  cookies: async () => ({
    get: (name) => (jar[name] ? { value: jar[name] } : undefined),
  }),
  headers: async () => new Headers(),
}));

const calls = [];
mock.module("@services/courses/activities", () => ({
  getActivityWithAuthHeader: async (...args) => {
    calls.push(["activity", ...args]);
    return null;
  },
  isMissingActivityId: (id) => !id || id === "null" || id === "undefined",
}));
mock.module("@services/courses/courses", () => ({
  getCourseMetadata: async (...args) => {
    calls.push(["course", ...args]);
    return null;
  },
}));
mock.module("@/lib/seo/context.server", () => ({
  getSeoContext: async () => ({ seo: { indexing_disabled: false }, org: { name: "Academy" }, lang: "en" }),
}));
mock.module("@/lib/seo/resolve.server", () => ({
  resolvePublicKey: async () => ({ bare_uuid: "c1", canonical_key: "c1", restricted: false }),
}));

const { hasSessionCookie } = await import("../lib/auth/server.ts");
const { default: ActivitySeo } = await import(
  "../app/orgs/[orgslug]/@seo/course/[courseuuid]/activity/[activityid]/page.tsx"
);

const props = () => ({
  params: Promise.resolve({ orgslug: "acme", courseuuid: "c1", activityid: "a1" }),
  searchParams: Promise.resolve({}),
});

beforeEach(() => {
  jar = {};
  calls.length = 0;
});

describe("hasSessionCookie", () => {
  test("any auth cookie counts as a session", async () => {
    expect(await hasSessionCookie()).toBe(false);
    for (const name of ["LH_access", "LH_refresh", "LH_imp"]) {
      jar = { [name]: "x" };
      expect(await hasSessionCookie()).toBe(true);
    }
  });
});

describe("lesson structured data slot", () => {
  test("a signed-in request fetches nothing", async () => {
    jar = { LH_access: "tok" };
    expect(await ActivitySeo(props())).toBeNull();
    expect(calls).toEqual([]);
  });

  test("an anonymous request (a crawler) still reads the lesson and course", async () => {
    expect(await ActivitySeo(props())).toBeNull();
    expect(calls.map((c) => c[0]).sort()).toEqual(["activity", "course"]);
  });
});
