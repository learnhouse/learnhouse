import { getAPIUrl } from "@services/config/config";
import { RequestBody, errorHandling } from "@services/utils/ts/requests";

/*
 This file includes only POST, PUT, DELETE requests
 GET requests are called from the frontend using SWR (https://swr.vercel.app/)
*/

export async function updateOrganization(org_id: string, data: any) {
  const result: any = await fetch(`${getAPIUrl()}orgs/` + org_id, RequestBody("PUT", data));
  const res = await errorHandling(result);
  return res;
}
