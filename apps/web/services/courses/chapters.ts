import { OrderPayload } from "@components/Dashboard/EditCourseStructure/EditCourseStructure";
import { getAPIUrl } from "@services/config/config";
import { RequestBody, RequestBodyWithAuthHeader, errorHandling } from "@services/utils/ts/requests";

/*
 This file includes only POST, PUT, DELETE requests
 GET requests are called from the frontend using SWR (https://swr.vercel.app/)
*/

//TODO : depreciate this function
export async function getCourseChaptersMetadata(course_uuid: any, next: any) {
  const result = await fetch(`${getAPIUrl()}chapters/meta/course_${course_uuid}`, RequestBody("GET", null, next));
  const res = await errorHandling(result);
  return res;
}

export async function updateChaptersMetadata(course_uuid: any, data: any) {
  const result: any = await fetch(`${getAPIUrl()}chapters/course/course_${course_uuid}/order`, RequestBody("PUT", data, null));
  const res = await errorHandling(result);
  return res;
}

export async function updateChapter(coursechapter_id: any, data: any) {
  const result: any = await fetch(`${getAPIUrl()}chapters/${coursechapter_id}`, RequestBody("PUT", data, null));
  const res = await errorHandling(result);
  return res;
}

export async function updateCourseOrderStructure(course_uuid: any, data: OrderPayload) {
  const result: any = await fetch(`${getAPIUrl()}chapters/course/${course_uuid}/order`, RequestBody("PUT", data, null));
  const res = await errorHandling(result);
  return res;
}

export async function createChapter(data: any) {
  const result: any = await fetch(`${getAPIUrl()}chapters/`, RequestBody("POST", data, null));
  const res = await errorHandling(result);

  return res;
}

export async function deleteChapter(coursechapter_id: any) {
  const result: any = await fetch(`${getAPIUrl()}chapters/${coursechapter_id}`, RequestBody("DELETE", null, null));
  const res = await errorHandling(result);
  return res;
}
