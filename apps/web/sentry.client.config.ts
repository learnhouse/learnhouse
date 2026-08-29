import * as Sentry from "@sentry/nextjs";

// Derived from the installed SDK rather than naming an exported type, so a
// Sentry major that reshuffles its type exports can't break this file.
type SentryOptions = NonNullable<Parameters<typeof Sentry.init>[0]>;
type BeforeSend = NonNullable<SentryOptions["beforeSend"]>;

const rc = typeof window !== 'undefined' ? (window as any).__RUNTIME_CONFIG__ || {} : {};
const SENTRY_DSN = rc.NEXT_PUBLIC_LEARNHOUSE_SENTRY_DSN || process.env.NEXT_PUBLIC_LEARNHOUSE_SENTRY_DSN;
const LEARNHOUSE_ENV = rc.NEXT_PUBLIC_LEARNHOUSE_ENV || process.env.NEXT_PUBLIC_LEARNHOUSE_ENV || "dev";

/**
 * Errors thrown by code we don't ship. Wallet/password-manager extensions
 * inject scripts into every page, and when their own message ports die the
 * rejection is attributed to whatever page they were injected into — ours.
 * Nothing here is actionable from this repo.
 *
 * Exported so tests/sentry-filters.test.mjs can assert each entry is still
 * present: every one of these took a triage pass to identify, and a silent
 * deletion would quietly refill the project with the same noise.
 */
export const IGNORE_ERRORS: (string | RegExp)[] = [
  /Cannot read properties of undefined \(reading '(addListener|emit)'\)/,
  "Attempting to use a disconnected port object",
  "Extension context invalidated",
  "ResizeObserver loop completed with undelivered notifications",
  "ResizeObserver loop limit exceeded",
  // Playback rejections we already handle: the autoplay policy refuses a
  // play() with no user gesture, and a source swap aborts one in flight.
  "The play() request was interrupted",
  "play() failed because the user didn't interact with the document first",
  // Safari's wording for the same autoplay refusal. This is the generic
  // NotAllowedError text, so it deliberately covers every gesture-gated API we
  // call as well — navigator.clipboard.writeText/read (CourseShare,
  // TokenCreatedDialog, CodeSnippetTabs, CreateCourse, sso/callback) and
  // requestFullscreen() in the playground. That breadth is accepted: in all of
  // them the browser is refusing a permission the user or the platform
  // controls, and no change in this repo makes it grant one. The features
  // themselves already surface their own failure to the user.
  "The request is not allowed by the user agent or the platform in the current context",
  // An abort is an intentional cancellation by definition — a source swap, an
  // unmounting component aborting its fetch, a navigation. Never a defect.
  "The operation was aborted",
  // posthog-js aborting its own ingestion request. Analytics capture is
  // fire-and-forget (nothing rendered waits on it), so a dropped event costs a
  // data point and nothing else. See components/Contexts/PostHogProvider.tsx.
  "PostHog request timed out",
];

/**
 * A truncated HTML *document*: iOS in-app browsers (WKWebView) routinely cut off
 * or re-fetch a streaming SSR response, and the half-received document fails to
 * parse. This is NOT in ignoreErrors, because WebKit uses the same wording for a
 * truncated *script* — a `_next/static/chunks/*.js` cut short by a bad deploy or
 * a proxy is our bug and must still report. beforeSendClient can tell them apart
 * by frame, so the drop lives there.
 */
const TRUNCATED_PARSE = /Unexpected EOF/;

export const DENY_URLS: RegExp[] = [
  /extensions\//i,
  /^chrome:\/\//i,
  /^chrome-extension:\/\//i,
  /^moz-extension:\/\//i,
  /^safari-(web-)?extension:\/\//i,
  // Injected by browser extensions, not part of any bundle we build.
  /\/inpage\.js/i,
  // Same wallet extension's service worker, and an injected fetch wrapper that
  // exists nowhere in this repo (`grep -rn frame_ant apps/web` finds nothing).
  /extensionServiceWorker\.js/i,
  /\/frame_ant\//i,
];

/** EIP-1193 provider errors — see the object-rejection branch in beforeSend. */
const EIP1193_CODES = new Set([4001, 4100, 4200, 4900, 4901, -32002, -32603]);

/**
 * Browser-transport failures: the request never got a response, so there is no
 * status, no CORS detail and no meaningful frame.
 *
 * The wording is NOT the browser's bare message. @sentry/core's fetch
 * instrumentation rewrites it before rethrowing — see
 * node_modules/@sentry/core/build/cjs/instrument/fetch.js, where
 * `enhanceFetchErrorMessages` defaults to `"always"` and appends ` (hostname)`.
 * Production proves it: LEARNHOUSE-WEB-6F/44 are `Failed to fetch
 * (api.learnhouse.io)` and 5Q is `Load failed (api.learnhouse.io)`. An
 * exact-anchored regex matched none of them, which made this whole rule dead
 * code. The suffix is optional because the rewrite is skipped when
 * `new URL(fetchData.url)` throws (a relative URL, e.g. the /signup fetches),
 * and the trailing period is the SDK's own Firefox wording.
 *
 * We keep the hostname rather than turning the enhancement off: it is the one
 * field that says WHICH endpoint died, and the fingerprint below — not the
 * message — controls grouping.
 *
 * Still anchored at both ends: an application error that merely *contains* one
 * of these phrases is not a transport failure and must report normally.
 */
const CLIENT_NETWORK_FAILURE =
  /^(?:Failed to fetch|Load failed|NetworkError when attempting to fetch resource)\.?(?: \([^\s()]+\))?$/;

