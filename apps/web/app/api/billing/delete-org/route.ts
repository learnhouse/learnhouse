import { NextRequest, NextResponse } from "next/server";
import { getServerAPIUrl } from "@services/config/config";
import { cancelSubscriptionsNow, listChargeableOrgSubscriptions } from "@services/billing/stripe";
import { guardBilling, badRequest, requireOrgBillingAccess } from "../_lib";

// POST /api/billing/delete-org
// Body: { orgId }
// Deletes the organization, then cancels every subscription still billing for
// it. The backend delete alone leaves Stripe untouched, so a paying org that
// deleted itself kept being charged for an org that no longer existed.
//
// Order matters: access is checked and the subscriptions are looked up while
// the org still exists (both need it), the backend performs the delete with
// the caller's own token (so its own permission checks still apply), and only
// a successful delete cancels anything. If the Stripe lookup fails, nothing is
// deleted: better a retry than an org that is gone but still billed.
//
// On deployments without SaaS billing this route 404s and the client deletes
// through the backend directly.
export async function POST(request: NextRequest) {
  const blocked = await guardBilling();
  if (blocked) return blocked;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return badRequest("Invalid JSON body");
  }

  const orgId = String(body?.orgId ?? "");
  if (!/^\d+$/.test(orgId)) {
    return badRequest("Missing or invalid field: orgId");
  }

  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || undefined;
  const access = await requireOrgBillingAccess(orgId, bearer);
  if ("error" in access) return access.error;

  let subscriptions: any[];
  try {
    subscriptions = await listChargeableOrgSubscriptions(orgId, access.user.email);
  } catch (err) {
    console.error(`[billing/delete-org] subscription lookup failed for org ${orgId}:`, err);
    return NextResponse.json(
      { error: "Could not check this organization's subscription, so nothing was deleted. Please try again." },
      { status: 502 },
    );
  }

  const res = await fetch(`${getServerAPIUrl()}orgs/${orgId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${access.user.token}` },
    cache: "no-store",
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: res.statusText }));
    return NextResponse.json(data, { status: res.status });
  }

  const { canceled, failed } = await cancelSubscriptionsNow(subscriptions);
  if (failed.length > 0) {
    // The org is gone and these will keep charging; someone has to cancel them by hand.
    console.error(`[billing/delete-org] org ${orgId} deleted but subscriptions are still live:`, failed);
  }

  return NextResponse.json({ deleted: true, canceledSubscriptions: canceled.length });
}
