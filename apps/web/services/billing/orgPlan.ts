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

  const internalKey = process.env.LEARNHOUSE_CLOUD_INTERNAL_KEY || "";
  const result = await fetch(`${getServerAPIUrl()}cloud_internal/update_org_plan`, {
    method: "PUT",
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
