import "server-only";
// Internal pack (add-on) lifecycle calls to the backend.
//
// These hit the backend's /internal/packs/* endpoints with the
// `x-platform-key` header — a DIFFERENT key + header than the plan endpoint
// (orgPlan.ts uses `CloudInternalKey`). Both internal auth schemes must coexist.
import { getServerAPIUrl } from "@services/config/config";

// Resolve the platform key, failing loud when it is absent.
//
// Sending "" here produced a 500 from the backend guard ("not configured on the
// server") that read like a backend fault rather than a missing credential on
// this side, so a deployment without the key looked like a broken API instead
// of an unset env var. Shared with activeUserBilling.ts so both internal call
// sites resolve it identically.
export function platformApiKey(): string {
  const key = process.env.LEARNHOUSE_PLATFORM_API_KEY;
  if (!key) {
    throw new Error(
      "LEARNHOUSE_PLATFORM_API_KEY is unset on the web deployment — pack " +
        "activation and active-user overage billing cannot authenticate to the " +
        "API. Set it to the same value as the API's LEARNHOUSE_PLATFORM_API_KEY.",
    );
  }
  return key;
}

function platformHeaders() {
  return {
    "Content-Type": "application/json",
    "x-platform-key": platformApiKey(),
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
