import { getAPIUrl } from "@services/config/config";
import { RequestBody } from "@services/utils/ts/requests";


export async function submitQuizBlock(activity_id: string, data: any) {
  const result: any = await fetch(`${getAPIUrl()}blocks/quiz/${activity_id}"`, RequestBody("POST", data, null))
    .then((result) => result.json())
    .catch((error) => console.log("error", error));
  return result;
}