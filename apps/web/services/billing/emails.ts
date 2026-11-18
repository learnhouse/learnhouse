import "server-only";
// Billing notification emails. The web app no longer renders or sends mail
// itself: each helper asks the API to send a registered billing template
// (POST cloud_internal/send_billing_email), so billing mail uses the same
// layout, provider, suppression list and plain-text part as every other
// LearnHouse email (apps/api/src/services/email).
//
// Every caller still invokes these with `.catch(...)`, and they never throw:
// a mail failure (or an unconfigured deploy) must never block the Stripe flow.
// SaaS-only, as before: nothing is sent on OSS / self-hosted.
//
// Plain server module (no `"use server"`): internal helpers invoked only from
// server actions / route handlers, never directly from the client.
import { getServerAPIUrl } from "@services/config/config";
import { isSaaSMode } from "@lib/saas";

export interface SendResult {
  ok: boolean;
  skipped?: boolean;
}

async function sendBillingEmail(
  template: string,
  to: string,
  context: Record<string, unknown>,
): Promise<SendResult> {
  if (!(await isSaaSMode())) return { ok: false, skipped: true };
  const internalKey =
    process.env.CLOUD_INTERNAL_KEY || process.env.LEARNHOUSE_CLOUD_INTERNAL_KEY || "";
  if (!internalKey || !to) {
    console.log(`[email] skipped (${internalKey ? "no recipient" : "internal key unset"}): ${template}`);
    return { ok: false, skipped: true };
  }
  try {
    const res = await fetch(`${getServerAPIUrl()}cloud_internal/send_billing_email`, {
      method: "POST",
      // Runs inside the Stripe webhook: never hold the delivery open.
      signal: AbortSignal.timeout(10_000),
      headers: { "Content-Type": "application/json", "X-Internal-Key": internalKey },
      body: JSON.stringify({ template, to: [to], context }),
    });
    if (!res.ok) {
      console.error(`[email] ${template} failed: ${res.status}`);
      return { ok: false };
    }
    return { ok: true };
  } catch (err) {
    console.error(`[email] ${template} failed:`, err);
    return { ok: false };
  }
}

export async function sendPlanSwitchMail(args: {
  email: string;
  oldPlan: string;
  newPlan: string;
  isDowngrade: boolean;
}): Promise<void> {
  await sendBillingEmail("billing.plan_changed", args.email, {
    old_plan: args.oldPlan,
    new_plan: args.newPlan,
    is_downgrade: args.isDowngrade,
  });
}

export async function sendSubscriptionCanceledMail(args: {
  email: string;
  planName: string;
  orgSlug?: string;
}): Promise<void> {
  await sendBillingEmail("billing.subscription_canceled", args.email, {
    plan: args.planName,
    org_slug: args.orgSlug ?? "",
  });
}

export async function sendPurchaseCompleteMail(args: {
  email: string;
  plan?: string;
  orgSlug?: string;
}): Promise<void> {
  await sendBillingEmail("billing.purchase_complete", args.email, {
    plan: args.plan ?? "",
    org_slug: args.orgSlug ?? "",
  });
}

export async function sendPackActivatedMail(args: {
  email: string;
  packId?: string;
  orgSlug?: string;
}): Promise<void> {
  await sendBillingEmail("billing.pack_activated", args.email, {
    pack_id: args.packId ?? "",
    org_slug: args.orgSlug ?? "",
  });
}

export async function sendPaymentFailedMail(args: {
  email: string;
  planName?: string;
  orgSlug?: string;
}): Promise<void> {
  await sendBillingEmail("billing.payment_failed", args.email, {
    plan: args.planName ?? "",
    org_slug: args.orgSlug ?? "",
  });
}
