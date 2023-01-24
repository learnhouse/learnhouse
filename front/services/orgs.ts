import { getAPIUrl } from "@services/config";

/*
 This file includes only POST, PUT, DELETE requests
 GET requests are called from the frontend using SWR (https://swr.vercel.app/)
*/

export async function createNewOrganization(body: any) {
  const HeadersConfig = new Headers({ "Content-Type": "application/json" });

  const requestOptions: any = {
    method: "POST",
    headers: HeadersConfig,
    redirect: "follow",
    credentials: "include",
    body: JSON.stringify(body),
  };

  return fetch(`${getAPIUrl()}orgs/`, requestOptions)
    .then((result) => result.json())
    .catch((error) => console.log("error", error));
}

export async function deleteOrganizationFromBackend(org_id: any) {
  const HeadersConfig = new Headers({ "Content-Type": "application/json" });

  const requestOptions: any = {
    method: "DELETE",
    headers: HeadersConfig,
    redirect: "follow",
    credentials: "include",
  };

  return fetch(`${getAPIUrl()}orgs/${org_id}`, requestOptions)
    .then((result) => result.json())
    .catch((error) => console.log("error", error));
}


export async function getOrganizationContextInfo(org_slug : any){
  const HeadersConfig = new Headers({ "Content-Type": "application/json" });

  const requestOptions: any = {
    method: "GET",
    headers: HeadersConfig,
    redirect: "follow",
    credentials: "include",
  };

  return fetch(`${getAPIUrl()}orgs/slug/${org_slug}`, requestOptions)
    .then((result) => result.json())
    .catch((error) => console.log("error", error));

}