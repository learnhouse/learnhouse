import { getAPIUrl } from "../config";

export async function uploadNewImageFile(file: any, element_id: string) {
  const HeadersConfig = new Headers();

  // Send file thumbnail as form data
  const formData = new FormData();
  formData.append("file_object", file);
  formData.append("element_id", element_id);

  const requestOptions: any = {
    method: "POST",
    headers: HeadersConfig,
    redirect: "follow",
    credentials: "include",
    body: formData,
  };

  return fetch(`${getAPIUrl()}files/picture`, requestOptions)
    .then((result) => result.json())
    .catch((error) => console.log("error", error));
}

export async function getImageFile(file_id: string) {
  const HeadersConfig = new Headers({ "Content-Type": "application/json" });

  const requestOptions: any = {
    method: "GET",
    headers: HeadersConfig,
    redirect: "follow",
    credentials: "include",
  };

  // todo : add course id to url
  return fetch(`${getAPIUrl()}files/picture?file_id=${file_id}`, requestOptions)
    .then((result) => result.json())
    .catch((error) => console.log("error", error));
}