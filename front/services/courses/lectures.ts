import { getAPIUrl } from "@services/config";
import { RequestBody, RequestBodyForm } from "@services/utils/requests";

export async function createLecture(data: any, chapter_id: any) {
  data.content = {};

  // remove chapter_id from data
  delete data.chapterId;

  const result: any = await fetch(`${getAPIUrl()}lectures/?coursechapter_id=${chapter_id}`, RequestBody("POST", data))
    .then((result) => result.json())
    .catch((error) => console.log("error", error));

  console.log("result", result);

  return result;
}

export async function createFileLecture(file: File, type: string, data: any, chapter_id: any) {
  // Send file thumbnail as form data
  const formData = new FormData();
  formData.append("coursechapter_id", chapter_id);

  let endpoint = `${getAPIUrl()}lectures/video`;

  if (type === "video") {
    formData.append("name", data.name);
    formData.append("video_file", file);
    endpoint = `${getAPIUrl()}lectures/video`;
  }

  const result: any = await fetch(endpoint, RequestBodyForm("POST", formData))
    .then((result) => result.json())
    .catch((error) => console.log("error", error));

  console.log("result", result);

  return result;
}

export async function getLecture(lecture_id: any) {
  const result: any = await fetch(`${getAPIUrl()}lectures/${lecture_id}`, RequestBody("GET", null))
    .then((result) => result.json())
    .catch((error) => console.log("error", error));

  return result;
}

export async function updateLecture(data: any, lecture_id: any) {
  const result: any = await fetch(`${getAPIUrl()}lectures/${lecture_id}`, RequestBody("PUT", data))
    .then((result) => result.json())
    .catch((error) => console.log("error", error));

  return result;
}
