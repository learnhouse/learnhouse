// The package content origin (lib/packageContent): a host on its own domain
// where SCORM and xAPI packages run with no login session. The middleware
// serves only the player shell there, and never serves the shell anywhere else.

import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";

mock.module("./services/config/config", () => ({ getAPIUrl: () => "http://api.test/" }));
mock.module("@services/config/config", () => ({ getAPIUrl: () => "http://api.test/" }));

const realFetch = globalThis.fetch;
const realEnv = process.env.LEARNHOUSE_PACKAGE_CONTENT_URL;
globalThis.fetch = async () =>
  Response.json({
    tenancy: "single",
    mode: "oss",
    default_org_slug: "default",
    frontend_domain: "school.test",
    top_domain: "school.test",
  });
afterAll(() => {
  globalThis.fetch = realFetch;
});

const { default: proxy } = await import("../proxy.ts");
const {
  getPackageContentHost,
  getPackageContentUrl,
  isPackageContentHost,
  isPackageContentPath,
} = await import("../lib/packageContent.ts");

beforeEach(() => {
  process.env.LEARNHOUSE_PACKAGE_CONTENT_URL = "https://content.example-lms.net/";
});
afterEach(() => {
  if (realEnv === undefined) delete process.env.LEARNHOUSE_PACKAGE_CONTENT_URL;
  else process.env.LEARNHOUSE_PACKAGE_CONTENT_URL = realEnv;
});

const get = (host, path, cookie) =>
  proxy(new NextRequest(`https://${host}${path}`, { headers: { host, ...(cookie ? { cookie } : {}) } }));

describe("content origin config", () => {
  test("reads the origin", () => {
    expect(getPackageContentUrl()).toBe("https://content.example-lms.net");
    expect(getPackageContentHost()).toBe("content.example-lms.net");
    process.env.LEARNHOUSE_PACKAGE_CONTENT_URL = " http://localhost:4000/x ";
    expect(getPackageContentUrl()).toBe("http://localhost:4000");
    expect(getPackageContentHost()).toBe("localhost:4000");
  });

  test("is off when unset or invalid", () => {
    for (const value of ["", "content.example-lms.net", "ftp://x.test", "https://"]) {
      process.env.LEARNHOUSE_PACKAGE_CONTENT_URL = value;
      expect(getPackageContentUrl()).toBeNull();
      expect(getPackageContentHost()).toBeNull();
      expect(isPackageContentHost("content.example-lms.net")).toBe(false);
    }
  });

  test("matches the host exactly", () => {
    expect(isPackageContentHost("Content.Example-LMS.net")).toBe(true);
    expect(isPackageContentHost("a.content.example-lms.net")).toBe(false);
    expect(isPackageContentHost("content.example-lms.net.evil.test")).toBe(false);
    expect(isPackageContentHost(undefined)).toBe(false);
  });

  test("answers only the shell and package routes", () => {
    for (const path of ["/package-player", "/api/pkg/c/x", "/api/xapi/statements", "/_next/static/a.js", "/favicon.ico"]) {
      expect(isPackageContentPath(path)).toBe(true);
    }
    for (const path of ["/", "/login", "/api/scorm/x", "/api/auth/session", "/package-player/x"]) {
      expect(isPackageContentPath(path)).toBe(false);
    }
  });
});

describe("middleware", () => {
  test("serves the shell on the content origin, untouched", async () => {
    const res = await get("content.example-lms.net", "/package-player");
    expect(res.status).toBe(200);
    expect(res.headers.get("x-middleware-next")).toBe("1");
    expect(res.headers.get("x-middleware-rewrite")).toBeNull();
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  test("serves nothing else there", async () => {
    for (const path of ["/", "/login", "/course/abc", "/dash"]) {
      const res = await get("content.example-lms.net", path, "LH_org=default");
      expect(res.status).toBe(404);
      expect(res.headers.get("set-cookie")).toBeNull();
    }
  });

  test("never serves the shell on the platform", async () => {
    expect((await get("school.test", "/package-player")).status).toBe(404);
    delete process.env.LEARNHOUSE_PACKAGE_CONTENT_URL;
    expect((await get("school.test", "/package-player")).status).toBe(404);
  });

  test("leaves the platform alone", async () => {
    const res = await get("school.test", "/");
    expect(res.status).not.toBe(404);
  });
});
