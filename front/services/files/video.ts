import { getAPIUrl } from "@services/config";
import { RequestBody, RequestBodyForm } from "@services/utils/requests";

export async function uploadNewVideoFile(file: any, lecture_id: string) {
  // Send file thumbnail as form data
  const formData = new FormData();
  formData.append("file_object", file);
  formData.append("lecture_id", lecture_id);

  return fetch(`${getAPIUrl()}blocks/video`, RequestBodyForm("POST", formData))
    .then((result) => result.json())
    .catch((error) => console.log("error", error));
}

export async function getVideoFile(file_id: string) {
  return fetch(`${getAPIUrl()}blocks/video?file_id=${file_id}`, RequestBody("GET", null))
    .then((result) => result.json())
    .catch((error) => console.log("error", error));
}
