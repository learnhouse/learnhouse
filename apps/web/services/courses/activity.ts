import { RequestBody, errorHandling } from "@services/utils/ts/requests";
import { getAPIUrl } from "@services/config/config";

/*
 This file includes only POST, PUT, DELETE requests
 GET requests are called from the frontend using SWR (https://swr.vercel.app/)
*/

export async function startCourse(course_uuid: string, org_slug: string) {
  const result: any = await fetch(`${getAPIUrl()}trail/add_course/${course_uuid}`, RequestBody("POST", null, null))
  const res = await errorHandling(result);
  return res;
}

export async function removeCourse(course_uuid: string, org_slug: string) {
  const result: any = await fetch(`${getAPIUrl()}trail/remove_course/${course_uuid}`, RequestBody("DELETE", null, null))
  const res = await errorHandling(result);
  return res;
}

export async function markActivityAsComplete(org_slug: string, course_uuid: string, activity_id: string) {
  const result: any = await fetch(`${getAPIUrl()}trail/add_activity/${activity_id}`, RequestBody("POST", null, null))
  const res = await errorHandling(result);
  return res;
}
