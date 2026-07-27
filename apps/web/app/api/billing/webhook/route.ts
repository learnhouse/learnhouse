// Stripe webhook receiver (server-only).
//
// Faithful port of the platform repo's app/api/payments/route.ts. The webhook
// self-authenticates by verifying the Stripe signature against
// STRIPE_WEBHOOK_SECRET, so it does NOT call assertSaaSBilling() — an
// unconfigured deployment simply has no STRIPE_WEBHOOK_SECRET and every event
// fails signature verification with a 400.
import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { updateOrganizationConfigInternally } from "@services/billing/orgPlan";
import {
  activatePackInternally,
  deactivatePackInternally,
  deactivateAllPacksInternally,
  markPackCancelingInternally,
} from "@services/billing/packs";
import { planForPriceId, stripeClient as stripe } from "@services/billing/stripe";
import { billOverageForInvoice } from "@services/billing/activeUserBilling";
import {
  sendPurchaseCompleteMail,
  sendPackActivatedMail,
  sendPaymentFailedMail,
} from "@services/billing/emails";

// Derive an org's plan from the subscription's PRICE id (source of truth),
// falling back to metadata.plan only when the price isn't recognized. Stripe
// billing-portal plan changes update the price but NOT metadata.plan, so relying
// on metadata alone would reconcile the org to the stale (old) plan.
async function planFromSubscription(subscription: any): Promise<string | undefined> {
  const derived = await planForPriceId(subscription?.items?.data?.[0]?.price?.id);
  if (derived && !derived.isPack) return derived.plan;
  return subscription?.metadata?.plan ?? undefined;
}

// Simple in-memory idempotency cache (event_id -> {state, ts}).
// Stripe retries webhooks, so we skip events we've already processed.
// TTL: 5 minutes — Stripe won't retry faster than that.
// NOTE: in-memory, so it does NOT dedupe across serverless instances; the
// downstream service calls are all idempotent, which covers the gap.
//
// The state matters. Marking an event before processing is what blocks a
// concurrent duplicate delivery, but a bare mark also swallows retries: an
// event whose handler failed — or whose process died before it could unmark —
// would answer the retry with a "duplicate" 200 and permanently drop the
// upgrade. So only a `done` entry is a real duplicate. An `in-flight` entry
// means another delivery is still working on it and may yet fail, so we ask
// Stripe to come back rather than acking on its behalf.
type EventState = "in-flight" | "done";
const processedEvents = new Map<string, { state: EventState; ts: number }>();
const IDEMPOTENCY_TTL_MS = 5 * 60 * 1000;

function cleanupProcessedEvents() {
  const cutoff = Date.now() - IDEMPOTENCY_TTL_MS;
  for (const [id, entry] of Array.from(processedEvents)) {
    if (entry.ts < cutoff) processedEvents.delete(id);
  }
}

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  let event: any;
  try {
    const body = await request.text();
    const headersList = await headers();
    const signature = headersList.get("stripe-signature");
    event = stripe.webhooks.constructEvent(body, signature, secret);
  } catch (err: any) {
    console.error("Webhook signature verification failed:", err.message);
    return NextResponse.json({ message: "Invalid signature", ok: false }, { status: 400 });
  }

  // Idempotency check — skip events already handled successfully
  cleanupProcessedEvents();
  const seen = processedEvents.get(event.id);
  if (seen?.state === "done") {
    return NextResponse.json({ result: "duplicate", ok: true });
  }
  if (seen?.state === "in-flight") {
    // Another delivery of this event is mid-flight. Don't ack for it — if it
    // fails, this 500 is what keeps Stripe retrying.
    return NextResponse.json({ message: "event in flight", ok: false }, { status: 409 });
  }
  processedEvents.set(event.id, { state: "in-flight", ts: Date.now() });

  try {
    if (event.type === "checkout.session.completed") {
      await handleCheckoutCompleted(event.data.object);
    }

    // Treat `created` like an `updated`: it's the natural recovery event that
    // also carries subscription_data.metadata.org_id, so if checkout.session
    // .completed was dropped, this still upgrades the org.
    if (
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted" ||
      event.type === "customer.subscription.created"
    ) {
      await handleSubscriptionEvent(event.type, event.data.object);
    }

    // Add last month's active-user overage as a line on the draft renewal
    // invoice before Stripe finalizes it (fires ~1h before finalization).
    if (event.type === "invoice.created") {
      await billOverageForInvoice(event.data.object);
    }

    // Promote to `done` only after successful handling, so a retry of a failed
    // event is never mistaken for a duplicate of a successful one.
    processedEvents.set(event.id, { state: "done", ts: Date.now() });
    return NextResponse.json({ result: event.type, ok: true });
  } catch (error) {
    console.error(`Webhook processing error for ${event.type} (${event.id}):`, error);
    // Drop the in-flight mark so Stripe's retry is reprocessed rather than
    // answered "duplicate". Downstream service calls are idempotent, so a
    // re-apply is harmless.
    processedEvents.delete(event.id);
    // Return 500 so Stripe retries the webhook
    return NextResponse.json(
      { message: "webhook processing failed", ok: false },
      { status: 500 }
    );
  }
}

