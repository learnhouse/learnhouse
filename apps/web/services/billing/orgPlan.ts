import "server-only";
// Internal API — pushes only the plan name to the backend; the API resolves all
// features at runtime. This is the ONLY org function billing needs.
//
// Ported from the platform's services/organizations/orgs.ts, deliberately
// stripping the @vercel/kv trial-status helper and the email coupling: billing
// correctness only requires this authenticated internal plan PUT.
import { getServerAPIUrl } from "@services/config/config";
import type { LearnHousePlanType } from "./plans";

export async function updateOrganizationConfigInternally(org_id: any, plan: LearnHousePlanType) {
  console.log(`[updateOrgConfig] Updating org ${org_id} to plan "${plan}"`);

  // The API guard (apps/api/.../orgs/org_plan.py) compares X-Internal-Key to env
  // CLOUD_INTERNAL_KEY. Accept EITHER name here, preferring the unprefixed one
  // the API itself reads, so the two services agree even when only one name is
  // provisioned. Reading a single name and falling back to "" sent an empty key
  // whenever that name was the one missing, and the API — which fails closed on
  // an empty expected key — answered 403, indistinguishable from a real key
  // mismatch. Fail loud instead: a missing credential is a deploy fault, and it
  // must not read as an authorization failure.
  const internalKey =
    process.env.CLOUD_INTERNAL_KEY || process.env.LEARNHOUSE_CLOUD_INTERNAL_KEY || "";
  if (!internalKey) {
    throw new Error(
      "[updateOrgConfig] internal key unset — set CLOUD_INTERNAL_KEY (or " +
        "LEARNHOUSE_CLOUD_INTERNAL_KEY) on the web deployment to match the API's " +
        "CLOUD_INTERNAL_KEY; the plan write would 403 without it.",
    );
  }
  const result = await fetch(`${getServerAPIUrl()}cloud_internal/update_org_plan`, {
    method: "PUT",
    // Bound the call: this runs inside the Stripe webhook handler, and an
    // unbounded fetch would hold the delivery open until Stripe times out.
    signal: AbortSignal.timeout(10_000),
    headers: {
      "Content-Type": "application/json",
      // The backend cloud_internal guard (apps/api/.../orgs/org_plan.py) reads
      // the `X-Internal-Key` header and compares it to env CLOUD_INTERNAL_KEY —
      // the same convention as custom_domains.py. Distinct from the packs
      // `x-platform-key` scheme.
      "X-Internal-Key": internalKey,
    },
    redirect: "follow",
    credentials: "include",
    body: JSON.stringify({ org_id, plan }),
  });

  if (!result.ok) {
    const body = await result.text().catch(() => "");
    console.error(`[updateOrgConfig] Failed: ${result.status} ${result.statusText}`, body);
    throw new Error(`Failed to update org plan: ${result.status} ${result.statusText}`);
  }
  return await result.json();
}
