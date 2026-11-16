import "server-only";
// Billing notification emails, now backed by Resend (services/emails/resend.ts)
// through the shared React Email template. Every caller still invokes these with
// `.catch(...)` and they never throw; with no RESEND_API_KEY they log-and-skip,
// so a mail failure (or an unconfigured deploy) never blocks the Stripe flow.
//
// Plain server module (no `"use server"`): internal helpers invoked only from
// server actions / route handlers, never directly from the client.
import { send, planColor } from "@services/emails/resend";

const prettyPlan = (plan?: string) =>
  (plan || "free")
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

export async function sendPlanSwitchMail(args: {
  email: string;
  oldPlan: string;
  newPlan: string;
  isDowngrade: boolean;
}): Promise<void> {
  const { email, oldPlan, newPlan, isDowngrade } = args;
  await send(email, `You're on ${prettyPlan(newPlan)} now`, {
    accentColor: planColor(newPlan),
    heading: isDowngrade ? `You're on ${prettyPlan(newPlan)} now` : `${prettyPlan(newPlan)} is ready for your learners`,
    subtitle: isDowngrade
      ? `The change is done. Anything your new plan doesn't include is paused, not deleted, and comes back if you upgrade.`
      : `Everything in ${prettyPlan(newPlan)} is unlocked for your academy, starting now.`,
    transition: {
      fromLabel: "Previous",
      fromValue: prettyPlan(oldPlan),
      fromColor: planColor(oldPlan),
      toLabel: "New plan",
      toValue: prettyPlan(newPlan),
      toColor: planColor(newPlan),
    },
  });
}

export async function sendSubscriptionCanceledMail(args: {
  email: string;
  planName: string;
  orgSlug?: string;
}): Promise<void> {
  const { email, planName, orgSlug } = args;
  await send(email, `Your ${prettyPlan(planName)} plan won't renew`, {
    accentColor: "#ef4444",
    heading: "Your plan won't renew",
    subtitle: `Your ${prettyPlan(planName)} plan stays active until the end of the current billing period. After that, your academy moves to Free. Nothing is deleted.`,
    body: "If you change your mind, pick a plan again from your billing settings and everything comes back as it was.",
    card: orgSlug
      ? { label: "Organization", title: orgSlug, color: "#ef4444" }
      : undefined,
  });
}

export async function sendPurchaseCompleteMail(args: {
  email: string;
  plan?: string;
  orgSlug?: string;
}): Promise<void> {
  const { email, plan, orgSlug } = args;
  await send(email, `Your ${prettyPlan(plan)} plan is active`, {
    accentColor: planColor(plan),
    heading: `${prettyPlan(plan)} is active`,
    subtitle: `Your payment went through and every ${prettyPlan(plan)} feature is available to your academy now.`,
    card: {
      label: "Your plan",
      title: prettyPlan(plan),
      caption: orgSlug,
      color: planColor(plan),
    },
    bulletPoints: [
      "Anything paused on the Free plan, like private courses, is back as it was.",
      "Invoices and plan changes are in your billing settings.",
    ],
  });
}

export async function sendPackActivatedMail(args: {
  email: string;
  packId?: string;
  orgSlug?: string;
}): Promise<void> {
  const { email, packId, orgSlug } = args;
  await send(email, "Your add-on is active", {
    accentColor: "#7c3aed",
    heading: "Your add-on is active",
    subtitle: "The extra capacity is available to your academy now.",
    card: {
      label: "Add-on",
      title: packId || "Pack",
      caption: orgSlug,
      color: "#7c3aed",
    },
  });
}

export async function sendPaymentFailedMail(args: {
  email: string;
  planName?: string;
  orgSlug?: string;
}): Promise<void> {
  const { email, planName, orgSlug } = args;
  await send(email, `Your ${prettyPlan(planName)} payment didn't go through`, {
    accentColor: "#ef4444",
    heading: "Your payment didn't go through",
    subtitle: `We couldn't charge your card for ${prettyPlan(planName)}. Your learners keep full access for now.`,
    body: "Update your payment method in your billing settings and nothing changes for them.",
    card: orgSlug
      ? { label: "Organization", title: orgSlug, color: "#ef4444" }
      : undefined,
  });
}
