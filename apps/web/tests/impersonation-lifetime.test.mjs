import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const token = await import("../lib/auth/impersonationToken.ts");
const imp = await import("../lib/auth/impersonation.ts");

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (claims) => `${b64({ alg: "HS256" })}.${b64(claims)}.sig`;

describe("impersonation cookie lifetime", () => {
  test("Max-Age is exactly what the token has left", () => {
    const now = 1_700_000_000_000;
    const twelveHours = jwt({ exp: now / 1000 + 12 * 3600, purpose: "impersonation" });
    expect(token.impersonationCookieMaxAge(twelveHours, now)).toBe(12 * 3600);
    const twoHours = jwt({ exp: now / 1000 + 7200 });
    expect(token.impersonationCookieMaxAge(twoHours, now)).toBe(7200);
    // A renewed token pushes the cookie out with it.
    const renewed = jwt({ exp: now / 1000 + 3600 + 7200 });
    expect(token.impersonationCookieMaxAge(renewed, now + 3600 * 1000)).toBe(7200);
  });

  test("never negative; unreadable tokens fall back", () => {
    expect(token.impersonationCookieMaxAge(jwt({ exp: 10 }), 1_700_000_000_000)).toBe(0);
    expect(token.impersonationCookieMaxAge("garbage", 0)).toBe(token.IMPERSONATION_COOKIE_FALLBACK_MAX_AGE);
    expect(token.impersonationCookieMaxAge(jwt({ exp: "soon" }), 0)).toBe(token.IMPERSONATION_COOKIE_FALLBACK_MAX_AGE);
    expect(token.impersonationCookieMaxAge(`a.${Buffer.from("{nope").toString("base64url")}.c`, 0)).toBe(
      token.IMPERSONATION_COOKIE_FALLBACK_MAX_AGE,
    );
  });

  test("purpose and claims", () => {
    expect(token.jwtPurpose(jwt({ purpose: "impersonation" }))).toBe("impersonation");
    expect(token.jwtPurpose(jwt({ purpose: 3 }))).toBeNull();
    expect(token.jwtPurpose("x")).toBeNull();
    expect(token.jwtClaims(`a.${Buffer.from("7").toString("base64url")}.c`)).toBeNull();
  });

  test("only the API ends a session, never a missing refresh cookie", async () => {
    const res = (status, body) => new Response(JSON.stringify(body), { status });
    expect(await token.checkImpersonation(async () => res(200, { session_uuid: "s" }))).toEqual({
      state: "active",
      session: { session_uuid: "s" },
    });
    expect(await token.checkImpersonation(async () => res(401, { detail: { reason: "logout" } }))).toEqual({
      state: "ended",
      body: { detail: { reason: "logout" } },
    });
    // Down, busy or refused for another reason: not over.
    for (const status of [403, 429, 503]) {
      expect(await token.checkImpersonation(async () => res(status, {}))).toEqual({ state: "unknown" });
    }
    expect(await token.checkImpersonation(async () => null)).toEqual({ state: "unknown" });
    expect(await token.checkImpersonation(async () => { throw new Error("offline"); })).toEqual({ state: "unknown" });
    const ended = await token.checkImpersonation(async () => new Response("not json", { status: 410 }));
    expect(ended).toEqual({ state: "ended", body: {} });
    expect(token.ownerSessionGone).toBeUndefined();
  });

  test("only 401/404/410 mean the session is over (busy or rate limited is not)", () => {
    for (const s of [401, 404, 410]) expect(token.sessionIsOver(s)).toBe(true);
    for (const s of [400, 403, 429, 500, 503]) expect(token.sessionIsOver(s)).toBe(false);
  });

  test("the proxy sets the cookie from the token's own expiry", () => {
    const lib = readFileSync(new URL("../app/api/auth/impersonation/_lib.ts", import.meta.url), "utf8");
    expect(lib).toContain("maxAge: impersonationCookieMaxAge(token)");
    expect(lib).not.toContain("12 * 60 * 60");
    const status = readFileSync(new URL("../app/api/auth/impersonation/route.ts", import.meta.url), "utf8");
    const refresh = readFileSync(new URL("../app/api/auth/[...path]/route.ts", import.meta.url), "utf8");
    // Both the badge poll and the token refresh ask the API; neither ends a
    // session on its own because this host can't see the staff member's
    // refresh cookie, and neither ever mints or forwards another token.
    expect(refresh).toContain("impersonationRefresh(request, impersonationToken)");
    for (const src of [status, refresh]) {
      expect(src).toContain("checkImpersonation(");
      expect(src).not.toContain("REFRESH_TOKEN_COOKIE)?.value)");
    }
    // The refresh never ends a session itself.
    expect(refresh).not.toContain("api/v1/auth/impersonation/end");
    for (const src of [status, refresh]) expect(src).not.toMatch(/renew/i);
  });
});

describe("why a session ended", () => {
  test("reasons from the API, URLs and events", () => {
    expect(imp.normalizeEndReason("impersonator_changed")).toBe("impersonator_changed");
    expect(imp.normalizeEndReason("token_expired")).toBe("expired");
    expect(imp.normalizeEndReason("nonsense")).toBe("ended");
    expect(imp.normalizeEndReason(undefined, "revoked")).toBe("revoked");
  });

  test("read from a refusal or a proxy reply", () => {
    expect(imp.endReasonOf({ detail: { code: "IMPERSONATION_ENDED", reason: "revoked" } })).toBe("revoked");
    expect(imp.endReasonOf({ code: "impersonation_ended", reason: "expired" })).toBe("expired");
    expect(imp.endReasonOf({ detail: "x" })).toBeNull();
    expect(imp.endReasonOf({ reason: "" })).toBeNull();
    expect(imp.endReasonOf(null)).toBeNull();
  });

  test("every reason has a note in every language", () => {
    expect(imp.endedNoticeKey("ended", true)).toBe("impersonation.returned_ended");
    expect(imp.endedNoticeKey("ended", false)).toBe("impersonation.ended_notice_ended");
    expect(imp.endedNoticeKey("impersonator_changed", true)).toBe("impersonation.ended_notice_impersonator_changed");
    const dir = new URL("../locales/", import.meta.url);
    for (const lang of ["en", "fr", "de", "es", "ar", "zh", "ja", "ru"]) {
      const msgs = JSON.parse(readFileSync(new URL(`${lang}.json`, dir), "utf8")).impersonation;
      for (const reason of imp.IMPERSONATION_END_REASONS) {
        for (const platform of [true, false]) {
          const key = imp.endedNoticeKey(reason, platform).split(".")[1];
          expect(typeof msgs[key]).toBe("string");
        }
      }
    }
    const en = JSON.parse(readFileSync(new URL("en.json", dir), "utf8")).impersonation;
    expect(en.ended_notice_impersonator_changed).toBe("Session ended: permission changed.");
  });
});
