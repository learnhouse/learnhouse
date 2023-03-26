import { RequestBody } from "@services/utils/requests";
import { getAPIUrl } from "@services/config/config";

/*
 This file includes only POST, PUT, DELETE requests
 GET requests are called from the frontend using SWR (https://swr.vercel.app/)
*/

export async function startCourse(course_id: string, org_slug: string) {
  const result: any = await fetch(`${getAPIUrl()}trail/${org_slug}/add_course/${course_id}`, RequestBody("POST", null))
    .then((result) => result.json())
    .catch((error) => console.log("error", error));
  return result;
}

export async function removeCourse(course_id: string, org_slug: string) {
  const result: any = await fetch(`${getAPIUrl()}trail/${org_slug}/remove_course/${course_id}`, RequestBody("POST", null))
    .then((result) => result.json())
    .catch((error) => console.log("error", error));
  return result;
}

export async function maskActivityAsComplete(org_id: string, course_id: string, activity_id: string) {
  const result: any = await fetch(`${getAPIUrl()}activity/${org_id}/add_activity/${course_id}/${activity_id}`, RequestBody("POST", null))
    .then((result) => result.json())
    .catch((error) => console.log("error", error));
  return result;
}
