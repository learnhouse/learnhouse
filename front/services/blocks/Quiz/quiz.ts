import { getAPIUrl } from "@services/config/config";
import { RequestBody, RequestBodyForm } from "@services/utils/ts/requests";


export async function submitQuizBlock(activity_id: string, data: any) {
  const result: any = await fetch(`${getAPIUrl()}blocks/quiz/${activity_id}"`, RequestBody("POST", data))
    .then((result) => result.json())
    .catch((error) => console.log("error", error));
  return result;
}