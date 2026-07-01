import "server-only";
// Billing notification emails, now backed by Resend (services/emails/resend.ts)
// through the shared React Email template. Every caller still invokes these with
// `.catch(...)` and they never throw — with no RESEND_API_KEY they log-and-skip,
// so a mail failure (or an unconfigured deploy) never blocks the Stripe flow.
//
// Plain server module (no `"use server"`) — internal helpers invoked only from
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
  await send(email, `Your plan changed to ${prettyPlan(newPlan)}`, {
    accentColor: planColor(newPlan),
    heading: isDowngrade ? "Your plan was changed" : "Your plan is upgraded 🎉",
    subtitle: isDowngrade
      ? `You're now on the ${prettyPlan(newPlan)} plan.`
      : `You now have access to everything in ${prettyPlan(newPlan)}.`,
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
  await send(email, "Your subscription was canceled", {
    accentColor: "#ef4444",
    heading: "Your subscription was canceled",
    subtitle: `Your ${prettyPlan(planName)} subscription won't renew. You keep access until the end of the current billing period.`,
    body: "Changed your mind? You can resubscribe any time from your billing settings.",
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
  await send(email, `Welcome to ${prettyPlan(plan)} 🎉`, {
    accentColor: planColor(plan),
    heading: "Payment received — you're all set!",
    subtitle: `Your ${prettyPlan(plan)} plan is now active. Thanks for supporting LearnHouse.`,
    card: {
      label: "Your plan",
      title: prettyPlan(plan),
      caption: orgSlug,
      color: planColor(plan),
    },
    bulletPoints: [
      "All your new plan features are unlocked right away.",
      "Manage or change your plan any time from billing settings.",
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
    heading: "Add-on activated ⚡",
    subtitle: "Your add-on pack is now active and ready to use.",
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
  await send(email, "Action needed: payment failed", {
    accentColor: "#ef4444",
    heading: "We couldn't process your payment",
    subtitle: `A payment for your ${prettyPlan(planName)} plan didn't go through. Your access continues for a short grace period.`,
    body: "Please update your payment method to avoid losing access to your plan features.",
    card: orgSlug
      ? { label: "Organization", title: orgSlug, color: "#ef4444" }
      : undefined,
  });
}
