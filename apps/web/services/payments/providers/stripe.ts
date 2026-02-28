'use server';
// Stripe-specific payment provider service.
// Each payment provider gets its own file here.
// The generic payment config and offer services live in payments.ts / offers.ts.
import { getAPIUrl } from '@services/config/config';
import { RequestBodyWithAuthHeader, errorHandling, secureFetch } from '@services/utils/ts/requests';

/**
 * Generate a Stripe Connect OAuth link for the given org.
 * The org admin opens this URL to authorize LearnHouse on their Stripe account.
 */
export async function getStripeOnboardingLink(
  orgId: number,
  access_token: string,
  redirect_uri: string
) {
  const result = await secureFetch(
    `${getAPIUrl()}payments/${encodeURIComponent(String(orgId))}/stripe/connect/link?redirect_uri=${encodeURIComponent(redirect_uri)}`,
    RequestBodyWithAuthHeader('POST', null, null, access_token)
  );
  const res = await errorHandling(result);
  return res;
}

/**
 * Exchange the Stripe OAuth authorization code for an access token and
 * store the connected account ID in the org's PaymentsConfig.
 */
export async function verifyStripeConnection(
  orgId: number,
  code: string,
  access_token: string
) {
  const result = await secureFetch(
    `${getAPIUrl()}payments/stripe/oauth/callback?code=${encodeURIComponent(code)}&org_id=${encodeURIComponent(String(orgId))}`,
    RequestBodyWithAuthHeader('GET', null, null, access_token)
  );
  const res = await errorHandling(result);
  return res;
}

/**
 * Easy Mode — create a Stripe Express account (if not yet created) and
 * return an onboarding link. The org owner opens this URL to complete setup.
 */
export async function getStripeExpressOnboardingLink(
  orgId: number,
  access_token: string,
  redirect_uri: string
) {
  const result = await secureFetch(
    `${getAPIUrl()}payments/${encodeURIComponent(String(orgId))}/stripe/express/connect/link?redirect_uri=${encodeURIComponent(redirect_uri)}`,
    RequestBodyWithAuthHeader('POST', null, null, access_token)
  );
  const res = await errorHandling(result);
  return res;
}

/**
 * Easy Mode — generate a fresh onboarding link when the previous one has expired.
 */
export async function refreshStripeExpressOnboardingLink(
  orgId: number,
  access_token: string,
  redirect_uri: string
) {
  const result = await secureFetch(
    `${getAPIUrl()}payments/${encodeURIComponent(String(orgId))}/stripe/express/connect/refresh?redirect_uri=${encodeURIComponent(redirect_uri)}`,
    RequestBodyWithAuthHeader('POST', null, null, access_token)
  );
  const res = await errorHandling(result);
  return res;
}

/**
 * Easy Mode — get a Stripe Express hosted dashboard URL for the connected account.
 */
export async function getStripeExpressDashboardLink(
  orgId: number,
  access_token: string
) {
  const result = await secureFetch(
    `${getAPIUrl()}payments/${encodeURIComponent(String(orgId))}/stripe/express/dashboard`,
    RequestBodyWithAuthHeader('GET', null, null, access_token)
  );
  const res = await errorHandling(result);
  return res;
}
