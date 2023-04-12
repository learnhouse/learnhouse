import { getAPIUrl } from "../config/config";
import { RequestBody, errorHandling } from "@services/utils/ts/requests";

/*
 This file includes only POST, PUT, DELETE requests
 GET requests are called from the frontend using SWR (https://swr.vercel.app/)
*/

export async function deleteCollection(collection_id: any) {
  const result: any = await fetch(`${getAPIUrl()}collections/${collection_id}`, RequestBody("DELETE", null));
  const res = await errorHandling(result);
  return res;
}

// Create a new collection
export async function createCollection(collection: any) {
  const result: any = await fetch(`${getAPIUrl()}collections/`, RequestBody("POST", collection));
  const res = await errorHandling(result);
  return res;
}
