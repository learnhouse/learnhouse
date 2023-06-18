import { getAPIUrl } from "@services/config/config";
import { RequestBody, errorHandling } from "@services/utils/ts/requests";

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

export function getOrganizationContextInfoNoAsync(org_slug: any, next: any) {
  const result = fetch(`${getAPIUrl()}orgs/slug/${org_slug}`, RequestBody("GET", null, next));
  return result;
}