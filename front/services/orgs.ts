import { getAPIUrl } from "./config";

export async function getUserOrganizations() {
  const HeadersConfig = new Headers({ "Content-Type": "application/json" });

  const requestOptions: any = {
    method: "GET",
    headers: HeadersConfig,
    redirect: "follow",
    credentials: "include",
  };

  return fetch(`${getAPIUrl()}orgs/user/page/1/limit/10`, requestOptions)
    .then((result) => result.json())
    .catch((error) => console.log("error", error));
}

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

// export async function getOrganizationData(org_id) {}

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

// export async function updateOrganization(org_id) {}
