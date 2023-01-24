import { initialData } from "../../components/Drags/data";
import { getAPIUrl } from "@services/config";

export async function getCourseChaptersMetadata(course_id: any) {
  const HeadersConfig = new Headers({ "Content-Type": "application/json" });

  const requestOptions: any = {
    method: "GET",
    headers: HeadersConfig,
    redirect: "follow",
    credentials: "include",
  };

  const data: any = await fetch(`${getAPIUrl()}chapters/meta/course_${course_id}`, requestOptions)
    .then((result) => result.json())
    .catch((error) => console.log("error", error));

  console.log("data", data);
  
  return data;
}

export async function updateChaptersMetadata(course_id: any, data: any) {
  const HeadersConfig = new Headers({ "Content-Type": "application/json" });

  const requestOptions: any = {
    method: "PUT",
    headers: HeadersConfig,
    redirect: "follow",
    credentials: "include",
    body: JSON.stringify(data),
  };

  const result: any = await fetch(`${getAPIUrl()}chapters/meta/course_${course_id}`, requestOptions)
    .then((result) => result.json())
    .catch((error) => console.log("error", error));

  console.log("result", result);
  
  return result;
}

export async function createChapter(data: any, course_id: any) {
  console.log("data", data, course_id);
  
  const HeadersConfig = new Headers({ "Content-Type": "application/json" });

  const requestOptions: any = {
    method: "POST",
    headers: HeadersConfig,
    redirect: "follow",
    credentials: "include",
    body: JSON.stringify(data),
  };

  const result: any = await fetch(`${getAPIUrl()}chapters/?course_id=course_${course_id}`, requestOptions)
    .then((result) => result.json())
    .catch((error) => console.log("error", error));

  console.log("result", result);
  
  return result;
}

export async function deleteChapter (coursechapter_id: any) {
  const HeadersConfig = new Headers({ "Content-Type": "application/json" });

  const requestOptions: any = {
    method: "DELETE",
    headers: HeadersConfig,
    redirect: "follow",
    credentials: "include",
  };

  const result: any = await fetch(`${getAPIUrl()}chapters/${coursechapter_id}`, requestOptions)
    .then((result) => result.json())
    .catch((error) => console.log("error", error));

  console.log("result", result);
  
  return result;
}
