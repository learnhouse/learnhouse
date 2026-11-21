// Behaviour tests for the Stripe webhook receiver.
//
// Each case here corresponds to a way a paid checkout has previously failed to
// upgrade an org: an event type that stopped being handled, a subscription that
// Stripe had not materialized yet, or a retry answered "duplicate" after the
// first delivery failed. All of them ack'd with a 200, so Stripe considered the
// upgrade delivered and never retried.
//
// All fixtures are synthetic.

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

// --- test doubles -----------------------------------------------------------

const planWrites = [];
const packCalls = [];
let planWriteError = null;
let packDeactivateError = null;
// Live subscription state by id (what stripe.subscriptions.retrieve returns);
// falls back to the event's own object when a test doesn't set one.
let liveSubscriptions = {};
// What findOrgEntitledPlanSubscription returns, and the calls it received.
let otherEntitledSub = null;
const entitledLookups = [];
let sessionRetrieveQueue = [];
let sessionRetrieveCalls = 0;
let signatureValid = true;

mock.module("next/headers", () => ({
  headers: async () => new Map([["stripe-signature", "sig_test"]]),
}));

mock.module("@services/billing/orgPlan", () => ({
  updateOrganizationConfigInternally: async (orgId, plan) => {
    if (planWriteError) throw planWriteError;
    planWrites.push({ orgId, plan });
    return { ok: true };
  },
}));

mock.module("@services/billing/packs", () => ({
  activatePackInternally: async (orgId, packId, subId) => {
    packCalls.push({ op: "activate", orgId, subId });
    return {};
  },
  deactivatePackInternally: async (orgId, subId) => {
    if (packDeactivateError) throw packDeactivateError;
    packCalls.push({ op: "deactivate", orgId, subId });
    return {};
  },
  deactivateAllPacksInternally: async (orgId) => {
    packCalls.push({ op: "deactivate-all", orgId });
    return {};
  },
  markPackCancelingInternally: async (orgId, subId) => {
    packCalls.push({ op: "mark-canceling", orgId, subId });
    return {};
  },
}));

mock.module("@services/billing/activeUserBilling", () => ({
  billOverageForInvoice: async () => ({}),
}));

mock.module("@services/billing/emails", () => ({
  sendPurchaseCompleteMail: async () => ({}),
  sendPackActivatedMail: async () => ({}),
  sendPaymentFailedMail: async () => ({}),
}));

// The route derives the plan from the price id via planForPriceId; map one
// invented price to `pro` so resolution succeeds without touching real env.
// stripeClient is the shared lazy SDK client the route uses.
let currentEvent = null;
mock.module("@services/billing/stripe", () => ({
  planForPriceId: async (priceId) =>
    priceId === "price_test_pro" ? { plan: "pro", isPack: false } : undefined,
  getStripeSecretKey: () => "sk_test_stub",
  findOrgEntitledPlanSubscription: async (orgId, opts) => {
    entitledLookups.push({ orgId, ...opts });
    return otherEntitledSub;
  },
  stripeClient: {
    subscriptions: {
      retrieve: async (id) => liveSubscriptions[id] ?? currentEvent?.data?.object,
    },
    webhooks: {
      constructEvent: () => {
        if (!signatureValid) throw new Error("No signatures found matching the expected signature");
        return currentEvent;
      },
    },
    checkout: {
      sessions: {
        retrieve: async () => {
          sessionRetrieveCalls += 1;
          return sessionRetrieveQueue.shift() ?? { customer_details: {}, subscription: null };
        },
      },
    },
    customers: { retrieve: async () => ({ email: "billing@example.test" }) },
  },
}));

const { POST } = await import("../app/api/billing/webhook/route.ts");

// --- helpers ----------------------------------------------------------------

let eventCounter = 0;
function nextEventId() {
  eventCounter += 1;
  return `evt_test_${eventCounter}`;
}

function subscriptionFixture(overrides = {}) {
  return {
    id: "sub_test",
    status: "active",
    cancel_at_period_end: false,
    metadata: { org_id: "4242", plan: "pro", billing: "monthly" },
    items: { data: [{ price: { id: "price_test_pro" } }] },
    ...overrides,
  };
}

async function deliver(event) {
  currentEvent = event;
  return POST(new Request("https://example.test/api/billing/webhook", { method: "POST", body: "{}" }));
}

