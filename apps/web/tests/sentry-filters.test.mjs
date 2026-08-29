import { describe, expect, test } from "bun:test";

/**
 * Every rule in the Sentry configs cost a triage pass to identify, and each one
 * is invisible until it stops working: delete an entry and the project quietly
 * refills with the same noise weeks later. These tests make that visible — they
 * run per-PR in the `web-tests` job of .github/workflows/web-lint.yaml. (Before
 * that job existed, apps/web's `bun test tests` was never executed by CI at all,
 * which is how tests/catalog-pagination.test.mjs sat importing a module that
 * does not exist from the commit that added it.) The job is not a required
 * status check on `dev` yet, so a red run marks the PR without blocking the
 * merge — see the comment on the job.
 *
 * The other half of the job is the reverse guard. A filter that swallows a real
 * regression is worse than the noise it removes, so every suppression here is
 * paired with a control asserting a first-party error of the same shape still
 * reports.
 */

// Clear the DSN before importing: the configs call Sentry.init() at module
// scope when one is present, and bun loads .env automatically.
delete process.env.NEXT_PUBLIC_LEARNHOUSE_SENTRY_DSN;
delete process.env.LEARNHOUSE_SENTRY_DSN;

const { beforeSendClient, normalizeRouteKey, IGNORE_ERRORS, DENY_URLS } = await import(
  "../sentry.client.config.ts"
);
const { beforeSendServer } = await import("../sentry.server.config.ts");
const { beforeSendEdge } = await import("../sentry.edge.config.ts");

const errorEvent = (value, frames) => ({
  exception: { values: [{ value, stacktrace: frames ? { frames } : undefined }] },
});
const frame = (filename, fn) => ({ filename, function: fn });

const matches = (needle) =>
  IGNORE_ERRORS.some((rule) =>
    typeof rule === "string" ? needle.includes(rule) : rule.test(needle),
  );

describe("client ignoreErrors", () => {
  // One case per Sentry issue that was closed by adding the entry. The message
  // is the real one from the event, not a paraphrase.
  const covered = {
    "extension port teardown": "Attempting to use a disconnected port object",
    "extension reload": "Extension context invalidated",
    "resize observer": "ResizeObserver loop completed with undelivered notifications",
    "chrome autoplay policy":
      "play() failed because the user didn't interact with the document first",
    "interrupted playback": "The play() request was interrupted",
    "safari autoplay policy":
      "The request is not allowed by the user agent or the platform in the current context, possibly because the user denied permission.",
    "aborted media/fetch operation": "AbortError: The operation was aborted.",
    "posthog ingestion timeout": "PostHog request timed out after 60000ms",
  };

  for (const [label, message] of Object.entries(covered)) {
    test(`ignores ${label}`, () => {
      expect(matches(message)).toBe(true);
    });
  }

  test("does not ignore ordinary application errors", () => {
    for (const message of [
      "Cannot read properties of undefined (reading 'course_uuid')",
      "Failed to load course content",
      "Unexpected token '<' in JSON at position 0",
      "Could not validate credentials",
      // Deliberately NOT an ignoreErrors entry: WebKit words a truncated
      // *script* exactly like a truncated document, and only beforeSend can
      // see the frame that tells them apart. See the beforeSend cases below.
      "SyntaxError: Unexpected EOF",
    ]) {
      expect(matches(message)).toBe(false);
    }
  });
});

describe("client denyUrls", () => {
  const denied = (url) => DENY_URLS.some((rule) => rule.test(url));

  test("drops injected extension scripts", () => {
    expect(denied("chrome-extension://acmacodkjbdgmoleebolmdjonilkdbch/background.js")).toBe(true);
    expect(denied("app:///inpage.js")).toBe(true);
    expect(denied("app:///extensionServiceWorker.js")).toBe(true);
    expect(denied("app:///frame_ant/frame_ant.js")).toBe(true);
  });

  test("never drops our own bundles", () => {
    expect(denied("app:///_next/static/chunks/main-app-1a2b3c.js")).toBe(false);
    expect(denied("https://learnhouse.io/_next/static/chunks/pages/index.js")).toBe(false);
  });
});

