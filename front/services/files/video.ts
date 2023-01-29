import { getAPIUrl } from "@services/config";

export async function uploadNewVideoFile(file: any, lecture_id: string) {
  const HeadersConfig = new Headers();

  // Send file thumbnail as form data
  const formData = new FormData();
  formData.append("file_object", file);
  formData.append("lecture_id", lecture_id);

  const requestOptions: any = {
    method: "POST",
    headers: HeadersConfig,
    redirect: "follow",
    credentials: "include",
    body: formData,
  };

  return fetch(`${getAPIUrl()}files/video`, requestOptions)
    .then((result) => result.json())
    .catch((error) => console.log("error", error));
}

export async function getVideoFile(file_id: string) {
  const HeadersConfig = new Headers({ "Content-Type": "application/json" });

  const requestOptions: any = {
    method: "GET",
    headers: HeadersConfig,
    redirect: "follow",
    credentials: "include",
  };

  
  return fetch(`${getAPIUrl()}files/video?file_id=${file_id}`, requestOptions)
    .then((result) => result.json())
    .catch((error) => console.log("error", error));
}