/**
 * A route-shaped key for the fingerprint below.
 *
 * `event.transaction` is a raw pathname on this app, never a route template.
 * The Sentry Next.js SDK parameterizes by matching `window.location.pathname`
 * against the injected route manifest (client/routing/parameterization.js),
 * but our public URLs are subdomain-tenancy paths (`/course/<uuid>`) the proxy
 * rewrites to the real Next route (`/orgs/[orgslug]/course/[courseuuid]`, see
 * next.config.js) before Next ever sees them. The browser's pathname can
 * therefore never match a manifest entry. Live transactions look like
 * `/dash/courses/course/1bd40877-…/content` and `/course/<uuid>/activity/<uuid>`.
 *
 * Fingerprinting on that raw value would open one Sentry issue per UUID
 * visited — worst in the exact scenario the demotion exists for, where a wrong
 * NEXT_PUBLIC_LEARNHOUSE_API_URL makes every fetch on every route throw.
 * Collapse the identifiers, keep the route shape.
 */
const UUID_SEGMENT =
  /^(?:[a-z]+_)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function normalizeRouteKey(transaction: string | undefined): string {
  if (!transaction) return "unknown-route";
  const normalized = transaction
    .split("/")
    .map((segment) => {
      if (UUID_SEGMENT.test(segment)) return ":uuid";
      if (/^\d+$/.test(segment)) return ":id";
      return segment;
    })
    .join("/");
  return normalized || "unknown-route";
}

/**
 * Injected third-party code, judged by the frame that actually THREW.
 *
 * The old rule asked whether EVERY frame was an extension file, which can never
 * be true: Sentry's own browserApiErrors integration wraps setTimeout and
 * addEventListener, so it always contributes one outer frame from our bundle.
 * Frames arrive outermost-first, so the culprit is the last one.
 */
function isInjectedFilename(file: string): boolean {
  // Extension content scripts, by name.
  if (/(^|\/)(inpage|contentscript|content_script)\.js/i.test(file)) return true;
  // Code injected via eval/new Function carries a bare numeric pseudo-filename
  // ("303") instead of a path. Next.js production output has no eval'd modules,
  // and everything we ship resolves to `_next/static/chunks/<name>.js`.
  return /^\d+$/.test(file);
}

export const beforeSendClient: BeforeSend = (event, hint) => {
  const msg =
    (hint?.originalException as Error)?.message ??
    event?.exception?.values?.[0]?.value ??
    "";

  if (msg.includes("Failed to find Server Action")) return null;
  if (msg.includes("Organization not found")) return null;
  if (msg.includes("Organization has no config")) return null;

  const frames = event?.exception?.values?.[0]?.stacktrace?.frames ?? [];
  if (frames.length > 0 && isInjectedFilename(frames[frames.length - 1]?.filename ?? "")) {
    return null;
  }

  // Document-level parse failure only: one frame (the document itself,
  // `app:///signup:1`) and no reference to a bundle we build. A truncated chunk
  // carries a `_next/static/...` filename and falls through to be reported.
  if (
    TRUNCATED_PARSE.test(msg) &&
    frames.length <= 1 &&
    !/_next\/static/.test(frames[0]?.filename ?? "")
  ) {
    return null;
  }

  // Injected wallet/web3 extensions reject with a PLAIN OBJECT rather than an
  // Error, so the event arrives with no exception frames at all — denyUrls has
  // no filename to match and the frame check above has nothing to look at.
  // Identify it by shape instead: an EIP-1193 provider code, or a stack string
  // pointing at an extension origin. Neither can come from code we ship.
  const raw = hint?.originalException as any;
  if (raw && typeof raw === "object" && !(raw instanceof Error)) {
    if (typeof raw.code === "number" && EIP1193_CODES.has(raw.code)) return null;
    if (typeof raw.stack === "string" && /(chrome|moz|safari(-web)?)-extension:\/\//i.test(raw.stack)) {
      return null;
    }
  }

  // Client-side network failures are DEMOTED, not dropped. Dropping them would
  // also hide a genuine api.learnhouse.io outage from this project; keeping N
  // separate issues per browser wording buries the SSR errors that are real.
  //
  // The fingerprint carries the route shape as its second part, so the
  // collapsing is per-route, not global. That is the difference between
  // "Chrome and Safari word the same dead connection differently" (worth
  // merging) and "one endpoint broke" or "this deploy shipped a wrong
  // NEXT_PUBLIC_LEARNHOUSE_API_URL, so every fetch on every route throws"
  // (must not be merged into ambient noise — one broken route stays its own
  // issue, and a bad API URL fans out across routes as a visible spread of new
  // issues rather than one info-level bucket an alert rule filters out).
  // normalizeRouteKey is what keeps that spread bounded by ROUTE rather than by
  // course/activity UUID — see its comment.
  if (CLIENT_NETWORK_FAILURE.test(msg)) {
    event.level = "info";
    event.fingerprint = ["client-network-failure", normalizeRouteKey(event.transaction)];
  }

  return event;
};

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    tunnel: '/monitoring',
    environment: LEARNHOUSE_ENV,
    sendDefaultPii: true,
    enableLogs: true,
    tracesSampleRate: LEARNHOUSE_ENV === "dev" ? 1.0 : 0.1,
    replaysSessionSampleRate: 0.0,
    replaysOnErrorSampleRate: 0.1,
    integrations: [
      Sentry.replayIntegration(),
    ],
    ignoreErrors: IGNORE_ERRORS,
    denyUrls: DENY_URLS,
    beforeSend: beforeSendClient,
  });
}
