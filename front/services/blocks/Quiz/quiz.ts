import { getAPIUrl } from "@services/config";
import { RequestBody, RequestBodyForm } from "@services/utils/requests";


export async function submitQuizBlock(lecture_id: string, data: any) {
  const result: any = await fetch(`${getAPIUrl()}blocks/quiz/${lecture_id}"`, RequestBody("POST", data))
    .then((result) => result.json())
    .catch((error) => console.log("error", error));
  return result;
}