import { RequestBody } from "@services/utils/requests";
import { getAPIUrl } from "../config";

/*
 This file includes only POST, PUT, DELETE requests
 GET requests are called from the frontend using SWR (https://swr.vercel.app/)
*/

export async function createActivity(course_id: string) {
  let data = {
    course_id: course_id,
  };
  const result: any = await fetch(`${getAPIUrl()}activity/start`, RequestBody("POST", data))
    .then((result) => result.json())
    .catch((error) => console.log("error", error));
  return result;
}

export async function closeActivity(org_id: string, activity_id: string) {
  const result: any = await fetch(`${getAPIUrl()}activity/${org_id}/close_activity/${activity_id}"`, RequestBody("PATCH", null))
    .then((result) => result.json())
    .catch((error) => console.log("error", error));
  return result;
}

export async function maskLectureAsComplete(org_id: string, course_id: string, lecture_id: string) {
  const result: any = await fetch(`${getAPIUrl()}activity/${org_id}/add_lecture/${course_id}/${lecture_id}`, RequestBody("POST", null))
    .then((result) => result.json())
    .catch((error) => console.log("error", error));
  return result;
}
