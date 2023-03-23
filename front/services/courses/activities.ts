import { getAPIUrl } from "@services/config/config";
import { RequestBody, RequestBodyForm } from "@services/utils/requests";

export async function createActivity(data: any, chapter_id: any, org_id: any) {
  data.content = {};
  // remove chapter_id from data
  delete data.chapterId;
  

  const result: any = await fetch(`${getAPIUrl()}activities/?coursechapter_id=${chapter_id}&org_id=${org_id}`, RequestBody("POST", data))
    .then((result) => result.json())
    .catch((error) => console.log("error", error));

  console.log("result", result);

  return result;
}

export async function createFileActivity(file: File, type: string, data: any, chapter_id: any) {
  // Send file thumbnail as form data
  const formData = new FormData();
  formData.append("coursechapter_id", chapter_id);

  let endpoint = `${getAPIUrl()}activities/video`;

  if (type === "video") {
    formData.append("name", data.name);
    formData.append("video_file", file);
    endpoint = `${getAPIUrl()}activities/video`;
  }

  const result: any = await fetch(endpoint, RequestBodyForm("POST", formData))
    .then((result) => result.json())
    .catch((error) => console.log("error", error));

  console.log("result", result);

  return result;
}

export async function getActivity(activity_id: any) {
  const result: any = await fetch(`${getAPIUrl()}activities/${activity_id}`, RequestBody("GET", null))
    .then((result) => result.json())
    .catch((error) => console.log("error", error));

  return result;
}

export async function updateActivity(data: any, activity_id: any) {
  const result: any = await fetch(`${getAPIUrl()}activities/${activity_id}`, RequestBody("PUT", data))
    .then((result) => result.json())
    .catch((error) => console.log("error", error));

  return result;
}
