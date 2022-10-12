import { getAPIUrl } from "./config";

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

export async function getCourse(org_id: any, course_id: any) {
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
