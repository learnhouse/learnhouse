import { getAPIUrl } from "@services/config/config";
import { RequestBody, errorHandling } from "@services/utils/ts/requests";

export async function getUser(user_id: string) {
  const result = await fetch(`${getAPIUrl()}users/user_id/${user_id}`, RequestBody("GET", null, null));
  const res = await errorHandling(result);
  return res;
}