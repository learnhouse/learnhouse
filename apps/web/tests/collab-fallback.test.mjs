import { describe, expect, test } from "bun:test";

const {
  CollabStartError,
  RETRY_DELAYS_MS,
  accessResponseKind,
  authFailureKind,
  collabNoticeKind,
  failureKindOf,
  joinWithRetry,
  nextCollabStep,
} = await import("../components/Objects/Editor/Collab/collabStatus.ts");

describe("collab join failures", () => {
  test("reads the collab server's refusal reasons", () => {
    expect(authFailureKind("access-refused")).toBe("refused");
    expect(authFailureKind("permission-denied")).toBe("refused"); // older servers
    expect(authFailureKind(undefined)).toBe("refused");
    expect(authFailureKind("auth-unavailable")).toBe("unavailable");
    expect(authFailureKind("invalid-token")).toBe("unavailable");
    expect(authFailureKind("room-full")).toBe("unavailable");
  });

  test("reads the API's access answer", () => {
    expect(accessResponseKind(200)).toBe(null);
    expect(accessResponseKind(503)).toBe("not_configured");
    expect(accessResponseKind(403, "collab_disabled")).toBe("disabled");
    expect(accessResponseKind(403, "Not allowed to edit this activity")).toBe("forbidden");
    expect(accessResponseKind(403, { code: "PLAN" })).toBe("other");
    expect(accessResponseKind(401)).toBe("other");
    expect(accessResponseKind(404)).toBe("other");
    for (const status of [500, 502, 504, 429, 408]) expect(accessResponseKind(status)).toBe("unavailable");
  });

  test("classifies thrown errors", () => {
    expect(failureKindOf(new CollabStartError("refused", "x"))).toBe("refused");
    expect(failureKindOf(new TypeError("Failed to fetch"))).toBe("unavailable");
    expect(failureKindOf(new Error("boom"))).toBe("other");
    expect(failureKindOf("weird")).toBe("other");
  });

  test("retries unavailable with backoff, then gives up to manual saving", () => {
    RETRY_DELAYS_MS.forEach((ms, attempt) => expect(nextCollabStep("unavailable", attempt)).toEqual({ retryIn: ms }));
    expect(nextCollabStep("unavailable", RETRY_DELAYS_MS.length)).toEqual({ fallback: "unreachable" });
    expect(nextCollabStep("refused", 0)).toEqual({ fallback: "refused" });
    expect(nextCollabStep("forbidden", 0)).toEqual({ forbidden: true });
    expect(nextCollabStep("disabled", 0)).toEqual({ disabled: true });
    expect(nextCollabStep("not_configured", 0)).toEqual({ unavailable: "not configured" });
    expect(nextCollabStep("other", 0, "no session")).toEqual({ unavailable: "no session" });
  });

  test("shows a notice only while live editing is not running", () => {
    expect(collabNoticeKind({ phase: "reconnecting" }, false)).toBe("reconnecting");
    expect(collabNoticeKind({ phase: "fallback" }, false)).toBe("manual");
    expect(collabNoticeKind({ phase: "forbidden" }, false)).toBe("forbidden");
    expect(collabNoticeKind({ phase: "connecting" }, false)).toBe(null);
    expect(collabNoticeKind({ phase: "unavailable" }, false)).toBe(null);
    expect(collabNoticeKind({ phase: "reconnecting" }, true)).toBe(null);
  });
});

describe("join loop", () => {
  const run = (results, { cancelAfter } = {}) => {
    const retries = [];
    const sleeps = [];
    let calls = 0;
    let cancelled = false;
    const outcome = joinWithRetry({
      join: async () => {
        const r = results[Math.min(calls++, results.length - 1)];
        if (cancelAfter !== undefined && calls >= cancelAfter) cancelled = true;
        if (r instanceof Error) throw r;
        return r;
      },
      onRetry: (attempt) => retries.push(attempt),
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      isCancelled: () => cancelled,
    });
    return outcome.then((o) => ({ outcome: o, retries, sleeps, calls: () => calls }));
  };
  const unavailable = () => new CollabStartError("unavailable", "auth-unavailable");

  test("goes live on the first success", async () => {
    const { outcome, retries } = await run(["session"]);
    expect(outcome).toEqual({ phase: "live", session: "session" });
    expect(retries).toEqual([]);
  });

  test("auth service unavailable: reconnects with backoff, then goes live", async () => {
    const { outcome, retries, sleeps } = await run([unavailable(), new TypeError("Failed to fetch"), "session"]);
    expect(outcome).toEqual({ phase: "live", session: "session" });
    expect(retries).toEqual([1, 2]);
    expect(sleeps).toEqual([RETRY_DELAYS_MS[0], RETRY_DELAYS_MS[1]]);
  });

  test("keeps failing: falls back to manual saving after every retry", async () => {
    const { outcome, retries, calls } = await run([unavailable()]);
    expect(outcome).toEqual({ phase: "fallback", reason: "unreachable" });
    expect(retries.length).toBe(RETRY_DELAYS_MS.length);
    expect(calls()).toBe(RETRY_DELAYS_MS.length + 1);
  });

  test("refused by the room: manual saving at once, no retry", async () => {
    const { outcome, calls } = await run([new CollabStartError("refused", "access-refused")]);
    expect(outcome).toEqual({ phase: "fallback", reason: "refused" });
    expect(calls()).toBe(1);
  });

  test("no edit rights: read-only; turned off: disabled; anything else: unavailable", async () => {
    expect((await run([new CollabStartError("forbidden", "x")])).outcome).toEqual({ phase: "forbidden" });
    expect((await run([new CollabStartError("disabled", "x")])).outcome).toEqual({ phase: "disabled" });
    expect((await run([new CollabStartError("other", "no session")])).outcome).toEqual({ phase: "unavailable", reason: "no session" });
  });

  test("stops quietly once cancelled", async () => {
    const { outcome, calls } = await run([unavailable()], { cancelAfter: 1 });
    expect(outcome).toBe(null);
    expect(calls()).toBe(1);
  });
});
