import { getAPIUrl } from "../config/config";
import { RequestBody, RequestBodyWithAuthHeader, errorHandling } from "@services/utils/ts/requests";

/*
 This file includes only POST, PUT, DELETE requests
 GET requests are called from the frontend using SWR (https://swr.vercel.app/)
*/

export async function deleteCollection(collection_uuid: any) {
  const result: any = await fetch(`${getAPIUrl()}collections/${collection_uuid}`, RequestBody("DELETE", null, null));
  const res = await errorHandling(result);
  return res;
}

// Create a new collection
export async function createCollection(collection: any) {
  const result: any = await fetch(`${getAPIUrl()}collections/`, RequestBody("POST", collection, null));
  const res = await errorHandling(result);
  return res;
}

// Get a colletion by id
export async function getCollectionById(collection_uuid: any) {
  const result: any = await fetch(`${getAPIUrl()}collections/${collection_uuid}`, { next: { revalidate: 10 } });
  const res = await errorHandling(result);
  return res;
}

export async function getCollectionByIdWithAuthHeader(collection_uuid: any, access_token: string, next: any) {
  const result: any = await fetch(`${getAPIUrl()}collections/collection_${collection_uuid}`, RequestBodyWithAuthHeader("GET", null, next, access_token));
  const res = await errorHandling(result);
  return res;
}

// Get collections
// TODO : add per org filter
export async function getOrgCollections() {
  const result: any = await fetch(`${getAPIUrl()}collections/page/1/limit/10`, { next: { revalidate: 10 } });
  const res = await errorHandling(result);
  return res;
}

export async function getOrgCollectionsWithAuthHeader(org_id: string, access_token: string, next: any) {
  const result: any = await fetch(`${getAPIUrl()}collections/org/${org_id}/page/1/limit/10`, RequestBodyWithAuthHeader("GET", null, next, access_token));
  const res = await errorHandling(result);
  return res;
}
