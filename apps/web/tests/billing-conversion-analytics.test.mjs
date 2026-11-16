// Paid conversion reaches PostHog from the server (the Stripe webhook): keyed
// on the organization, no personal data, and never failing its caller.
import { afterEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));
const { captureOrgEvent, captureConversion } = await import("../services/analytics/serverCapture.ts");

const realFetch = globalThis.fetch;
let calls = [];
afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
  calls = [];
});
const fakeFetch = (ok = true) => {
  globalThis.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return { ok };
  };
};

describe("server-side conversion events", () => {
  test("no key: nothing is sent", async () => {
    fakeFetch();
    expect(await captureOrgEvent("x", 1)).toBe(false);
    expect(calls.length).toBe(0);
  });

  test("an org-keyed event without personal data", async () => {
    process.env.NEXT_PUBLIC_POSTHOG_KEY = "phc_test";
    fakeFetch();
    expect(await captureOrgEvent("plan_subscription_activated", 42, { plan: "pro" })).toBe(true);
    const { url, body } = calls[0];
    expect(url).toBe("https://eu.i.posthog.com/i/v0/e/");
    expect(body.distinct_id).toBe("org_42");
    expect(body.properties.$groups).toEqual({ organization: "42" });
    expect(body.properties.$process_person_profile).toBe(false);
    expect(JSON.stringify(body)).not.toMatch(/@/);
  });

  test("a trial conversion sends both events", async () => {
    process.env.NEXT_PUBLIC_POSTHOG_KEY = "phc_test";
    fakeFetch();
    const sub = { items: { data: [{ price: { recurring: { interval: "year" } } }] } };
    await captureConversion("7", "pro", sub, { trial_converted: true, org_age_days: 12 });
    expect(calls.map((c) => c.body.event)).toEqual(["plan_subscription_activated", "trial_converted"]);
    expect(calls[0].body.properties).toMatchObject({ plan: "pro", interval: "year", days_since_org_creation: 12, was_trial: true });
    calls = [];
    await captureConversion("7", "standard", {}, { ok: true });
    expect(calls.map((c) => c.body.event)).toEqual(["plan_subscription_activated"]);
    expect(calls[0].body.properties).toMatchObject({ interval: null, days_since_org_creation: null, was_trial: false });
  });

  test("a network failure never throws", async () => {
    process.env.NEXT_PUBLIC_POSTHOG_KEY = "phc_test";
    globalThis.fetch = async () => { throw new Error("offline"); };
    expect(await captureOrgEvent("x", 1)).toBe(false);
  });
});
