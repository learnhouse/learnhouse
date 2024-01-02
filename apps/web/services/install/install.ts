import { getAPIUrl } from "@services/config/config";
import { RequestBody, errorHandling } from "@services/utils/ts/requests";

export async function updateInstall(body: any, step: number) {
  const result = await fetch(`${getAPIUrl()}install/update?step=${step}`, RequestBody("POST", body, null));
  const res = await errorHandling(result);
  return res;
}

export async function createNewOrgInstall(body: any) {
  const result = await fetch(`${getAPIUrl()}install/org`, RequestBody("POST", body, null));
  const res = await errorHandling(result);
  return res;
}

export async function createNewUserInstall(body: any,org_slug:string) {
  const result = await fetch(`${getAPIUrl()}install/user?org_slug=${org_slug}`, RequestBody("POST", body, null));
  const res = await errorHandling(result);
  return res;
}

export async function createSampleDataInstall(username: string, org_slug: string) {
  const result = await fetch(`${getAPIUrl()}install/sample?username=${username}&org_slug=${org_slug}`, RequestBody("POST", null, null));
  const res = await errorHandling(result);
  return res;
}

export async function createDefaultElements() {
  const result = await fetch(`${getAPIUrl()}install/default_elements`, RequestBody("POST", null, null));
  const res = await errorHandling(result);
  return res;
}

export async function isInstallModeEnabled() {
  const result = await fetch(`${getAPIUrl()}install/latest`, RequestBody("GET", null, null));
  if (result.status === 200 || result.status === 404) {
    return true;
  }
  else {
    return false;
  }
}