async function handleCheckoutCompleted(session: any) {
  if (session.payment_status !== "paid") return;

  // Retrieve the session with the subscription expanded to read its metadata.
  // Stripe's basil API (2025-03-31) defers subscription creation until payment
  // completes, so the expanded `subscription` can briefly be null right after
  // checkout — the same race fulfillCheckoutSession() guards against. Retry so a
  // deferred subscription doesn't silently drop the upgrade.
  let fullSession: any;
  let subscription: any;
  for (let attempt = 0; attempt < 3; attempt++) {
    fullSession = await stripe.checkout.sessions.retrieve(session.id, {
      expand: ["subscription"],
    });
    subscription = fullSession.subscription;
    // Break as soon as the subscription exists: the race is about Stripe not
    // having materialized it yet, not about its metadata. Retrying until
    // org_id appears would also retry every foreign checkout on this shared
    // account three times before acking it.
    if (subscription) break;
    if (attempt < 2) await new Promise((r) => setTimeout(r, 1000));
  }
  const customerEmail = fullSession.customer_details?.email || session.customer_email;

  if (!subscription) {
    // Subscription still not materialized after retries — transient. Throw so
    // Stripe redelivers (and customer.subscription.created will also cover it),
    // rather than acking with a 200 that permanently drops the upgrade.
    throw new Error(
      `checkout.session.completed: subscription not yet available for session ${session.id}`,
    );
  }

  const orgId = subscription.metadata?.org_id;
  if (!orgId) {
    // A checkout not created by our flow carries no org linkage — nothing we can
    // do; ack so Stripe doesn't retry it forever and disable the endpoint. This
    // endpoint shares a Stripe account with other products, so foreign checkouts
    // legitimately land here and must not be treated as failures.
    console.warn("checkout.session.completed: no org_id in subscription metadata", session.id);
    return;
  }

  const isPack = subscription.metadata.type === "pack";

  if (isPack) {
    const packId = subscription.metadata.pack_id;
    if (!packId) {
      console.error("checkout.session.completed: pack type but no pack_id", session.id);
      return;
    }
    await activatePackInternally(orgId, packId, subscription.id);

    if (customerEmail) {
      await sendPackActivatedMail({
        email: customerEmail,
        packId,
        orgSlug: subscription.metadata.org_slug,
      }).catch((err) => console.error("Failed to send pack email:", err));
    }
  } else {
    const plan = await planFromSubscription(subscription);
    if (!plan) {
      // The session belongs to us (it carries org_id) but its price maps to no
      // known plan — almost always a missing STRIPE_PRICE_* env on this
      // deployment. Throw: acking here would drop a paid upgrade on the floor
      // for a config gap that is fixable, and Stripe's retries buy time to fix
      // it. Silent config gaps are exactly how paid orgs end up on free.
      throw new Error(
        `checkout.session.completed: could not resolve plan for session ${session.id} ` +
          `(org ${orgId}, price ${subscription?.items?.data?.[0]?.price?.id}) — ` +
          `is the matching STRIPE_PRICE_* env set?`,
      );
    }
    await updateOrganizationConfigInternally(orgId, plan as any);

    if (customerEmail) {
      await sendPurchaseCompleteMail({
        email: customerEmail,
        plan,
        orgSlug: subscription.metadata.org_slug,
      }).catch((err) => console.error("Failed to send purchase email:", err));
    }
  }
}

