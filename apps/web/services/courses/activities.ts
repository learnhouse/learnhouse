import { getAPIUrl } from "@services/config/config";
import { RequestBody, RequestBodyForm, RequestBodyWithAuthHeader } from "@services/utils/ts/requests";

export async function createActivity(data: any, chapter_id: any, org_id: any) {
  data.content = {};
  // remove chapter_id from data
  delete data.chapterId;

  const result = await fetch(`${getAPIUrl()}activities/?coursechapter_id=${chapter_id}&org_id=${org_id}`, RequestBody("POST", data, null));
  const res = await result.json();
  return res;
}

export async function createFileActivity(file: File, type: string, data: any, chapter_id: any) {
  // Send file thumbnail as form data
  const formData = new FormData();
  formData.append("coursechapter_id", chapter_id);

  let org_id = "test";
  let endpoint = "";

  if (type === "video") {
    formData.append("name", data.name);
    formData.append("video_file", file);
    endpoint = `${getAPIUrl()}activities/video?org_id=${org_id}`;
  } else if (type === "documentpdf") {
    formData.append("pdf_file", file);
    formData.append("name", data.name);
    endpoint = `${getAPIUrl()}activities/documentpdf?org_id=${org_id}`;
  } else {
    // Handle other file types here
  }

  const result: any = await fetch(endpoint, RequestBodyForm("POST", formData, null));
  const res = await result.json();
  return res;
}

export async function createExternalVideoActivity(data: any, activity: any, chapter_id: any) {
  // add coursechapter_id to data
  data.coursechapter_id = chapter_id;
  data.activity_id = activity.id;

  const result = await fetch(`${getAPIUrl()}activities/external_video?coursechapter_id=${chapter_id}`, RequestBody("POST", data, null));
  const res = await result.json();
  return res;
}

export async function getActivity(activity_id: any, next: any) {
  const result = await fetch(`${getAPIUrl()}activities/${activity_id}`, RequestBody("GET", null, next));
  const res = await result.json();
  return res;
}

export async function deleteActivity(activity_id: any) {
  const result = await fetch(`${getAPIUrl()}activities/${activity_id}`, RequestBody("DELETE", null, null));
  const res = await result.json();
  return res;
}

export async function getActivityWithAuthHeader(activity_id: any, next: any, access_token: string) {
  const result = await fetch(`${getAPIUrl()}activities/activity_${activity_id}`, RequestBodyWithAuthHeader("GET", null, next, access_token));
  const res = await result.json();
  return res;
}

export async function updateActivity(data: any, activity_id: any) {
  const result = await fetch(`${getAPIUrl()}activities/${activity_id}`, RequestBody("PUT", data, null));
  const res = await result.json();
  return res;
}
