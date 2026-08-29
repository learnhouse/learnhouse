'use server';
import { getAPIUrl } from '@services/config/config';
import { RequestBodyWithAuthHeader, getResponseMetadata, secureFetch } from '@services/utils/ts/requests';

export async function getOffers(orgId: number, access_token: string) {
  const result = await secureFetch(
    `${getAPIUrl()}payments/${encodeURIComponent(String(orgId))}/offers`,
    RequestBodyWithAuthHeader('GET', null, null, access_token)
  );
  return getResponseMetadata(result);
}

export async function createOffer(orgId: number, data: any, access_token: string) {
  const result = await secureFetch(
    `${getAPIUrl()}payments/${encodeURIComponent(String(orgId))}/offers`,
    RequestBodyWithAuthHeader('POST', data, null, access_token)
  );
  return getResponseMetadata(result);
}

export async function updateOffer(orgId: number, offerId: string, data: any, access_token: string) {
  const result = await secureFetch(
    `${getAPIUrl()}payments/${encodeURIComponent(String(orgId))}/offers/${encodeURIComponent(offerId)}`,
    RequestBodyWithAuthHeader('PUT', data, null, access_token)
  );
  return getResponseMetadata(result);
}

export async function archiveOffer(orgId: number, offerId: string, access_token: string) {
  const result = await secureFetch(
    `${getAPIUrl()}payments/${encodeURIComponent(String(orgId))}/offers/${encodeURIComponent(offerId)}`,
    RequestBodyWithAuthHeader('DELETE', null, null, access_token)
  );
  return getResponseMetadata(result);
}

export async function getOfferDetails(orgId: number, offerId: string, access_token: string) {
  const result = await secureFetch(
    `${getAPIUrl()}payments/${encodeURIComponent(String(orgId))}/offers/${encodeURIComponent(offerId)}`,
    RequestBodyWithAuthHeader('GET', null, null, access_token)
  );
  return getResponseMetadata(result);
}

export async function getPublicOffer(orgId: number, offerId: string) {
  const result = await secureFetch(
    `${getAPIUrl()}payments/${encodeURIComponent(String(orgId))}/offers/${encodeURIComponent(offerId)}/public`,
    RequestBodyWithAuthHeader('GET', null, null, '')
  );
  return getResponseMetadata(result);
}

export async function getPublicOffers(orgId: number) {
  const result = await secureFetch(
    `${getAPIUrl()}payments/${encodeURIComponent(String(orgId))}/offers/public-listing`,
    RequestBodyWithAuthHeader('GET', null, null, '')
  );
  return getResponseMetadata(result);
}

export async function getOffersByResource(orgId: number, resourceUuid: string) {
  const result = await secureFetch(
    `${getAPIUrl()}payments/${encodeURIComponent(String(orgId))}/offers/by-resource?resource_uuid=${encodeURIComponent(resourceUuid)}`,
    RequestBodyWithAuthHeader('GET', null, null, '')
  );
  return getResponseMetadata(result);
}

// Provider-agnostic: the backend selects the correct payment provider
// based on the org's active PaymentsConfig.
export async function getOfferCheckoutSession(
  orgId: number,
  offerUuid: string,
  redirect_uri: string,
  access_token: string
) {
  const result = await secureFetch(
    `${getAPIUrl()}payments/${encodeURIComponent(String(orgId))}/offers/${encodeURIComponent(offerUuid)}/checkout?redirect_uri=${encodeURIComponent(redirect_uri)}`,
    RequestBodyWithAuthHeader('POST', null, null, access_token)
  );
  return getResponseMetadata(result);
}

export async function getBillingPortalSession(orgId: number, return_url: string, access_token: string) {
  const result = await secureFetch(
    `${getAPIUrl()}payments/${encodeURIComponent(String(orgId))}/billing/portal?return_url=${encodeURIComponent(return_url)}`,
    RequestBodyWithAuthHeader('POST', null, null, access_token)
  );
  return getResponseMetadata(result);
}

/**
 * The signed-in user's paid enrollments.
 *
 * A 403/404 here is the normal answer for an org with payments disabled or a
 * user with nothing to show — not a failure. Throwing on it meant every visit
 * to /account/purchases and /account/my-courses in such an org raised an
 * unhandled Server Action error ("Forbidden", the bare HTTP reason phrase) that
 * Next reported through instrumentation before react-query ever saw it. Any
 * remaining error carries the API's `detail` rather than `statusText`, which
 * says nothing to the user and nothing to whoever reads it in Sentry.
 */
export async function getUserEnrollments(orgId: number, access_token: string) {
  const result = await secureFetch(
    `${getAPIUrl()}payments/${encodeURIComponent(String(orgId))}/enrollments/mine`,
    RequestBodyWithAuthHeader('GET', null, null, access_token)
  );
  const metadata = await getResponseMetadata(result);
  if (metadata.status === 403 || metadata.status === 404) {
    // "Payments aren't enabled for this org" / "nothing entitled" — an expected
    // empty result, not an exception. Leave a trace anyway: absorbed purely on
    // status, this branch is indistinguishable from a genuine entitlement
    // regression that starts 403ing every lookup, which would otherwise show
    // every paying user an empty purchases page with nothing anywhere to say so.
    console.warn(
      `[payments] enrollments/mine returned ${metadata.status} for org ${orgId}; treating as no purchases.`,
      metadata.data?.detail ?? null
    );
    return { ...metadata, success: true, data: [] };
  }
  if (!metadata.success) {
    const detail = metadata.data?.detail;
    throw new Error(
      typeof detail === 'string'
        ? detail
        : `Could not load your purchases (HTTP ${metadata.status})`
    );
  }
  return metadata;
}
