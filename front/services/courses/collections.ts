import { getAPIUrl } from "../config/config";
import { RequestBody } from "../utils/ts/requests";

/*
 This file includes only POST, PUT, DELETE requests
 GET requests are called from the frontend using SWR (https://swr.vercel.app/)
*/

export async function deleteCollection(collection_id: any) {
  return fetch(`${getAPIUrl()}collections/${collection_id}`, RequestBody("DELETE", null))
    .then((result) => result.json())
    .catch((error) => console.log("error", error));
}

// Create a new collection
export async function createCollection(collection: any) {
  return fetch(`${getAPIUrl()}collections/`, RequestBody("POST", collection))
    .then((result) => result.json())
    .catch((error) => console.log("error", error));
}
