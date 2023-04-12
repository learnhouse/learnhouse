import { RequestBody, errorHandling } from "@services/utils/ts/requests";
import { getAPIUrl } from "@services/config/config";

/*
 This file includes only POST, PUT, DELETE requests
 GET requests are called from the frontend using SWR (https://swr.vercel.app/)
*/

export async function startCourse(course_id: string, org_slug: string) {
  const result: any = await fetch(`${getAPIUrl()}trail/org_slug/${org_slug}/add_course/${course_id}`, RequestBody("POST", null))
  const res = await errorHandling(result);
  return res;
}

export async function removeCourse(course_id: string, org_slug: string) {
  const result: any = await fetch(`${getAPIUrl()}trail/org_slug/${org_slug}/remove_course/${course_id}`, RequestBody("POST", null))
  const res = await errorHandling(result);
  return res;
}

export async function markActivityAsComplete(org_slug: string, course_id: string, activity_id: string) {
  const result: any = await fetch(`${getAPIUrl()}trail/org_slug/${org_slug}/add_activity/course_id/${course_id}/activity_id/${activity_id}`, RequestBody("POST", null))
  const res = await errorHandling(result);
  return res;
}
