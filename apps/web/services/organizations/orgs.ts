import { getAPIUrl } from "@services/config/config";
import { RequestBody, errorHandling, getResponseMetadata } from "@services/utils/ts/requests";

/*
 This file includes only POST, PUT, DELETE requests
 GET requests are called from the frontend using SWR (https://swr.vercel.app/)
*/

export async function createNewOrganization(body: any) {
  const result = await fetch(`${getAPIUrl()}orgs/`, RequestBody("POST", body, null));
  const res = await errorHandling(result);
  return res;
}

export async function deleteOrganizationFromBackend(org_id: any) {
  const result = await fetch(`${getAPIUrl()}orgs/${org_id}`, RequestBody("DELETE", null, null));
  const res = await errorHandling(result);
  return res;
}

export async function getOrganizationContextInfo(org_slug: any, next: any) {
  const result = await fetch(`${getAPIUrl()}orgs/slug/${org_slug}`, RequestBody("GET", null, next));
  const res = await errorHandling(result);
  return res;
}

export async function getOrganizationContextInfoWithId(org_id: any, next: any) {
  const result = await fetch(`${getAPIUrl()}orgs/${org_id}`, RequestBody("GET", null, next));
  const res = await errorHandling(result);
  return res;
}

export async function getOrganizationContextInfoWithoutCredentials(org_slug: any, next: any) {
  let HeadersConfig = new Headers({ "Content-Type": "application/json" });
  let options: any = {
    method: "GET",
    headers: HeadersConfig,
    redirect: "follow",
    // Next.js
    next: next,
  };

  const result = await fetch(`${getAPIUrl()}orgs/slug/${org_slug}`, options);
  const res = await errorHandling(result);
  return res;
}

export function getOrganizationContextInfoNoAsync(org_slug: any, next: any) {
  const result = fetch(`${getAPIUrl()}orgs/slug/${org_slug}`, RequestBody("GET", null, next));
  return result;
}

export async function updateUserRole(org_id: any, user_id: any, role_uuid: any) {
  const result = await fetch(`${getAPIUrl()}orgs/${org_id}/users/${user_id}/role/${role_uuid}`, RequestBody("PUT", null, null));
  const res = await getResponseMetadata(result);
  return res;
}

export async function removeUserFromOrg(org_id: any, user_id: any) {
  const result = await fetch(`${getAPIUrl()}orgs/${org_id}/users/${user_id}`, RequestBody("DELETE", null, null));
  const res = await getResponseMetadata(result);
  return res;
}
