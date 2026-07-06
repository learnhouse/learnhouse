// Same-origin client helpers for the /api/billing/* route handlers.
//
// CRITICAL: the billing UI is a client component and must NEVER import
// @services/billing/* (server-only). All billing actions go through these
// same-origin fetches. The routes derive the user's email from the session
// cookie and enforce org-admin, so we send orgId and NEVER an email.

import type { Billing, PlanId, PackId, PricesResponse } from "./plans";

async function postJson<T = any>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as any)?.error || `Request failed (${res.status})`);
  }
  return data as T;
}

export interface SubscriptionDetail {
  id: string;
  status: string;
  plan: string;
  billing: Billing;
  currentPeriodStart?: number;
  currentPeriodEnd?: number;
  cancelAtPeriodEnd: boolean;
  priceId?: string;
  amount?: number;
  currency?: string;
  interval?: string;
}

export interface PromoResult {
  valid: boolean;
  promotionCodeId?: string;
  couponId?: string;
  percentOff?: number;
  amountOff?: number;
  currency?: string;
}

// POST /api/billing/checkout → { id, url }
export function billingCheckout(body: {
  plan: PlanId;
  billing: Billing;
  orgId: number | string;
  orgSlug?: string;
  promotionCode?: string;
}): Promise<{ id: string; url: string }> {
  return postJson("/api/billing/checkout", body);
}

// POST /api/billing/switch → { scheduled|updated, plan }
export function billingSwitch(body: {
  orgId: number | string;
  newPlan: PlanId;
  newBilling: Billing;
  downgrade?: boolean;
  promotionCode?: string;
}): Promise<{ scheduled?: boolean; updated?: boolean; plan: string }> {
  return postJson("/api/billing/switch", body);
}

// POST /api/billing/cancel → { ok, cancelAtPeriodEnd }
export function billingCancel(body: {
  orgId: number | string;
}): Promise<{ ok?: boolean; cancelAtPeriodEnd?: boolean }> {
  return postJson("/api/billing/cancel", body);
}

// POST /api/billing/pack-checkout → { id, url }
export function billingPackCheckout(body: {
  packId: PackId;
  orgId: number | string;
  orgSlug?: string;
}): Promise<{ id: string; url: string }> {
  return postJson("/api/billing/pack-checkout", body);
}

// POST /api/billing/portal → { url }
export function billingPortal(): Promise<{ url: string }> {
  return postJson("/api/billing/portal", {});
}

// GET /api/billing/subscription?orgId=… → subscription detail | null
export async function fetchSubscription(
  orgId: number | string,
): Promise<SubscriptionDetail | null> {
  const res = await fetch(
    `/api/billing/subscription?orgId=${encodeURIComponent(String(orgId))}`,
  );
  if (!res.ok) return null;
  return res.json();
}

// GET /api/billing/prices → { plans, packs, limits }
export async function fetchPrices(): Promise<PricesResponse | null> {
  const res = await fetch("/api/billing/prices");
  if (!res.ok) return null;
  return res.json();
}

// POST /api/billing/promo { code } → PromoResult
export async function validatePromo(code: string): Promise<PromoResult> {
  try {
    return await postJson<PromoResult>("/api/billing/promo", { code });
  } catch {
    return { valid: false };
  }
}
