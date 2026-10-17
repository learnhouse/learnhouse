// Behaviour tests for the /api/auth/* proxy: the refresh token must only ever
// reach the browser as an httpOnly cookie, and state-changing calls must come
// from this site (login CSRF). All fixtures are synthetic.

import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";

mock.module("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

mock.module("@services/config/config", () => ({
  getConfig: () => "http://api.test",
}));

const backendCalls = [];
let backendBody = {};
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  backendCalls.push({ url: String(url), init });
  return new Response(JSON.stringify(backendBody), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};
afterAll(() => {
  globalThis.fetch = realFetch;
});

const { POST } = await import("../app/api/auth/[...path]/route.ts");

function login(headers = {}) {
  return POST(
    new NextRequest("https://org.example.test/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", host: "org.example.test", ...headers },
      body: JSON.stringify({ email: "a@example.test", password: "x" }),
    }),
  );
}

beforeEach(() => {
  backendCalls.length = 0;
  backendBody = {
    user: { id: 1 },
    tokens: { access_token: "acc.tok.en", refresh_token: "refresh-secret", expiry: 1 },
  };
});

describe("refresh token exposure", () => {
  test("sets the refresh cookie but strips it from the JSON body", async () => {
    const res = await login({ origin: "https://org.example.test" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tokens.access_token).toBe("acc.tok.en");
    expect(body.tokens.refresh_token).toBeUndefined();
    expect(res.headers.get("set-cookie")).toContain("refresh-secret");
  });

  test("strips a top-level refresh_token too", async () => {
    backendBody = { access_token: "acc.tok.en", refresh_token: "refresh-secret" };
    const body = await (await login({ origin: "https://org.example.test" })).json();
    expect(body.refresh_token).toBeUndefined();
    expect(body.access_token).toBe("acc.tok.en");
  });
});

describe("login CSRF", () => {
  test("rejects a cross-site POST without calling the backend", async () => {
    const res = await login({ origin: "https://evil.example" });
    expect(res.status).toBe(403);
    expect(backendCalls).toHaveLength(0);
  });

  test("rejects a cross-site POST that carries no Origin", async () => {
    const res = await login({ "sec-fetch-site": "cross-site" });
    expect(res.status).toBe(403);
    expect(backendCalls).toHaveLength(0);
  });

  test("allows a same-origin POST", async () => {
    const res = await login({ origin: "https://org.example.test", "sec-fetch-site": "same-origin" });
    expect(res.status).toBe(200);
    expect(backendCalls).toHaveLength(1);
  });
});

describe("client host forwarding", () => {
  test("tells the backend which host the browser signed in on", async () => {
    await login({ origin: "https://learn.custom.test", host: "learn.custom.test" });
    expect(backendCalls[0].init.headers["x-learnhouse-client-host"]).toBe("learn.custom.test");
  });

  test("prefers the ingress's forwarded host over the pod's Host", async () => {
    await login({
      origin: "https://learn.custom.test",
      host: "web:3000",
      "x-forwarded-host": "learn.custom.test",
    });
    expect(backendCalls[0].init.headers["x-learnhouse-client-host"]).toBe("learn.custom.test");
  });
});

describe("2FA session rotation", () => {
  test("turning 2FA on stores the rotated pair in this site's cookies", async () => {
    backendBody = { backup_codes: ["a"], tokens: { access_token: "new.acc.tok", refresh_token: "new-refresh" } };
    const res = await POST(
      new NextRequest("https://org.example.test/api/auth/mfa/confirm", {
        method: "POST",
        headers: { "content-type": "application/json", host: "org.example.test", origin: "https://org.example.test" },
        body: JSON.stringify({ code: "123456" }),
      }),
    );
    expect(res.status).toBe(200);
    const cookies = res.headers.get("set-cookie");
    expect(cookies).toContain("new-refresh");
    expect(cookies).toContain("new.acc.tok");
    const body = await res.json();
    expect(body.backup_codes).toEqual(["a"]);
    expect(body.tokens.refresh_token).toBeUndefined();
  });
});