beforeEach(() => {
  planWrites.length = 0;
  packCalls.length = 0;
  planWriteError = null;
  packDeactivateError = null;
  liveSubscriptions = {};
  otherEntitledSub = null;
  entitledLookups.length = 0;
  sessionRetrieveQueue = [];
  sessionRetrieveCalls = 0;
  signatureValid = true;
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
});

afterEach(() => {
  currentEvent = null;
});

// --- tests ------------------------------------------------------------------

describe("signature verification", () => {
  test("an unsigned or mis-signed payload is rejected without touching the plan", async () => {
    signatureValid = false;
    const res = await deliver({ id: nextEventId(), type: "checkout.session.completed" });
    expect(res.status).toBe(400);
    expect(planWrites).toHaveLength(0);
  });
});

describe("checkout.session.completed", () => {
  test("upgrades the org when the subscription is present", async () => {
    sessionRetrieveQueue = [{ customer_details: {}, subscription: subscriptionFixture() }];
    const res = await deliver({
      id: nextEventId(),
      type: "checkout.session.completed",
      data: { object: { id: "cs_test", payment_status: "paid" } },
    });
    expect(res.status).toBe(200);
    expect(planWrites).toEqual([{ orgId: "4242", plan: "pro" }]);
  });

  test("retries a briefly-deferred subscription instead of dropping the upgrade", async () => {
    // Stripe's basil API defers subscription creation until payment completes,
    // so the expanded subscription is legitimately null on the first read.
    sessionRetrieveQueue = [
      { customer_details: {}, subscription: null },
      { customer_details: {}, subscription: subscriptionFixture() },
    ];
    const res = await deliver({
      id: nextEventId(),
      type: "checkout.session.completed",
      data: { object: { id: "cs_test", payment_status: "paid" } },
    });
    expect(res.status).toBe(200);
    expect(sessionRetrieveCalls).toBeGreaterThan(1);
    expect(planWrites).toEqual([{ orgId: "4242", plan: "pro" }]);
  });

  test("asks Stripe to redeliver when the subscription never materializes", async () => {
    sessionRetrieveQueue = [];
    const res = await deliver({
      id: nextEventId(),
      type: "checkout.session.completed",
      data: { object: { id: "cs_test", payment_status: "paid" } },
    });
    // A 200 here would end Stripe's retries and strand a paid org on free.
    expect(res.status).toBe(500);
    expect(planWrites).toHaveLength(0);
  });

  test("asks Stripe to redeliver when the price maps to no known plan", async () => {
    // This is a missing STRIPE_PRICE_* env, not a foreign checkout: the
    // session carries our org_id, so the upgrade is owed.
    sessionRetrieveQueue = [
      {
        customer_details: {},
        subscription: subscriptionFixture({
          metadata: { org_id: "4242" },
          items: { data: [{ price: { id: "price_unmapped" } }] },
        }),
      },
    ];
    const res = await deliver({
      id: nextEventId(),
      type: "checkout.session.completed",
      data: { object: { id: "cs_test", payment_status: "paid" } },
    });
    expect(res.status).toBe(500);
    expect(planWrites).toHaveLength(0);
  });

  test("acks a foreign checkout carrying no org_id", async () => {
    // This Stripe account is shared with other products, whose checkouts land
    // here too. Retrying them forever would eventually disable the endpoint.
    sessionRetrieveQueue = [
      { customer_details: {}, subscription: subscriptionFixture({ metadata: { label: "other-product" } }) },
    ];
    const res = await deliver({
      id: nextEventId(),
      type: "checkout.session.completed",
      data: { object: { id: "cs_test", payment_status: "paid" } },
    });
    expect(res.status).toBe(200);
    expect(planWrites).toHaveLength(0);
  });
});

describe("customer.subscription.created", () => {
  test("upgrades the org: it is the recovery path when checkout.session.completed is dropped", async () => {
    const res = await deliver({
      id: nextEventId(),
      type: "customer.subscription.created",
      data: { object: subscriptionFixture() },
    });
    expect(res.status).toBe(200);
    expect(planWrites).toEqual([{ orgId: "4242", plan: "pro" }]);
  });
});

describe("customer.subscription.updated / deleted", () => {
  test("an active subscription reconciles to the price's plan", async () => {
    const res = await deliver({
      id: nextEventId(),
      type: "customer.subscription.updated",
      data: { object: subscriptionFixture() },
    });
    expect(res.status).toBe(200);
    expect(planWrites).toEqual([{ orgId: "4242", plan: "pro" }]);
  });

  test("deletion downgrades to free", async () => {
    const res = await deliver({
      id: nextEventId(),
      type: "customer.subscription.deleted",
      data: { object: subscriptionFixture() },
    });
    expect(res.status).toBe(200);
    expect(planWrites).toEqual([{ orgId: "4242", plan: "free" }]);
  });
});

