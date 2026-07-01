import "server-only";
// Billing availability guard (server-only).
//
// SaaS subscription billing must ONLY run on the canonical SaaS deployment.
// Two independent conditions must both hold:
//   1. The backend reports `mode === "saas"` (instance/info — same source the
//      proxy/middleware uses for tenancy + mode).
//   2. `STRIPE_SECRET_KEY` is configured in this environment.
//
// Route handlers call `assertSaaSBilling()` at the top and translate a thrown
// `BillingUnavailableError` into a 404 (billing endpoints simply don't exist on
// OSS / EE / unconfigured deployments). `isSaaSBillingEnabled()` is the
// non-throwing variant for places that prefer a boolean.
import { getServerAPIUrl } from "@services/config/config";

/** Thrown by assertSaaSBilling() when billing is not available on this deploy. */
export class BillingUnavailableError extends Error {
  readonly code = "BILLING_UNAVAILABLE";
  constructor(message = "SaaS billing is not available on this deployment") {
    super(message);
    this.name = "BillingUnavailableError";
  }
}

interface InstanceInfo {
  mode?: "saas" | "oss" | "ee";
  [key: string]: unknown;
}

// Short-lived cache (mirrors proxy.ts' 30s TTL) so the guard adds at most one
// backend round-trip per 30s across all billing routes.
let _instanceCache: { data: InstanceInfo; ts: number } | null = null;
const INSTANCE_CACHE_TTL = 30 * 1000;

async function getInstanceInfo(): Promise<InstanceInfo> {
  if (_instanceCache && Date.now() - _instanceCache.ts < INSTANCE_CACHE_TTL) {
    return _instanceCache.data;
  }
  try {
    const res = await fetch(`${getServerAPIUrl()}instance/info`, {
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      const data = (await res.json()) as InstanceInfo;
      _instanceCache = { data, ts: Date.now() };
      return data;
    }
  } catch {
    // Backend unavailable — treat as non-SaaS (safe default: block billing).
  }
  return { mode: "oss" };
}

/**
 * True only when this deployment is the SaaS instance AND Stripe is configured.
 * Never throws.
 */
export async function isSaaSBillingEnabled(): Promise<boolean> {
  if (!process.env.STRIPE_SECRET_KEY) return false;
  const info = await getInstanceInfo();
  return info.mode === "saas";
}

/**
 * Assert SaaS billing is available; throws BillingUnavailableError otherwise.
 * Routes catch this and return 404.
 */
export async function assertSaaSBilling(): Promise<void> {
  if (!(await isSaaSBillingEnabled())) {
    throw new BillingUnavailableError();
  }
}
