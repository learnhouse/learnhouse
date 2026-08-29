import { afterEach, describe, expect, mock, test } from "bun:test";

// The de-index guard on the activity route is only as good as the fetch under
// it. `ssr-metadata-guards.test.mjs` pins the guard's *decision* given an
// error; this file pins the half that made the guard vacuous in production:
// `getActivityWithAuthHeader` used to end in a bare `await result.json()`, so a
// status-carrying failure never rejected. The API's JSON-bodied 5xx resolved as
// `{detail: ...}`, the page's `!activity?.name` fallback branch ran, and
// `fallbackRobots(courseError, activityError)` was handed two nulls — which
// means `index:false, follow:false` on a healthy public activity page, with no
// Sentry event because nothing had thrown. Only a non-JSON gateway page or a
// socket error ever reached the guard.
//
// So the cases below run the REAL service against a stubbed fetch and feed its
// real outcome through the real guard, end to end.

const captured = [];
mock.module("@sentry/nextjs", () => ({
  captureException: (error, context) => captured.push({ error, context }),
}));

const { getActivityWithAuthHeader, getUrlPreview } = await import(
  "../services/courses/activities.ts"
);
const { fallbackRobots, ssrMetadataFetch } = await import(
  "../services/utils/ts/ssrMetadata.ts"
);

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  captured.length = 0;
});

/** A JSON response, the shape FastAPI's HTTPException produces. */
const stubJson = (status, body) => {
  globalThis.fetch = async () => ({
    status,
    ok: status >= 200 && status < 300,
    statusText: status === 200 ? "OK" : "Error",
    json: async () => body,
  });
};

/** A response whose body is NOT JSON — an nginx/gateway HTML error page. */
const stubHtml = (status) => {
  globalThis.fetch = async () => ({
    status,
    ok: false,
    statusText: "Bad Gateway",
    json: async () => {
      throw new SyntaxError("Unexpected token '<', \"<html>\" is not valid JSON");
    },
  });
};

/**
 * Everything the activity route's `generateMetadata` does with the activity
 * fetch, minus the parts that need a renderer: guard it, then decide robots.
 * The course fetch is assumed healthy (its own rejection is already covered),
 * which is exactly the situation the bug produced a wrong answer for.
 */
const robotsFor = async (activityPromise) => {
  const activityFetch = await ssrMetadataFetch(
    "/orgs/[orgslug]/course/[courseuuid]/activity/[activityid]",
    "getActivityWithAuthHeader",
    activityPromise
  );
  const activity = activityFetch.data;
  if (!activity?.name) {
    return { robots: fallbackRobots(null, activityFetch.error), activityFetch };
  }
  return { robots: null, activityFetch };
};

const NOINDEX = { robots: { index: false, follow: false } };

describe("getActivityWithAuthHeader rejects on status, so the guard can classify", () => {
  test("a 200 resolves with the activity", async () => {
    stubJson(200, { name: "Intro", published: true });
    await expect(
      getActivityWithAuthHeader("uuid", null, "tok")
    ).resolves.toMatchObject({ name: "Intro" });
  });

  test("a 403 rejects with status 403 and the backend detail", async () => {
    stubJson(403, { detail: "Resource is not public or not published" });
    const error = await getActivityWithAuthHeader("uuid", null, null).then(
      () => null,
      (e) => e
    );
    expect(error).toBeInstanceOf(Error);
    expect(error.status).toBe(403);
    expect(error.message).toBe("Resource is not public or not published");
  });

  test("a JSON-bodied 500 rejects instead of resolving to {detail}", async () => {
    // THE bug. `{detail: ...}` used to come back as a resolved value.
    stubJson(500, { detail: "Internal Server Error" });
    const error = await getActivityWithAuthHeader("uuid", null, "tok").then(
      () => null,
      (e) => e
    );
    expect(error).toBeInstanceOf(Error);
    expect(error.status).toBe(500);
  });

  test("an HTML gateway 502 rejects with the status, not a parse error", async () => {
    stubHtml(502);
    const error = await getActivityWithAuthHeader("uuid", null, "tok").then(
      () => null,
      (e) => e
    );
    expect(error.status).toBe(502);
  });

  test("a 401 does NOT force a logout", async () => {
    // errorHandlingWithoutAuthRedirect, deliberately: anonymous visitors get
    // 401s on public learner surfaces, and evicting them would be far worse
    // than the shape bug this fixes.
    let dispatched = 0;
    const listener = () => dispatched++;
    globalThis.addEventListener?.("authExpired", listener);
    stubJson(401, { detail: "Unauthorized" });
    const error = await getActivityWithAuthHeader("uuid", null, "tok").then(
      () => null,
      (e) => e
    );
    expect(error.status).toBe(401);
    expect(dispatched).toBe(0);
    globalThis.removeEventListener?.("authExpired", listener);
  });
});