describe("client beforeSend", () => {
  test("drops an event whose throwing frame is eval'd/injected code", () => {
    // The real shape: Sentry's own browserApiErrors wrapper contributes an
    // outer frame from OUR bundle, and the frame that threw is a bare numeric
    // pseudo-filename. An `.every()` over all frames could never catch this.
    const event = errorEvent("yt.click is not a function", [
      frame("app:///_next/static/chunks/12ug37fat-vpv.js", "o"),
      frame("303", "?"),
    ]);
    expect(beforeSendClient(event, {})).toBeNull();
  });

  test("keeps a genuine first-party error with the same wrapper frame", () => {
    const event = errorEvent("thing.click is not a function", [
      frame("app:///_next/static/chunks/12ug37fat-vpv.js", "o"),
      frame("app:///_next/static/chunks/page-9f8e.js", "handleClick"),
    ]);
    expect(beforeSendClient(event, {})).toBe(event);
  });

  test("drops a wallet extension's plain-object rejection, with or without a stack", () => {
    // Sentry titles these "Object captured as promise rejection with keys: ..."
    // and produces NO frames, so neither denyUrls nor the frame check can see
    // them. The EIP-1193 code is the only reliable tell.
    const withStack = {
      code: 4900,
      message: "The provider is disconnected from all chains.",
      stack: "Error: ...\n  at chrome-extension://acmacodk/background.js:4:1",
    };
    const withoutStack = { code: 4900, message: "The provider is disconnected from all chains." };

    expect(beforeSendClient(errorEvent(""), { originalException: withStack })).toBeNull();
    expect(beforeSendClient(errorEvent(""), { originalException: withoutStack })).toBeNull();
  });

  test("keeps plain-object rejections that are not extension provider errors", () => {
    // This is the guard that stops the rule widening into "drop every object".
    const ours = errorEvent("");
    expect(beforeSendClient(ours, { originalException: { status: 500, detail: "boom" } })).toBe(ours);

    const real = errorEvent("boom");
    expect(beforeSendClient(real, { originalException: new Error("boom") })).toBe(real);
  });

  test("drops a truncated SSR document but never a truncated bundle", () => {
    // WKWebView cutting off a streaming HTML response: one frame, the document.
    const document = errorEvent("SyntaxError: Unexpected EOF", [frame("app:///signup", "?")]);
    expect(beforeSendClient(document, {})).toBeNull();
    expect(beforeSendClient(errorEvent("SyntaxError: Unexpected EOF"), {})).toBeNull();

    // Same wording, our chunk. A bad deploy or a proxy cutting a JS response is
    // our bug and must still report — this is the case a message-substring
    // ignoreErrors entry would have swallowed silently.
    const chunk = errorEvent("SyntaxError: Unexpected EOF", [
      frame("app:///_next/static/chunks/main-app-1a2b3c.js", "?"),
    ]);
    expect(beforeSendClient(chunk, {})).toBe(chunk);

    const deepParse = errorEvent("SyntaxError: Unexpected EOF", [
      frame("app:///_next/static/chunks/framework-9f8e.js", "o"),
      frame("app:///_next/static/chunks/page-1234.js", "parseConfig"),
    ]);
    expect(beforeSendClient(deepParse, {})).toBe(deepParse);
  });

  // The messages Sentry ACTUALLY captures, verbatim from the live events. They
  // are not the browser's bare wording: @sentry/core's fetch instrumentation
  // appends " (hostname)" to the TypeError before rethrowing it
  // (enhanceFetchErrorMessages defaults to "always"). An earlier version of
  // this rule matched only the bare forms, which meant it never fired in
  // production — LEARNHOUSE-WEB-6F/44/5Q kept reporting at error level with
  // default grouping. Do not "simplify" these back to the bare strings.
  const NETWORK_MESSAGES = [
    "Failed to fetch (api.learnhouse.io)", // LEARNHOUSE-WEB-6F, -44 (Chrome)
    "Load failed (api.learnhouse.io)", // LEARNHOUSE-WEB-5Q (Safari)
    "NetworkError when attempting to fetch resource.", // Firefox, SDK's own wording
    "Failed to fetch (localhost:3000)", // host:port
    // Bare forms still occur: the enhancement is skipped when the fetch URL is
    // relative, because `new URL(fetchData.url)` throws (WEB-5Z/-63, /signup).
    "Failed to fetch",
    "Load failed",
  ];

  test("demotes client network failures instead of dropping them", () => {
    // Dropping these would hide a real api.learnhouse.io outage. They stay —
    // collapsed into one low-priority issue rather than one per browser wording.
    for (const message of NETWORK_MESSAGES) {
      // The live transaction shape: a raw pathname carrying UUIDs. The client
      // never sees a parameterized route on this deployment (the tenancy proxy
      // rewrites the URL before Next does), so the fingerprint has to normalize
      // it or every course opens its own issue.
      const event = {
        ...errorEvent(message),
        transaction: "/dash/courses/course/11111111-2222-4333-8444-555555555555/content",
      };
      expect(beforeSendClient(event, {})).toBe(event);
      expect(event.level).toBe("info");
      expect(event.fingerprint).toEqual([
        "client-network-failure",
        "/dash/courses/course/:uuid/content",
      ]);
    }
  });

  test("collapses per browser wording and per UUID, but NOT across routes", () => {
    // The whole point of the demotion is to merge "Failed to fetch" and "Load
    // failed" from the SAME place. Merging them across places would turn one
    // broken endpoint — or a deploy with a wrong NEXT_PUBLIC_LEARNHOUSE_API_URL,
    // which makes every client fetch throw exactly this — into a single
    // info-level bucket that alert rules filter out.
    const chrome = {
      ...errorEvent("Failed to fetch (api.learnhouse.io)"),
      transaction: "/account/purchases",
    };
    const safari = {
      ...errorEvent("Load failed (api.learnhouse.io)"),
      transaction: "/account/purchases",
    };
    const other = {
      ...errorEvent("Failed to fetch (api.learnhouse.io)"),
      transaction: "/course/66666666-7777-4888-8999-aaaaaaaaaaaa/activity/12121212-3434-4565-8787-989898989898",
    };
    // Same route, a different learner's course/activity: must NOT be a new issue.
    const otherCourse = {
      ...errorEvent("Failed to fetch (api.learnhouse.io)"),
      transaction: "/course/bbbbbbbb-cccc-4ddd-8eee-ffffffffffff/activity/9c0f3b21-1111-4c8e-8a3c-3f9d0e2b7c44",
    };
    for (const e of [chrome, safari, other, otherCourse]) beforeSendClient(e, {});

    expect(chrome.fingerprint).toEqual(safari.fingerprint);
    expect(other.fingerprint).toEqual(otherCourse.fingerprint);
    expect(other.fingerprint).not.toEqual(chrome.fingerprint);
  });

  test("a network failure with no transaction still gets a stable fingerprint", () => {
    const event = errorEvent("Failed to fetch (api.learnhouse.io)");
    beforeSendClient(event, {});
    expect(event.fingerprint).toEqual(["client-network-failure", "unknown-route"]);
  });

  test("reads the enhanced message off the original exception too", () => {
    // beforeSend prefers hint.originalException.message, and that is the string
    // the SDK mutated in place — so this path has to match as well.
    const event = { ...errorEvent(""), transaction: "/account/purchases" };
    const err = new TypeError("Failed to fetch (api.learnhouse.io)");
    expect(beforeSendClient(event, { originalException: err })).toBe(event);
    expect(event.level).toBe("info");
  });

  test("an application error that merely contains 'Failed to fetch' is untouched", () => {
    // Tolerating the SDK's " (hostname)" suffix must not widen into "anything
    // that starts with these words".
    for (const message of [
      "Failed to fetch course chapters for org 12",
      "Failed to fetch course chapters (org 12)",
      "Load failed while parsing the activity payload",
    ]) {
      const event = errorEvent(message);
      expect(beforeSendClient(event, {})).toBe(event);
      expect(event.level).toBeUndefined();
      expect(event.fingerprint).toBeUndefined();
    }
  });
});

