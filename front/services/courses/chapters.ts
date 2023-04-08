import { initialData } from "../../components/Pages/CourseEdit/Draggables/data";
import { getAPIUrl } from "@services/config/config";
import { RequestBody } from "@services/utils/requests";

/*
 This file includes only POST, PUT, DELETE requests
 GET requests are called from the frontend using SWR (https://swr.vercel.app/)
*/

//TODO : depreciate this function
export async function getCourseChaptersMetadata(course_id: any) {
  const data: any = await fetch(`${getAPIUrl()}chapters/meta/course_${course_id}`, RequestBody("GET", null))
    .then((result) => result.json())
    .catch((error) => console.log("error", error));

  return data;
}

export async function updateChaptersMetadata(course_id: any, data: any) {
  const result: any = await fetch(`${getAPIUrl()}chapters/meta/course_${course_id}`, RequestBody("PUT", data))
    .then((result) => result.json())
    .catch((error) => console.log("error", error));
    
  return result;
}

export async function createChapter(data: any, course_id: any) {
  const result: any = await fetch(`${getAPIUrl()}chapters/?course_id=course_${course_id}`, RequestBody("POST", data))
    .then((result) => result.json())
    .catch((error) => console.log("error", error));

  return result;
}

export async function deleteChapter(coursechapter_id: any) {
  const result: any = await fetch(`${getAPIUrl()}chapters/${coursechapter_id}`, RequestBody("DELETE", null))
    .then((result) => result.json())
    .catch((error) => console.log("error", error));

  return result;
}