describe("the activity route's robots decision, end to end", () => {
  test("403 — private/unpublished — is noindex and silent", async () => {
    stubJson(403, { detail: "Resource is not public or not published" });
    const { robots } = await robotsFor(getActivityWithAuthHeader("u", null, null));
    expect(robots).toEqual(NOINDEX);
    expect(captured).toHaveLength(0);
  });

  test("404 is noindex and silent", async () => {
    stubJson(404, { detail: "Activity not found" });
    const { robots } = await robotsFor(getActivityWithAuthHeader("u", null, null));
    expect(robots).toEqual(NOINDEX);
    expect(captured).toHaveLength(0);
  });

  test("a JSON-bodied 500 emits NO robots directive and reaches Sentry", async () => {
    // The regression this whole file exists for: before the service rejected,
    // this path produced NOINDEX on a live public page and reported nothing.
    stubJson(500, { detail: "Internal Server Error" });
    const { robots } = await robotsFor(getActivityWithAuthHeader("u", null, null));
    expect(robots).toEqual({});
    expect(robots).not.toHaveProperty("robots");
    expect(captured).toHaveLength(1);
    expect(captured[0].context.level).toBe("error");
    expect(captured[0].context.tags.ssr_metadata_fetch).toBe(
      "getActivityWithAuthHeader"
    );
  });

  test("an HTML gateway 502 emits no robots directive either", async () => {
    stubHtml(502);
    const { robots } = await robotsFor(getActivityWithAuthHeader("u", null, null));
    expect(robots).toEqual({});
    expect(captured).toHaveLength(1);
  });

  test("a socket failure emits no robots directive", async () => {
    globalThis.fetch = async () => {
      throw new TypeError("fetch failed");
    };
    const { robots } = await robotsFor(getActivityWithAuthHeader("u", null, null));
    expect(robots).toEqual({});
    expect(captured).toHaveLength(1);
  });

  test("success takes the real metadata path, no fallback at all", async () => {
    stubJson(200, { name: "Intro to Physics", published: true });
    const { robots, activityFetch } = await robotsFor(
      getActivityWithAuthHeader("u", null, null)
    );
    expect(robots).toBeNull();
    expect(activityFetch.error).toBeNull();
    expect(captured).toHaveLength(0);
  });
});

describe("getUrlPreview — the same missing-status-check, a different victim", () => {
  test("a failed preview rejects instead of returning the error body", async () => {
    // WebPreviewComponent does `updateAttributes({ ...data, url })` with
    // whatever this resolves to, so `{detail: ...}` was written into the
    // block's attrs and saved in the document.
    stubJson(500, { detail: "Could not fetch that page" });
    await expect(getUrlPreview("https://example.com")).rejects.toThrow(
      "Could not fetch that page"
    );
  });

  test("a successful preview still resolves with the metadata", async () => {
    stubJson(200, { title: "Example", og_image: "https://example.com/i.png" });
    await expect(getUrlPreview("https://example.com")).resolves.toMatchObject({
      title: "Example",
    });
  });
});

describe("the service keeps its throwing contract", () => {
  test("it does not end in a bare result.json()", async () => {
    const src = await Bun.file(
      new URL("../services/courses/activities.ts", import.meta.url)
    ).text();
    const body = src.slice(src.indexOf("export async function getActivityWithAuthHeader"));
    const fn = body.slice(0, body.indexOf("\nexport "));
    expect(fn).toContain("errorHandlingWithoutAuthRedirect");
    expect(fn).not.toMatch(/await\s+result\.json\(\)/);
  });
});