describe("normalizeRouteKey", () => {
  test("collapses the identifiers production actually puts in a transaction", () => {
    expect(normalizeRouteKey("/course/66666666-7777-4888-8999-aaaaaaaaaaaa")).toBe("/course/:uuid");
    expect(
      normalizeRouteKey("/dash/courses/course/11111111-2222-4333-8444-555555555555/content"),
    ).toBe("/dash/courses/course/:uuid/content");
    // Some routes keep the API's `course_`/`activity_` prefix on the id.
    expect(normalizeRouteKey("/dash/courses/course_11111111-2222-4333-8444-555555555555")).toBe(
      "/dash/courses/:uuid",
    );
    expect(normalizeRouteKey("/dash/org/1234/users")).toBe("/dash/org/:id/users");
    expect(normalizeRouteKey(undefined)).toBe("unknown-route");
    expect(normalizeRouteKey("")).toBe("unknown-route");
  });

  test("keeps the route shape — it is not a hash", () => {
    // Two different routes must never normalize to the same key, or the
    // demotion turns one broken endpoint into ambient noise.
    expect(normalizeRouteKey("/account/purchases")).toBe("/account/purchases");
    expect(normalizeRouteKey("/course/:uuid")).not.toBe(normalizeRouteKey("/account/purchases"));
    // A word that merely looks id-ish stays put.
    expect(normalizeRouteKey("/dash/courses/new")).toBe("/dash/courses/new");
  });
});

describe("server and edge beforeSend", () => {
  test("drop a client disconnect mid-RSC-stream on both runtimes", () => {
    const message = "The destination stream closed early";
    expect(beforeSendServer(errorEvent(message), {})).toBeNull();
    expect(beforeSendEdge(errorEvent(message), {})).toBeNull();
  });

  test("keep the existing Next-internal filters", () => {
    for (const message of [
      "Failed to find Server Action",
      "Organization not found",
      "Organization has no config",
      "The router state header was sent but could not be parsed",
    ]) {
      expect(beforeSendServer(errorEvent(message), {})).toBeNull();
    }
  });

  test("keep real SSR errors", () => {
    // WEB-69's 403 from generateMetadata must never be filtered here — it is a
    // genuine unguarded-render bug, and swallowing it would hide the fix.
    const event = errorEvent("Resource is not public or not published");
    expect(beforeSendServer(event, {})).toBe(event);
    expect(beforeSendEdge(event, {})).toBe(event);
  });
});
