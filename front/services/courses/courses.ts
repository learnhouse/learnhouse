import { getAPIUrl } from "../config";

/*
 This file includes only POST, PUT, DELETE requests
 GET requests are called from the frontend using SWR (https://swr.vercel.app/)
*/

export async function getOrgCourses(org_id: number) {
  const HeadersConfig = new Headers({ "Content-Type": "application/json" });

  const requestOptions: any = {
    method: "GET",
    headers: HeadersConfig,
    redirect: "follow",
    credentials: "include",
  };

  return fetch(`${getAPIUrl()}courses/${org_id}/page/1/limit/10`, requestOptions)
    .then((result) => result.json())
    .catch((error) => console.log("error", error));
}

export async function getCourse(course_id: string) {
  const HeadersConfig = new Headers({ "Content-Type": "application/json" });

  const requestOptions: any = {
    method: "GET",
    headers: HeadersConfig,
    redirect: "follow",
    credentials: "include",
  };

  // todo : add course id to url
  return fetch(`${getAPIUrl()}courses/${course_id}`, requestOptions)
    .then((result) => result.json())
    .catch((error) => console.log("error", error));
}


export async function createNewCourse(org_id: string, course_body: any, thumbnail: any) {
  const HeadersConfig = new Headers();

  // Send file thumbnail as form data
  const formData = new FormData();
  formData.append("thumbnail", thumbnail);
  formData.append("name", course_body.name);
  formData.append("description", course_body.description);
  formData.append("mini_description", "course_body.mini_description");
  formData.append("public", "true");

  const requestOptions: any = {
    method: "POST",
    headers: HeadersConfig,
    redirect: "follow",
    credentials: "include",
    body: formData,
  };

  return fetch(`${getAPIUrl()}courses/?org_id=${org_id}`, requestOptions)
    .then((result) => result.json())
    .catch((error) => console.log("error", error));
}

export async function deleteCourseFromBackend(course_id: any) {
  const HeadersConfig = new Headers({ "Content-Type": "application/json" });

  const requestOptions: any = {
    method: "DELETE",
    headers: HeadersConfig,
    redirect: "follow",
    credentials: "include",
  };

  return fetch(`${getAPIUrl()}courses/${course_id}`, requestOptions)
    .then((result) => result.json())
    .catch((error) => console.log("error", error));
}
