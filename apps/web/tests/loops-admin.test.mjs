// Behaviour tests for the marketing audience route (app/api/loops/admin).
//
// The caller's own contact gets only the onboarding properties: anything else
// in the body (the contact's group, subscription, campaign targeting
// properties) is dropped. All fixtures are synthetic.

import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

let session = { user: { email: "admin@example.test", first_name: "Ada", last_name: "L" } };
const updates = [];
const admins = [];

mock.module("@lib/saas", () => ({
  isSaaSMode: async () => true,
}));

mock.module("@lib/auth/server", () => ({
  getServerSession: async () => session,
}));

mock.module("@services/emails/loops", () => ({
  recordOrgAdminInLoops: async (email, extra) => {
    admins.push({ email, extra });
    return {};
  },
  updateLoopsContact: async (email, props) => {
    updates.push({ email, props });
    return {};
  },
}));

const { POST } = await import("../app/api/loops/admin/route.ts");

function post(body) {
  return POST(
    new Request("https://example.test/api/loops/admin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  updates.length = 0;
  admins.length = 0;
  session = { user: { email: "admin@example.test", first_name: "Ada", last_name: "L" } };
});

describe("loops admin route", () => {
  test("writes the onboarding properties to the session's contact", async () => {
    const res = await post({ orgSlug: "acme", onboarding: { use_cases: "teacher", onboarding_completed: true } });
    expect(res.status).toBe(200);
    expect(updates).toEqual([
      { email: "admin@example.test", props: { use_cases: "teacher", onboarding_completed: true } },
    ]);
  });

  test("drops every other contact property", async () => {
    await post({
      onboarding: {
        legacyPlan: "pro",
        userGroup: "customers",
        subscribed: false,
        mailingLists: "x",
        chosen_plans: "pro",
      },
    });
    expect(updates).toEqual([{ email: "admin@example.test", props: { chosen_plans: "pro" } }]);
  });

  test("nothing allowed means no update call", async () => {
    await post({ onboarding: { legacyPlan: "pro", personal_goals: { nested: true } } });
    expect(updates).toEqual([]);
  });

  test("refuses callers without a session", async () => {
    session = null;
    const res = await post({ onboarding: { use_cases: "teacher" } });
    expect(res.status).toBe(401);
    expect(updates).toEqual([]);
  });
});
