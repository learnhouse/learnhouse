import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";

import { GET } from "../app/api/scorm/[...path]/route.ts";

/**
 * Drives the real SCORM proxy route, not just its helpers, so a refactor that
 * stops passing the learner's credentials upstream fails here instead of
 * showing up as a blank player on every private or draft course.
 */

const ASSET = "activity_00000000-0000-0000-0000-000000000000/content/index.html";

let upstream;
const realFetch = globalThis.fetch;

beforeEach(() => {
  upstream = mock(async () => new Response("<html></html>", {
    status: 200,
    headers: { "content-type": "text/html" },
  }));
  globalThis.fetch = upstream;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

const call = (headers = {}) =>
  GET(new NextRequest(`https://org.example.com/api/scorm/${ASSET}`, { headers }), {
    params: Promise.resolve({ path: ASSET.split("/") }),
  });

const sentHeaders = () => new Headers(upstream.mock.calls[0][1].headers);

describe("SCORM proxy route", () => {
  test("passes the session cookie to the API", async () => {
    await call({ cookie: "LH_access=abc" });
    expect(sentHeaders().get("cookie")).toBe("LH_access=abc");
  });

  test("passes a bearer token to the API", async () => {
    await call({ authorization: "Bearer abc" });
    expect(sentHeaders().get("authorization")).toBe("Bearer abc");
  });

  test("hits the API's SCORM content endpoint", async () => {
    await call();
    expect(String(upstream.mock.calls[0][0])).toEndWith(`scorm/${ASSET}`);
  });

  test("relays an upstream 401 instead of masking it", async () => {
    globalThis.fetch = mock(async () => new Response(null, { status: 401 }));
    const response = await call();
    expect(response.status).toBe(401);
  });

  test("never lets a credentialed response into a shared cache", async () => {
    const response = await call({ cookie: "LH_access=abc" });
    expect(response.headers.get("cache-control")).toContain("private");
  });
});
