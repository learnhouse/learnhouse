import { getAPIUrl } from "./config";

export async function getOrgCollections(org_slug: any) {
  const HeadersConfig = new Headers({ "Content-Type": "application/json" });

  const requestOptions: any = {
    method: "GET",
    headers: HeadersConfig,
    redirect: "follow",
    credentials: "include",
  };

  return fetch(`${getAPIUrl()}collections/page/1/limit/10`, requestOptions)
    .then((result) => result.json())
    .catch((error) => console.log("error", error));
}

export async function getCollection(collection_slug: any) {
  const HeadersConfig = new Headers({ "Content-Type": "application/json" });

  const requestOptions: any = {
    method: "GET",
    headers: HeadersConfig,
    redirect: "follow",
    credentials: "include",
  };

  return fetch(
    `${getAPIUrl()}collections/${collection_slug}`,
    requestOptions
  )
    .then((result) => result.json())
    .catch((error) => console.log("error", error));
}





export async function deleteCollection(collection_id: any) {
  const HeadersConfig = new Headers({ "Content-Type": "application/json" });

  const requestOptions: any = {
    method: "DELETE",
    headers: HeadersConfig,
    redirect: "follow",
    credentials: "include",
  };

  return fetch(
    `${getAPIUrl()}collections/${collection_id}`,
    requestOptions
  )
    .then((result) => result.json())
    .catch((error) => console.log("error", error));
}

// Create a new collection
export async function createCollection(collection: any) {
  const HeadersConfig = new Headers({ "Content-Type": "application/json" });

  const requestOptions: any = {
    method: "POST",
    headers: HeadersConfig,
    redirect: "follow",
    credentials: "include",
    body: JSON.stringify(collection),
  };

  return fetch(`${getAPIUrl()}collections/`, requestOptions)
    .then((result) => result.json())
    .catch((error) => console.log("error", error));
}