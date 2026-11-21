// Self-hosted URLs: the HTTPS flag older CLIs wrote as "True", and the
// server-only backend URL route handlers use to reach the API.

import { afterEach, describe, expect, test } from "bun:test";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

async function freshConfig() {
  return import(`../services/config/config.ts?t=${Math.random()}`);
}

describe("HTTPS flag", () => {
  test("accepts any casing of true", async () => {
    for (const value of ["true", "True", "TRUE"]) {
      process.env.NEXT_PUBLIC_LEARNHOUSE_HTTPS = value;
      const { getLEARNHOUSE_HTTP_PROTOCOL_VAL } = await freshConfig();
      expect(getLEARNHOUSE_HTTP_PROTOCOL_VAL()).toBe("https://");
    }
  });

  test("anything else is plain http", async () => {
    process.env.NEXT_PUBLIC_LEARNHOUSE_HTTPS = "False";
    const { getLEARNHOUSE_HTTP_PROTOCOL_VAL } = await freshConfig();
    expect(getLEARNHOUSE_HTTP_PROTOCOL_VAL()).toBe("http://");
  });
});

describe("getServerBackendUrl", () => {
  test("prefers the internal API URL", async () => {
    process.env.LEARNHOUSE_INTERNAL_API_URL = "http://localhost:9000/";
    process.env.NEXT_PUBLIC_LEARNHOUSE_BACKEND_URL = "https://learn.school.org/";
    const { getServerBackendUrl } = await freshConfig();
    expect(getServerBackendUrl()).toBe("http://localhost:9000");
  });

  test("falls back to the public backend URL without a trailing slash", async () => {
    delete process.env.LEARNHOUSE_INTERNAL_API_URL;
    process.env.NEXT_PUBLIC_LEARNHOUSE_BACKEND_URL = "https://learn.school.org/";
    const { getServerBackendUrl } = await freshConfig();
    expect(getServerBackendUrl()).toBe("https://learn.school.org");
  });

  test("uses the given fallback when nothing is configured", async () => {
    delete process.env.LEARNHOUSE_INTERNAL_API_URL;
    delete process.env.NEXT_PUBLIC_LEARNHOUSE_BACKEND_URL;
    const { getServerBackendUrl } = await freshConfig();
    expect(getServerBackendUrl("http://localhost:1338")).toBe("http://localhost:1338");
  });
});
