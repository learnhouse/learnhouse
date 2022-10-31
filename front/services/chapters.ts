import { initialData } from "../components/drags/data";
import { getAPIUrl } from "./config";

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
