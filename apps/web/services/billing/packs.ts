import "server-only";
// Internal pack (add-on) lifecycle calls to the backend.
//
// These hit the backend's /internal/packs/* endpoints with the
// `x-platform-key` header — a DIFFERENT key + header than the plan endpoint
// (orgPlan.ts uses `CloudInternalKey`). Both internal auth schemes must coexist.
import { getServerAPIUrl } from "@services/config/config";

function platformHeaders() {
  return {
    "Content-Type": "application/json",
    "x-platform-key": process.env.LEARNHOUSE_PLATFORM_API_KEY || "",
  };
}

export async function activatePackInternally(orgId: string, packId: string, platformSubscriptionId: string) {
  const res = await fetch(`${getServerAPIUrl()}internal/packs/${orgId}/activate`, {
    method: "POST",
    headers: platformHeaders(),
    body: JSON.stringify({
      pack_id: packId,
      platform_subscription_id: platformSubscriptionId,
    }),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: "Failed to activate pack" }));
    throw new Error(error.detail || "Failed to activate pack");
  }

  return res.json();
}

export async function markPackCancelingInternally(orgId: string, platformSubscriptionId: string) {
  const res = await fetch(`${getServerAPIUrl()}internal/packs/${orgId}/mark-canceling`, {
    method: "PATCH",
    headers: platformHeaders(),
    body: JSON.stringify({
      platform_subscription_id: platformSubscriptionId,
    }),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: "Failed to mark pack as canceling" }));
    throw new Error(error.detail || "Failed to mark pack as canceling");
  }

  return res.json();
}

export async function deactivateAllPacksInternally(orgId: string) {
  const res = await fetch(`${getServerAPIUrl()}internal/packs/${orgId}/deactivate-all`, {
    method: "DELETE",
    headers: platformHeaders(),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: "Failed to deactivate all packs" }));
    throw new Error(error.detail || "Failed to deactivate all packs");
  }

  return res.json();
}

export async function deactivatePackInternally(orgId: string, platformSubscriptionId: string) {
  const res = await fetch(`${getServerAPIUrl()}internal/packs/${orgId}/deactivate`, {
    method: "DELETE",
    headers: platformHeaders(),
    body: JSON.stringify({
      platform_subscription_id: platformSubscriptionId,
    }),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: "Failed to deactivate pack" }));
    throw new Error(error.detail || "Failed to deactivate pack");
  }

  return res.json();
}
