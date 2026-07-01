// Shared helpers for the billing route handlers.
//
// Files prefixed with `_` are private modules — the Next.js App Router never
// treats them as routes, so this is a safe place for code shared across the
// sibling route.ts handlers.
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { ACCESS_TOKEN_COOKIE } from "@services/auth/cookies";
import { getServerAPIUrl } from "@services/config/config";
import { assertSaaSBilling, BillingUnavailableError } from "@services/billing/guard";

/**
 * Gate a billing route on SaaS availability.
 *
 * Returns a 404 `NextResponse` when billing is unavailable on this deployment
 * (so the endpoint simply "doesn't exist" on OSS / EE / unconfigured installs),
 * or `null` when billing is available and the caller may proceed. Any other
 * error is re-thrown for the route's own try/catch to surface as a 500.
 */
export async function guardBilling(): Promise<NextResponse | null> {
  try {
    await assertSaaSBilling();
    return null;
  } catch (err) {
    if (err instanceof BillingUnavailableError) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    throw err;
  }
}

/** Standard 400 for a missing/invalid request field. */
export function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 400 });
}

export interface AuthedUser {
  email: string;
  userId: number;
  isSuperadmin: boolean;
  token: string;
  // Session role entries: [{ role: { rights, ... }, org: { id, ... } }]
  roles: any[];
}

/**
 * Authenticate the caller from the httpOnly LH_access cookie by validating it
 * against the backend session endpoint. Identity (email, roles) is ALWAYS
 * taken from this verified session — never from caller-supplied request fields,
 * which would otherwise allow acting on another user's billing (IDOR).
 *
 * Returns the authenticated user, or a 401 `NextResponse` to return directly.
 */
export async function authenticateUser(): Promise<AuthedUser | NextResponse> {
  const unauthorized = () =>
    NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const token = (await cookies()).get(ACCESS_TOKEN_COOKIE)?.value;
  if (!token) return unauthorized();

  let session: any;
  try {
    const res = await fetch(`${getServerAPIUrl()}users/session`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) return unauthorized();
    session = await res.json();
  } catch {
    return unauthorized();
  }

  const email = session?.user?.email;
  if (!email) return unauthorized();

  return {
    email,
    userId: session?.user?.id,
    isSuperadmin: session?.user?.is_superadmin === true,
    token,
    roles: Array.isArray(session?.roles) ? session.roles : [],
  };
}

/**
 * Whether `user` may manage billing for `orgId`. Mirrors the client-side
 * `useAdminStatus` gate (components/Hooks/useAdminStatus.tsx) so server
 * enforcement matches the UI: superadmins always pass, otherwise the user must
 * hold a role on that org granting `organizations.action_update` (or delete).
 */
export function canManageOrgBilling(
  user: AuthedUser,
  orgId: string | number,
): boolean {
  if (user.isSuperadmin) return true;
  const target = String(orgId);
  for (const r of user.roles) {
    if (String(r?.org?.id) !== target) continue;
    const orgRights = r?.role?.rights?.organizations;
    if (orgRights?.action_update === true || orgRights?.action_delete === true) {
      return true;
    }
  }
  return false;
}

/**
 * Authenticate the caller AND authorize them to manage billing for `orgId`.
 * On success returns `{ user }` (with the verified session email/roles);
 * otherwise returns `{ error }` with a 401/403 response to return directly.
 *
 * Callers MUST use the returned `user.email` and the validated `orgId` — never
 * the email/orgId from the request body — when invoking billing services.
 */
export async function requireOrgBillingAccess(
  orgId: string | number,
): Promise<{ user: AuthedUser } | { error: NextResponse }> {
  const user = await authenticateUser();
  if (user instanceof NextResponse) return { error: user };
  if (!canManageOrgBilling(user, orgId)) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { user };
}

/**
 * Gate a cron-only endpoint on a shared secret. Returns a 403 `NextResponse`
 * when the `x-cron-secret` header is missing or doesn't match `CRON_SECRET`,
 * or `null` when the caller is authorized. Fails closed when CRON_SECRET is
 * unset (the endpoint is unusable until a secret is configured).
 */
export function requireCronSecret(request: NextRequest): NextResponse | null {
  const expected = process.env.CRON_SECRET;
  const provided = request.headers.get("x-cron-secret");
  if (!expected || !provided || provided !== expected) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}