describe("idempotency", () => {
  test("a redelivery of a successful event is not applied twice", async () => {
    const event = {
      id: nextEventId(),
      type: "customer.subscription.created",
      data: { object: subscriptionFixture() },
    };
    await deliver(event);
    const res = await deliver(event);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ result: "duplicate" });
    expect(planWrites).toHaveLength(1);
  });

  test("a redelivery after a FAILED delivery is reprocessed, not called a duplicate", async () => {
    // The failure mode this pins: marking an event before processing, without
    // clearing it on failure, made Stripe's retry return a "duplicate" 200 and
    // permanently drop the upgrade.
    const event = {
      id: nextEventId(),
      type: "checkout.session.completed",
      data: { object: { id: "cs_test", payment_status: "paid" } },
    };
    sessionRetrieveQueue = [];
    const first = await deliver(event);
    expect(first.status).toBe(500);

    sessionRetrieveQueue = [{ customer_details: {}, subscription: subscriptionFixture() }];
    const second = await deliver(event);
    expect(second.status).toBe(200);
    expect(planWrites).toEqual([{ orgId: "4242", plan: "pro" }]);
  });
});

// --- org deleted before its subscriptions are cancelled ----------------------

const orgGone = () => Object.assign(new Error("Organization 4242 not found"), { code: "org_not_found" });

describe("an org that no longer exists", () => {
  test("its subscription deletion is acked, not retried for days", async () => {
    // delete-org removes the org first, then cancels: the plan write 404s.
    planWriteError = orgGone();
    const res = await deliver({
      id: nextEventId(),
      type: "customer.subscription.deleted",
      data: { object: subscriptionFixture({ status: "canceled" }) },
    });
    expect(res.status).toBe(200);
    expect(packCalls).toHaveLength(0);
  });

  test("a checkout completing for it is acked", async () => {
    planWriteError = orgGone();
    sessionRetrieveQueue = [{ customer_details: {}, subscription: subscriptionFixture() }];
    const res = await deliver({
      id: nextEventId(),
      type: "checkout.session.completed",
      data: { object: { id: "cs_test", payment_status: "paid" } },
    });
    expect(res.status).toBe(200);
  });

  test("any other plan-write failure still asks Stripe to retry", async () => {
    planWriteError = new Error("Failed to update org plan: 502 Bad Gateway");
    const res = await deliver({
      id: nextEventId(),
      type: "customer.subscription.deleted",
      data: { object: subscriptionFixture({ status: "canceled" }) },
    });
    expect(res.status).toBe(500);
  });

  test("a deleted pack whose row went with the org is acked", async () => {
    packDeactivateError = new Error("No pack found for this subscription");
    const res = await deliver({
      id: nextEventId(),
      type: "customer.subscription.deleted",
      data: {
        object: subscriptionFixture({
          id: "sub_pack",
          status: "canceled",
          metadata: { org_id: "4242", type: "pack", pack_id: "ai_500" },
        }),
      },
    });
    expect(res.status).toBe(200);
  });

  test("other pack deactivation failures still retry", async () => {
    packDeactivateError = new Error("Failed to deactivate pack");
    const res = await deliver({
      id: nextEventId(),
      type: "customer.subscription.deleted",
      data: {
        object: subscriptionFixture({
          id: "sub_pack",
          status: "canceled",
          metadata: { org_id: "4242", type: "pack", pack_id: "ai_500" },
        }),
      },
    });
    expect(res.status).toBe(500);
  });
});