async function handleSubscriptionEvent(eventType: string, subscription: any) {
  const orgId = subscription.metadata?.org_id;
  if (!orgId) {
    console.log(`Subscription event missing org_id for customer ${subscription.customer}`);
    return;
  }

  const isPack = subscription.metadata.type === "pack";
  const status = subscription.status;

  if (isPack) {
    const packId = subscription.metadata.pack_id;

    if (eventType === "customer.subscription.deleted") {
      await deactivatePackInternally(orgId, subscription.id);
    } else if (
      eventType === "customer.subscription.updated" ||
      eventType === "customer.subscription.created"
    ) {
      if (subscription.cancel_at_period_end) {
        // User requested cancellation — mark as canceling but keep active until period end
        await markPackCancelingInternally(orgId, subscription.id);
      } else if (status === "active") {
        // Reactivated (e.g. user undid cancellation) or renewed
        if (packId) {
          await activatePackInternally(orgId, packId, subscription.id);
        }
      } else if (status === "past_due" || status === "unpaid") {
        // Payment failed — deactivate pack until payment succeeds
        console.warn(`Pack subscription ${subscription.id} is ${status} for org ${orgId}`);
        await deactivatePackInternally(orgId, subscription.id);
      } else if (status === "paused") {
        console.warn(`Pack subscription ${subscription.id} paused for org ${orgId}`);
        await deactivatePackInternally(orgId, subscription.id);
      }
    }
  } else {
    // Plan subscription
    if (eventType === "customer.subscription.deleted") {
      await updateOrganizationConfigInternally(orgId, "free");
      await deactivateAllPacksInternally(orgId).catch((err) => {
        console.error(`Failed to deactivate packs for org ${orgId}:`, err);
      });
    } else if (
      eventType === "customer.subscription.updated" ||
      eventType === "customer.subscription.created"
    ) {
      if (subscription.cancel_at_period_end) {
        // Plan is canceling — keep current plan until period ends
        console.log(`Plan subscription canceling for org ${orgId}, access continues until period end`);
      } else if (status === "active") {
        // Derive from price so billing-portal plan changes reconcile correctly.
        const plan = await planFromSubscription(subscription);
        if (plan) {
          await updateOrganizationConfigInternally(orgId, plan as any);
        } else {
          console.warn(`[webhook] could not resolve plan for active subscription ${subscription.id} (org ${orgId}); price id not in catalog?`);
        }
      } else if (status === "past_due" || status === "unpaid") {
        // Payment failed — notify user but keep plan active for grace period
        console.warn(`Plan subscription ${subscription.id} is ${status} for org ${orgId}`);
        const customer = await stripe.customers.retrieve(subscription.customer);
        if (customer?.email) {
          await sendPaymentFailedMail({
            email: customer.email,
            planName: subscription.metadata.plan,
            orgSlug: subscription.metadata.org_slug,
          }).catch((err) => console.error("Failed to send payment failed email:", err));
        }
      } else if (status === "paused") {
        console.warn(`Plan subscription ${subscription.id} paused for org ${orgId}, downgrading to free`);
        await updateOrganizationConfigInternally(orgId, "free");
      }
    }
  }
}
