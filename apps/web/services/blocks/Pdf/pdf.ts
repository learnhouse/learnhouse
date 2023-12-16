import { getAPIUrl } from "@services/config/config";
import { RequestBody, RequestBodyForm } from "@services/utils/ts/requests";

export async function uploadNewPDFFile(file: any, activity_uuid: string) {
  // Send file thumbnail as form data
  const formData = new FormData();
  formData.append("file_object", file);
  formData.append("activity_uuid", activity_uuid);

  return fetch(`${getAPIUrl()}blocks/pdf`, RequestBodyForm("POST", formData, null))
    .then((result) => result.json())
    .catch((error) => console.log("error", error));
}

export async function getPDFFile(file_id: string) {
  // todo : add course id to url
  return fetch(`${getAPIUrl()}blocks/pdf?file_id=${file_id}`, RequestBody("GET", null, null))
    .then((result) => result.json())
    .catch((error) => console.log("error", error));
}