describe("deletion with another live subscription", () => {
  test("keeps the plan the org is still paying for", async () => {
    otherEntitledSub = subscriptionFixture({ id: "sub_other" });
    const res = await deliver({
      id: nextEventId(),
      type: "customer.subscription.deleted",
      data: { object: subscriptionFixture({ status: "canceled", customer: "cus_test" }) },
    });
    expect(res.status).toBe(200);
    expect(planWrites).toEqual([{ orgId: "4242", plan: "pro" }]);
    expect(entitledLookups).toEqual([{ orgId: "4242", excludeId: "sub_test", customerId: "cus_test" }]);
    expect(packCalls).toHaveLength(0);
  });

  test("with none left, downgrades to free and drops its packs", async () => {
    const res = await deliver({
      id: nextEventId(),
      type: "customer.subscription.deleted",
      data: { object: subscriptionFixture({ status: "canceled", customer: { id: "cus_obj" } }) },
    });
    expect(res.status).toBe(200);
    expect(planWrites).toEqual([{ orgId: "4242", plan: "free" }]);
    expect(entitledLookups[0].customerId).toBe("cus_obj");
    expect(packCalls).toEqual([{ op: "deactivate-all", orgId: "4242" }]);
  });

  test("another live subscription whose price maps to no plan writes nothing", async () => {
    otherEntitledSub = subscriptionFixture({
      id: "sub_other",
      metadata: { org_id: "4242" },
      items: { data: [{ price: { id: "price_unmapped" } }] },
    });
    const res = await deliver({
      id: nextEventId(),
      type: "customer.subscription.deleted",
      data: { object: subscriptionFixture({ status: "canceled" }) },
    });
    expect(res.status).toBe(200);
    expect(planWrites).toHaveLength(0);
  });
});

describe("events are decided from the live subscription", () => {
  test("a stale 'active' update arriving after deletion doesn't grant the plan back", async () => {
    liveSubscriptions = { sub_test: subscriptionFixture({ status: "canceled" }) };
    const res = await deliver({
      id: nextEventId(),
      type: "customer.subscription.updated",
      data: { object: subscriptionFixture({ status: "active" }) },
    });
    expect(res.status).toBe(200);
    expect(planWrites).toEqual([{ orgId: "4242", plan: "free" }]);
  });

  test("a stale 'past_due' update for a subscription that is active again reapplies the plan", async () => {
    liveSubscriptions = { sub_test: subscriptionFixture({ status: "active" }) };
    const res = await deliver({
      id: nextEventId(),
      type: "customer.subscription.updated",
      data: { object: subscriptionFixture({ status: "past_due" }) },
    });
    expect(res.status).toBe(200);
    expect(planWrites).toEqual([{ orgId: "4242", plan: "pro" }]);
  });

  test("a stale pack update after the pack was deleted changes nothing", async () => {
    const pack = { status: "active", metadata: { org_id: "4242", type: "pack", pack_id: "ai_500" } };
    liveSubscriptions = { sub_pack: subscriptionFixture({ ...pack, id: "sub_pack", status: "canceled" }) };
    const res = await deliver({
      id: nextEventId(),
      type: "customer.subscription.updated",
      data: { object: subscriptionFixture({ ...pack, id: "sub_pack" }) },
    });
    expect(res.status).toBe(200);
    expect(packCalls).toHaveLength(0);
  });

  test("a checkout redelivered after the subscription ended grants nothing", async () => {
    sessionRetrieveQueue = [{ customer_details: {}, subscription: subscriptionFixture({ status: "canceled" }) }];
    const res = await deliver({
      id: nextEventId(),
      type: "checkout.session.completed",
      data: { object: { id: "cs_test", payment_status: "paid" } },
    });
    expect(res.status).toBe(200);
    expect(planWrites).toHaveLength(0);
  });
});

describe("failed payments", () => {
  test("unpaid (Stripe stopped retrying) downgrades to free but keeps packs", async () => {
    const res = await deliver({
      id: nextEventId(),
      type: "customer.subscription.updated",
      data: { object: subscriptionFixture({ status: "unpaid" }) },
    });
    expect(res.status).toBe(200);
    expect(planWrites).toEqual([{ orgId: "4242", plan: "free" }]);
    expect(packCalls).toHaveLength(0);
  });

  test("past_due keeps the plan as a grace period", async () => {
    const res = await deliver({
      id: nextEventId(),
      type: "customer.subscription.updated",
      data: { object: subscriptionFixture({ status: "past_due" }) },
    });
    expect(res.status).toBe(200);
    expect(planWrites).toHaveLength(0);
  });

  test("an expired first payment never granted a plan, so it takes none away", async () => {
    // A "free" write here would end the org's running trial.
    const res = await deliver({
      id: nextEventId(),
      type: "customer.subscription.deleted",
      data: { object: subscriptionFixture({ status: "incomplete_expired" }) },
    });
    expect(res.status).toBe(200);
    expect(planWrites).toHaveLength(0);
    expect(entitledLookups).toHaveLength(0);
  });
});
