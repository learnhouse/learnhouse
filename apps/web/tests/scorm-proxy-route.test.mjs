import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";

import { GET } from "../app/api/scorm/[...path]/route.ts";

/**
 * Drives the real SCORM proxy route. Package content is untrusted: every
 * response must be sandboxed, authorized by the launch token only, bound to the
 * host the token was minted for, and HTML must carry the SCORM API shim.
 */

const ACTIVITY = "activity_00000000-0000-0000-0000-000000000000";
const b64url = (value) =>
  Buffer.from(JSON.stringify(value)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const tokenFor = (host) => `v1.${b64url({ a: ACTIVITY, e: 9999999999, h: host, o: 1, u: 42 })}.c2ln`;
const TOKEN = tokenFor("org.example.com");
const asset = (file, token = TOKEN) => `${ACTIVITY}/t/${token}/content/${file}`;

let upstream;
const realFetch = globalThis.fetch;

const htmlResponse = (body = "<html><head><title>x</title></head><body></body></html>") =>
  new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });

beforeEach(() => {
  upstream = mock(async () => htmlResponse());
  globalThis.fetch = upstream;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

const call = (path, { headers = {}, host = "org.example.com" } = {}) =>
  GET(new NextRequest(`https://${host}/api/scorm/${path}`, { headers: { host, ...headers } }), {
    params: Promise.resolve({ path: path.split("/") }),
  });

const sentHeaders = () => new Headers(upstream.mock.calls[0][1].headers);

describe("SCORM proxy route", () => {
  test("hits the API's token content endpoint", async () => {
    await call(asset("index.html"));
    expect(String(upstream.mock.calls[0][0])).toEndWith(`scorm/${asset("index.html")}`);
  });

  test("never forwards the viewer's cookie or bearer token", async () => {
    await call(asset("index.html"), { headers: { cookie: "LH_access=abc", authorization: "Bearer abc" } });
    expect(sentHeaders().get("cookie")).toBeNull();
    expect(sentHeaders().get("authorization")).toBeNull();
  });

  test("every response is sandboxed without allow-same-origin", async () => {
    upstream = mock(async () => new Response("x", { status: 200, headers: { "content-type": "text/javascript" } }));
    globalThis.fetch = upstream;
    const response = await call(asset("lib/a.js"));
    const csp = response.headers.get("content-security-policy");
    expect(csp.startsWith("sandbox ")).toBe(true);
    expect(csp).toContain("allow-scripts");
    expect(csp).not.toContain("allow-same-origin");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });

  test("errors are sandboxed too", async () => {
    globalThis.fetch = mock(async () => new Response(null, { status: 401 }));
    const response = await call(asset("index.html"));
    expect(response.status).toBe(401);
    expect(response.headers.get("content-security-policy")).toStartWith("sandbox ");
  });

  test("injects the SCORM shim into HTML right after <head>", async () => {
    const response = await call(asset("index.html"));
    const body = await response.text();
    expect(body.startsWith("<html><head><script data-lh-scorm-shim>")).toBe(true);
    expect(body).toContain("<title>x</title>");
    expect(response.headers.get("content-length")).toBe(String(new TextEncoder().encode(body).length));
  });

  test("puts the shim after the API's seed so the seed is defined first", async () => {
    upstream = mock(async () =>
      htmlResponse('<html><head><script data-lh-scorm-seed>window.__LH_SCORM_SEED__={"version":"SCORM_12","cmi":{}};</script><title>x</title>'),
    );
    globalThis.fetch = upstream;
    const body = await (await call(asset("index.html"))).text();
    expect(body.indexOf("data-lh-scorm-seed")).toBeLessThan(body.indexOf("data-lh-scorm-shim"));
    expect(body.indexOf("data-lh-scorm-shim")).toBeLessThan(body.indexOf("<title>"));
  });

  test("leaves non-HTML bodies alone", async () => {
    upstream = mock(async () => new Response("body{}", { status: 200, headers: { "content-type": "text/css" } }));
    globalThis.fetch = upstream;
    expect(await (await call(asset("a.css"))).text()).toBe("body{}");
  });

  test("refuses a token bound to another host", async () => {
    const response = await call(asset("index.html", tokenFor("other.example.com")));
    expect(response.status).toBe(404);
    expect(upstream).not.toHaveBeenCalled();
  });

  test("the host check ignores the port", async () => {
    const response = await call(asset("index.html"), { host: "org.example.com:3000" });
    expect(response.status).toBe(200);
  });

  test.each([
    `${ACTIVITY}/content/index.html`,
    `${ACTIVITY}/runtime/data`,
    `${ACTIVITY}/results`,
    `${ACTIVITY}/t/${TOKEN}/content`,
    `course_x/t/${TOKEN}/content/index.html`,
    `${ACTIVITY}/t/not-a-token/content/index.html`,
  ])("only token content paths are proxied: %s", async (path) => {
    const response = await call(path);
    expect(response.status).toBe(404);
    expect(upstream).not.toHaveBeenCalled();
  });

  test("never lets a response into a shared cache", async () => {
    const response = await call(asset("index.html"));
    expect(response.headers.get("cache-control")).toContain("private");
  });
});
