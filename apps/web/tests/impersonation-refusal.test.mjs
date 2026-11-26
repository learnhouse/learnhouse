import { describe, expect, test } from "bun:test";

const imp = await import("../lib/auth/impersonation.ts");

const refusal = (code, extra = {}) => ({ detail: { code, message: "m", ...extra } });

describe("a refused call while impersonating", () => {
  test("only the API saying the session is over ends it", () => {
    expect(imp.impersonationRefusal(401, refusal("IMPERSONATION_ENDED", { reason: "revoked" }))).toEqual({
      kind: "end",
      reason: "revoked",
    });
    expect(imp.impersonationRefusal(401, refusal("IMPERSONATION_ENDED"))).toEqual({ kind: "end", reason: "ended" });
    // A bare 401 goes through the token refresh, which asks the API.
    expect(imp.impersonationRefusal(401, { detail: "Could not validate credentials" })).toBeNull();
    expect(imp.impersonationRefusal(401, null)).toBeNull();
    expect(imp.impersonationRefusal(500, refusal("IMPERSONATION_ENDED"))).toBeNull();
  });

  test("a page of another org shows a notice and keeps the session", () => {
    for (const code of ["IMPERSONATION_WRONG_ORG", "SESSION_NOT_BOUND_TO_ORG", "AUTH_METHOD_NOT_ALLOWED"]) {
      expect(imp.impersonationRefusal(403, refusal(code), "GET")).toEqual({
        kind: "notice",
        code: "IMPERSONATION_WRONG_ORG",
      });
    }
  });

  test("a refused write gets a notice, a page's background read stays quiet", () => {
    expect(imp.impersonationRefusal(403, refusal("IMPERSONATION_READ_ONLY"), "post")).toEqual({
      kind: "notice",
      code: "IMPERSONATION_READ_ONLY",
    });
    expect(imp.impersonationRefusal(403, refusal("IMPERSONATION_DENIED"), "GET")).toBeNull();
    expect(imp.impersonationRefusal(403, refusal("IMPERSONATION_DENIED"), "HEAD")).toBeNull();
    expect(imp.impersonationRefusal(403, refusal("IMPERSONATION_DENIED"))).toBeNull();
    // Plan gates and plain 403s are the page's own business.
    expect(imp.impersonationRefusal(403, { detail: "Boards requires a Standard plan" }, "POST")).toBeNull();
    expect(imp.impersonationRefusal(403, refusal("SOMETHING_ELSE"), "POST")).toBeNull();
  });
});
