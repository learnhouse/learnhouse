import { getAPIUrl } from "../config/config";
import { RequestBody, errorHandling } from "@services/utils/ts/requests";

/*
 This file includes only POST, PUT, DELETE requests
 GET requests are called from the frontend using SWR (https://swr.vercel.app/)
*/

export async function deleteCollection(collection_id: any) {
  const result: any = await fetch(`${getAPIUrl()}collections/${collection_id}`, RequestBody("DELETE", null, null));
  const res = await errorHandling(result);
  return res;
}

// Create a new collection
export async function createCollection(collection: any) {
  const result: any = await fetch(`${getAPIUrl()}collections/`, RequestBody("POST", collection, null));
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

