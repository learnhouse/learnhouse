import { describe, expect, test } from "bun:test";

import {
  orgIdFromConnectState,
  readStripeCallbackParams,
  stripeCallbackStep,
} from "../lib/payments/stripeConnectCallback.ts";

// A JWT-shaped state whose payload is {"sub":"user_x","org_id":2394,...}.
const b64url = (obj) =>
  Buffer.from(JSON.stringify(obj)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const signedState = (payload) => `eyJhbGciOiJIUzI1NiJ9.${b64url(payload)}.signature`;

describe("stripeCallbackStep", () => {
  // Stripe's authorization code is single-use and re-sending it revokes the
  // connection. The callback page used to send it while the session was still
  // loading, without a token: the API refused the anonymous request after the
  // code was already spent, and the real retry then failed as "already used".
  test("waits while the session is loading", () => {
    expect(stripeCallbackStep("loading", undefined, false)).toBe("wait");
    expect(stripeCallbackStep(undefined, undefined, false)).toBe("wait");
  });

  test("waits for a token even once authenticated", () => {
    expect(stripeCallbackStep("authenticated", undefined, false)).toBe("wait");
  });

  test("submits once there is a session and a token", () => {
    expect(stripeCallbackStep("authenticated", "token", false)).toBe("submit");
  });

  test("never submits twice", () => {
    expect(stripeCallbackStep("authenticated", "token", true)).toBe("wait");
    expect(stripeCallbackStep("authenticated", "rotated-token", true)).toBe("wait");
  });

  test("asks a signed-out visitor to sign in instead of submitting", () => {
    expect(stripeCallbackStep("unauthenticated", undefined, false)).toBe("login");
  });
});

describe("orgIdFromConnectState", () => {
  test("reads org_id from a signed state", () => {
    expect(orgIdFromConnectState(signedState({ sub: "user_x", org_id: 2394 }))).toBe(2394);
  });

  test("decodes base64url payloads that need padding or use - and _", () => {
    // Pick a payload whose encoding contains url-safe characters.
    const payload = { sub: "user_??>>", org_id: 7 };
    expect(b64url(payload)).toMatch(/[-_]/);
    expect(orgIdFromConnectState(signedState(payload))).toBe(7);
  });

  test("reads the legacy org_id=<id> form", () => {
    expect(orgIdFromConnectState("org_id=12")).toBe(12);
  });

  test("rejects anything else", () => {
    expect(orgIdFromConnectState("")).toBe(null);
    expect(orgIdFromConnectState("garbage")).toBe(null);
    expect(orgIdFromConnectState("a.!!!.c")).toBe(null);
    expect(orgIdFromConnectState(signedState({ sub: "user_x" }))).toBe(null);
    expect(orgIdFromConnectState(signedState({ org_id: "12" }))).toBe(null);
    expect(orgIdFromConnectState(signedState({ org_id: -1 }))).toBe(null);
  });
});

describe("readStripeCallbackParams", () => {
  const params = (query) => new URLSearchParams(query);

  test("is ready with a code and a readable state", () => {
    const state = signedState({ org_id: 5 });
    expect(readStripeCallbackParams(params({ code: "ac_1", state }))).toEqual({
      kind: "ready",
      code: "ac_1",
      state,
      orgId: 5,
    });
  });

  test("reports a cancel on Stripe's screen", () => {
    expect(
      readStripeCallbackParams(params({ error: "access_denied", error_description: "The user denied your request" }))
    ).toEqual({ kind: "cancelled" });
  });

  test("is invalid without a code or a usable state", () => {
    expect(readStripeCallbackParams(params({ state: "org_id=5" }))).toEqual({ kind: "invalid" });
    expect(readStripeCallbackParams(params({ code: "ac_1" }))).toEqual({ kind: "invalid" });
    expect(readStripeCallbackParams(params({ code: "ac_1", state: "nope" }))).toEqual({ kind: "invalid" });
  });
});
