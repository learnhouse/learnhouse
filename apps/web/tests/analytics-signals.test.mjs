// Org analytics collection: the batching transport that posts to
// /signals/batch, and the pure rules deciding what gets tracked.

import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

let deploymentMode = "saas";
mock.module("@services/config/config", () => ({
  getAPIUrl: () => "http://api.test/api/v1/",
  getDeploymentMode: () => deploymentMode,
}));

// A minimal browser: the transport only touches these.
const listeners = {};
const storage = new Map();
const fakeDocument = {
  visibilityState: "visible",
  prerendering: false,
  addEventListener: (type, fn) => {
    listeners[`document:${type}`] = fn;
  },
};
const fakeWindow = {
  addEventListener: (type, fn) => {
    listeners[`window:${type}`] = fn;
  },
  sessionStorage: {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
  },
};
const realWindow = globalThis.window;
const realDocument = globalThis.document;
const realFetch = globalThis.fetch;
globalThis.window = fakeWindow;
globalThis.document = fakeDocument;

const calls = [];
globalThis.fetch = (url, init) => {
  calls.push({ url: String(url), init, body: JSON.parse(init.body) });
  return Promise.resolve(new Response(null, { status: 202 }));
};

afterAll(() => {
  globalThis.window = realWindow;
  globalThis.document = realDocument;
  globalThis.fetch = realFetch;
});

const { trackEvent, flushAnalytics, getSessionId } = await import("../services/analytics/analytics.ts");
const { isTrackedPagePath, reachedMilestones, createMilestoneTracker } = await import("../services/analytics/rules.ts");

beforeEach(() => {
  flushAnalytics();
  calls.length = 0;
  fakeDocument.prerendering = false;
  fakeDocument.visibilityState = "visible";
  deploymentMode = "saas";
});

describe("signals transport", () => {
  test("sends nothing on an OSS deployment, which has no signals endpoint", () => {
    deploymentMode = "oss";
    for (let i = 0; i < 25; i++) trackEvent("page_view", 7, { path: "/courses" });
    flushAnalytics();
    expect(calls).toHaveLength(0);
  });

  test("sends on EE as well as SaaS", () => {
    deploymentMode = "ee";
    trackEvent("page_view", 7, { path: "/courses" });
    flushAnalytics();
    expect(calls).toHaveLength(1);
  });

  test("batches queued events into one request to the neutral endpoint", () => {
    trackEvent("page_view", 7, { path: "/courses" });
    trackEvent("course_view", 7, { course_uuid: "course_1" });
    expect(calls).toHaveLength(0);
    flushAnalytics();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://api.test/api/v1/signals/batch");
    expect(calls[0].init.keepalive).toBe(true);
    expect(calls[0].body).toEqual({
      org_id: 7,
      session_id: getSessionId(),
      events: [
        { name: "page_view", props: { path: "/courses" } },
        { name: "course_view", props: { course_uuid: "course_1" } },
      ],
    });
  });

  test("anonymous batches carry no Authorization header; signed-in ones do", () => {
    trackEvent("page_view", 7, {});
    trackEvent("time_on_activity", 7, { seconds_spent: 3 }, "tok");
    flushAnalytics();
    expect(calls).toHaveLength(2);
    const anon = calls.find((c) => c.body.events[0].name === "page_view");
    const authed = calls.find((c) => c.body.events[0].name === "time_on_activity");
    expect(anon.init.headers.Authorization).toBeUndefined();
    expect(authed.init.headers.Authorization).toBe("Bearer tok");
  });

  test("flushes on its own once 20 events are queued", () => {
    for (let i = 0; i < 19; i++) trackEvent("page_view", 7, { path: `/p${i}` });
    expect(calls).toHaveLength(0);
    trackEvent("page_view", 7, { path: "/p19" });
    expect(calls).toHaveLength(1);
    expect(calls[0].body.events).toHaveLength(20);
  });

  test("splits a batch that would go over the keepalive size budget", () => {
    const big = "x".repeat(20_000);
    for (let i = 0; i < 6; i++) trackEvent("search_query", 7, { query: big });
    flushAnalytics();
    expect(calls.length).toBeGreaterThan(1);
    for (const call of calls) expect(call.init.body.length).toBeLessThanOrEqual(60_000);
    expect(calls.reduce((n, c) => n + c.body.events.length, 0)).toBe(6);
  });

  test("keeps events while the page is prerendering", () => {
    fakeDocument.prerendering = true;
    trackEvent("page_view", 7, { path: "/" });
    flushAnalytics();
    expect(calls).toHaveLength(0);
    fakeDocument.prerendering = false;
    flushAnalytics();
    expect(calls).toHaveLength(1);
  });

  test("sends what is queued when the page is hidden", () => {
    trackEvent("page_view", 7, { path: "/" });
    fakeDocument.visibilityState = "hidden";
    listeners["document:visibilitychange"]();
    expect(calls).toHaveLength(1);
    trackEvent("page_view", 7, { path: "/next" });
    listeners["window:pagehide"]();
    expect(calls).toHaveLength(2);
  });

  test("ignores events without an org and never throws", () => {
    trackEvent("page_view", 0, {});
    trackEvent("page_view", undefined, {});
    flushAnalytics();
    expect(calls).toHaveLength(0);
    globalThis.fetch = () => {
      throw new Error("offline");
    };
    try {
      trackEvent("page_view", 7, {});
      expect(() => flushAnalytics()).not.toThrow();
    } finally {
      globalThis.fetch = (url, init) => {
        calls.push({ url: String(url), init, body: JSON.parse(init.body) });
        return Promise.resolve(new Response(null, { status: 202 }));
      };
    }
  });

  test("session id survives in sessionStorage, or in memory when storage is blocked", () => {
    const id = getSessionId();
    expect(id).toBeTruthy();
    expect(getSessionId()).toBe(id);
    const storageBackup = fakeWindow.sessionStorage;
    fakeWindow.sessionStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    try {
      const fallback = getSessionId();
      expect(fallback).toBeTruthy();
      expect(getSessionId()).toBe(fallback);
    } finally {
      fakeWindow.sessionStorage = storageBackup;
    }
  });
});

