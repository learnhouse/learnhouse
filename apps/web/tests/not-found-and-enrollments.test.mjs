import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";

let response = { ok: true, status: 200, statusText: "OK", json: async () => [] };

mock.module("@services/config/config", () => ({ getAPIUrl: () => "https://api.test/api/v1/" }));
mock.module("@services/utils/ts/requests", () => ({
  RequestBodyWithAuthHeader: () => ({}),
  secureFetch: async () => response,
  getResponseMetadata: async (r) => ({ success: r.ok, data: await r.json(), status: r.status, HTTPmessage: r.statusText }),
}));

const { getUserEnrollments } = await import("../services/payments/offers.ts");

describe("root not-found page", () => {
  // A prerendered 404 turns an unknown Server Action posted to a missing path
  // into a 500 ("Expected RSC response, got text/plain") instead of a 404.
  test("is rendered per request", () => {
    const source = readFileSync(new URL("../app/not-found.tsx", import.meta.url), "utf8");
    expect(source).toMatch(/export const dynamic = 'force-dynamic'/);
  });
});

describe("getUserEnrollments", () => {
  test("treats an org without payments (403) as no purchases", async () => {
    response = { ok: false, status: 403, statusText: "Forbidden", json: async () => ({ detail: "plan" }) };
    const result = await getUserEnrollments(1, "token");
    expect(result.success).toBe(true);
    expect(result.data).toEqual([]);
  });

  test("still throws on other failures", async () => {
    response = { ok: false, status: 500, statusText: "Internal Server Error", json: async () => null };
    await expect(getUserEnrollments(1, "token")).rejects.toThrow("Internal Server Error");
  });

  test("returns enrollments on success", async () => {
    response = { ok: true, status: 200, statusText: "OK", json: async () => [{ enrollment_id: 1 }] };
    expect((await getUserEnrollments(1, "token")).data).toEqual([{ enrollment_id: 1 }]);
  });
});
