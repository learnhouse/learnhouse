'use server';
import { getAPIUrl } from '@services/config/config';
import { RequestBodyWithAuthHeader, getResponseMetadata, secureFetch } from '@services/utils/ts/requests';

// ---------------------------------------------------------------------------
// Payment Groups
// ---------------------------------------------------------------------------

export async function getPaymentsGroups(orgId: number, access_token: string) {
  const result = await secureFetch(
    `${getAPIUrl()}payments/${encodeURIComponent(String(orgId))}/groups`,
    RequestBodyWithAuthHeader('GET', null, null, access_token)
  );
  return getResponseMetadata(result);
}

export async function createPaymentsGroup(orgId: number, data: { name: string; description: string }, access_token: string) {
  const result = await secureFetch(
    `${getAPIUrl()}payments/${encodeURIComponent(String(orgId))}/groups`,
    RequestBodyWithAuthHeader('POST', data, null, access_token)
  );
  return getResponseMetadata(result);
}

export async function updatePaymentsGroup(orgId: number, groupId: number, data: { name: string; description: string }, access_token: string) {
  const result = await secureFetch(
    `${getAPIUrl()}payments/${encodeURIComponent(String(orgId))}/groups/${encodeURIComponent(String(groupId))}`,
    RequestBodyWithAuthHeader('PUT', data, null, access_token)
  );
  return getResponseMetadata(result);
}

export async function deletePaymentsGroup(orgId: number, groupId: number, access_token: string) {
  const result = await secureFetch(
    `${getAPIUrl()}payments/${encodeURIComponent(String(orgId))}/groups/${encodeURIComponent(String(groupId))}`,
    RequestBodyWithAuthHeader('DELETE', null, null, access_token)
  );
  return getResponseMetadata(result);
}

// ---------------------------------------------------------------------------
// Group Resources
// ---------------------------------------------------------------------------

export async function getGroupResources(orgId: number, groupId: number, access_token: string) {
  const result = await secureFetch(
    `${getAPIUrl()}payments/${encodeURIComponent(String(orgId))}/groups/${encodeURIComponent(String(groupId))}/resources`,
    RequestBodyWithAuthHeader('GET', null, null, access_token)
  );
  return getResponseMetadata(result);
}

export async function addGroupResource(orgId: number, groupId: number, resourceUuid: string, access_token: string) {
  const result = await secureFetch(
    `${getAPIUrl()}payments/${encodeURIComponent(String(orgId))}/groups/${encodeURIComponent(String(groupId))}/resources?resource_uuid=${encodeURIComponent(resourceUuid)}`,
    RequestBodyWithAuthHeader('POST', null, null, access_token)
  );
  return getResponseMetadata(result);
}

export async function removeGroupResource(orgId: number, groupId: number, resourceUuid: string, access_token: string) {
  const result = await secureFetch(
    `${getAPIUrl()}payments/${encodeURIComponent(String(orgId))}/groups/${encodeURIComponent(String(groupId))}/resources?resource_uuid=${encodeURIComponent(resourceUuid)}`,
    RequestBodyWithAuthHeader('DELETE', null, null, access_token)
  );
  return getResponseMetadata(result);
}

// ---------------------------------------------------------------------------
// Group Syncs (UserGroup bridge)
// ---------------------------------------------------------------------------

export async function getGroupSyncs(orgId: number, groupId: number, access_token: string) {
  const result = await secureFetch(
    `${getAPIUrl()}payments/${encodeURIComponent(String(orgId))}/groups/${encodeURIComponent(String(groupId))}/sync`,
    RequestBodyWithAuthHeader('GET', null, null, access_token)
  );
  return getResponseMetadata(result);
}

export async function addGroupSync(orgId: number, groupId: number, usergroupId: number, access_token: string) {
  const result = await secureFetch(
    `${getAPIUrl()}payments/${encodeURIComponent(String(orgId))}/groups/${encodeURIComponent(String(groupId))}/sync?usergroup_id=${encodeURIComponent(String(usergroupId))}`,
    RequestBodyWithAuthHeader('POST', null, null, access_token)
  );
  return getResponseMetadata(result);
}

export async function removeGroupSync(orgId: number, groupId: number, usergroupId: number, access_token: string) {
  const result = await secureFetch(
    `${getAPIUrl()}payments/${encodeURIComponent(String(orgId))}/groups/${encodeURIComponent(String(groupId))}/sync?usergroup_id=${encodeURIComponent(String(usergroupId))}`,
    RequestBodyWithAuthHeader('DELETE', null, null, access_token)
  );
  return getResponseMetadata(result);
}

// ---------------------------------------------------------------------------
// Offer direct resources
// ---------------------------------------------------------------------------

export async function getOfferResources(orgId: number, offerId: number, access_token: string) {
  const result = await secureFetch(
    `${getAPIUrl()}payments/${encodeURIComponent(String(orgId))}/offers/${encodeURIComponent(String(offerId))}/resources`,
    RequestBodyWithAuthHeader('GET', null, null, access_token)
  );
  return getResponseMetadata(result);
}

export async function addOfferResource(orgId: number, offerId: number, resourceUuid: string, access_token: string) {
  const result = await secureFetch(
    `${getAPIUrl()}payments/${encodeURIComponent(String(orgId))}/offers/${encodeURIComponent(String(offerId))}/resources?resource_uuid=${encodeURIComponent(resourceUuid)}`,
    RequestBodyWithAuthHeader('POST', null, null, access_token)
  );
  return getResponseMetadata(result);
}

export async function removeOfferResource(orgId: number, offerId: number, resourceUuid: string, access_token: string) {
  const result = await secureFetch(
    `${getAPIUrl()}payments/${encodeURIComponent(String(orgId))}/offers/${encodeURIComponent(String(offerId))}/resources?resource_uuid=${encodeURIComponent(resourceUuid)}`,
    RequestBodyWithAuthHeader('DELETE', null, null, access_token)
  );
  return getResponseMetadata(result);
}
