import { getAPIUrl } from "@services/config/config";
import { RequestBody, RequestBodyForm } from "@services/utils/requests";

/*
 This file includes only POST, PUT, DELETE requests
 GET requests are called from the frontend using SWR (https://swr.vercel.app/)
*/

export async function getOrgCourses(org_id: number) {
  

  return fetch(`${getAPIUrl()}courses/${org_id}/page/1/limit/10`, RequestBody("GET", null))
    .then((result) => result.json())
    .catch((error) => console.log("error", error));
}

export async function getCourse(course_id: string) {
  // todo : add course id to url
  return fetch(`${getAPIUrl()}courses/${course_id}`, RequestBody("GET", null))
    .then((result) => result.json())
    .catch((error) => console.log("error", error));
}


export async function createNewCourse(org_id: string, course_body: any, thumbnail: any) {

  // Send file thumbnail as form data
  const formData = new FormData();
  formData.append("thumbnail", thumbnail);
  formData.append("name", course_body.name);
  formData.append("description", course_body.description);
  formData.append("mini_description", "course_body.mini_description");
  formData.append("public", "true");


  return fetch(`${getAPIUrl()}courses/?org_id=${org_id}`, RequestBodyForm("POST", formData))
    .then((result) => result.json())
    .catch((error) => console.log("error", error));
}

export async function deleteCourseFromBackend(course_id: any) {
  

  return fetch(`${getAPIUrl()}courses/${course_id}`, RequestBody("DELETE", null))
    .then((result) => result.json())
    .catch((error) => console.log("error", error));
}
