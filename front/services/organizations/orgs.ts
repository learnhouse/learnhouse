import { getAPIUrl } from "@services/config/config";
import { RequestBody } from "../utils/requests";

/*
 This file includes only POST, PUT, DELETE requests
 GET requests are called from the frontend using SWR (https://swr.vercel.app/)
*/

export async function createNewOrganization(body: any) {
  return fetch(`${getAPIUrl()}orgs/`, RequestBody("POST", body))
    .then((result) => result.json())
    .catch((error) => console.log("error", error));
}

export async function deleteOrganizationFromBackend(org_id: any) {
  return fetch(`${getAPIUrl()}orgs/${org_id}`, RequestBody("DELETE", null))
    .then((result) => result.json())
    .catch((error) => console.log("error", error));
}

export async function getOrganizationContextInfo(org_slug: any) {
  return fetch(`${getAPIUrl()}orgs/slug/${org_slug}`, RequestBody("GET", null))
    .then((result) => result.json())
    .catch((error) => console.log("error", error));
}