describe("isTrackedPagePath", () => {
  test("public pages count as traffic", () => {
    for (const p of ["/", "/courses", "/course/abc", "/course/abc/activity/def", "/search", "/dashing-course"]) {
      expect(isTrackedPagePath(p)).toBe(true);
    }
  });

  test("dashboard, editor and super-admin pages don't", () => {
    for (const p of ["/dash", "/dash/courses", "/orgs/acme/dash/analytics", "/editor/course/x/activity/y/edit", "/admin", "/admin/orgs"]) {
      expect(isTrackedPagePath(p)).toBe(false);
    }
  });
});

describe("reachedMilestones", () => {
  test("reports each milestone crossed, once", () => {
    expect(reachedMilestones(10, 100, new Set())).toEqual([]);
    expect(reachedMilestones(26, 100, new Set())).toEqual([25]);
    expect(reachedMilestones(80, 100, new Set([25]))).toEqual([50, 75]);
    expect(reachedMilestones(80, 100, new Set([25, 50, 75]))).toEqual([]);
  });

  test("the last second counts as finished", () => {
    expect(reachedMilestones(99.5, 100, new Set([25, 50, 75]))).toEqual([100]);
    expect(reachedMilestones(1194, 1200, new Set([25, 50, 75]))).toEqual([100]);
  });

  test("ignores players that don't know the duration yet", () => {
    expect(reachedMilestones(5, NaN, new Set())).toEqual([]);
    expect(reachedMilestones(5, 0, new Set())).toEqual([]);
    expect(reachedMilestones(5, Infinity, new Set())).toEqual([]);
  });
});

describe("createMilestoneTracker", () => {
  test("reports each milestone once per item", () => {
    const tracker = createMilestoneTracker();
    expect(tracker.reached("ep_1", 30, 100)).toEqual([25]);
    expect(tracker.reached("ep_1", 31, 100)).toEqual([]);
    expect(tracker.reached("ep_1", 80, 100)).toEqual([50, 75]);
    // Seeking back and playing again doesn't recount.
    expect(tracker.reached("ep_1", 30, 100)).toEqual([]);
    expect(tracker.reached("ep_1", 100, 100)).toEqual([100]);
    expect(tracker.reached("ep_1", 100, 100)).toEqual([]);
  });

  test("keeps items apart", () => {
    const tracker = createMilestoneTracker();
    expect(tracker.reached("ep_1", 60, 100)).toEqual([25, 50]);
    expect(tracker.reached("ep_2", 60, 100)).toEqual([25, 50]);
    expect(tracker.reached("ep_2", 0, 100)).toEqual([]);
  });

  test("waits for a known duration", () => {
    const tracker = createMilestoneTracker();
    expect(tracker.reached("ep_1", 30, 0)).toEqual([]);
    expect(tracker.reached("ep_1", 30, NaN)).toEqual([]);
    expect(tracker.reached("ep_1", 30, 100)).toEqual([25]);
  });
});
