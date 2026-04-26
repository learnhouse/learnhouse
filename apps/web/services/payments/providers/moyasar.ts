'use server';
// Moyasar-specific payment provider service.
// Parallels stripe.ts — shares conventions (secureFetch, RequestBodyWithAuthHeader, errorHandling).
import { getAPIUrl } from '@services/config/config';
import { RequestBodyWithAuthHeader, errorHandling, secureFetch } from '@services/utils/ts/requests';

export type MoyasarConnectVerifyBody = {
  publishable_key: string;
  secret_key: string;
  webhook_secret: string;
};

/**
 * Verify a school's Moyasar API keys against the live Moyasar API and persist
 * them (encrypted) in PaymentsConfig. Returns { active: true, mode: "test" | "live" }
 * on success.
 *
 * Unlike Stripe Connect, Moyasar has no OAuth — schools paste their own keys
 * directly. Keys are encrypted with Fernet (LEARNHOUSE_AUTH_JWT_SECRET_KEY-derived)
 * before being stored.
 */
export async function verifyMoyasarKeys(
  orgId: number,
  body: MoyasarConnectVerifyBody,
  access_token: string
) {
  const result = await secureFetch(
    `${getAPIUrl()}payments/${encodeURIComponent(String(orgId))}/moyasar/connect/verify`,
    RequestBodyWithAuthHeader('POST', body, null, access_token)
  );
  const res = await errorHandling(result);
  return res;
}

/**
 * Poll enrollment status — used by the Moyasar callback page after redirect
 * from Moyasar's hosted payment page. For PENDING enrollments the backend
 * reconciles with Moyasar before returning, covering the "webhook not yet
 * received" window.
 */
export async function getEnrollmentStatus(
  enrollmentId: number,
  access_token: string
): Promise<{ status: string }> {
  const result = await secureFetch(
    `${getAPIUrl()}payments/enrollments/${encodeURIComponent(String(enrollmentId))}/status`,
    RequestBodyWithAuthHeader('GET', null, null, access_token)
  );
  const res = await errorHandling(result);
  return res;
}
