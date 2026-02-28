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

export async function getUserEnrollments(orgId: number, access_token: string) {
  const result = await secureFetch(
    `${getAPIUrl()}payments/${encodeURIComponent(String(orgId))}/enrollments/mine`,
    RequestBodyWithAuthHeader('GET', null, null, access_token)
  );
  return getResponseMetadata(result);
}
