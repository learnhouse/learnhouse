import { getAPIUrl } from "@services/config";

export async function createLecture(data: any, chapter_id: any) {
  data.content = {};
  console.log("data", data, chapter_id);

  // remove chapter_id from data
  delete data.chapterId;

  const HeadersConfig = new Headers({ "Content-Type": "application/json" });

  const requestOptions: any = {
    method: "POST",
    headers: HeadersConfig,
    redirect: "follow",
    credentials: "include",
    body: JSON.stringify(data),
  };

  const result: any = await fetch(`${getAPIUrl()}lectures/?coursechapter_id=${chapter_id}`, requestOptions)
    .then((result) => result.json())
    .catch((error) => console.log("error", error));

  console.log("result", result);

  return result;
}

export async function createFileLecture(file: File, type: string, data: any, chapter_id: any) {
  

  const HeadersConfig = new Headers();

  // Send file thumbnail as form data
  const formData = new FormData();
  formData.append("coursechapter_id", chapter_id);
  console.log("type" , type);
  

  let endpoint = `${getAPIUrl()}lectures/video`;

  if (type === "video") {
    formData.append("name", data.name);
    formData.append("video_file", file);
    endpoint = `${getAPIUrl()}lectures/video`;
  }

  console.log();
  

  const requestOptions: any = {
    method: "POST",
    headers: HeadersConfig,
    redirect: "follow",
    credentials: "include",
    body: formData,
  };

  const result: any = await fetch(endpoint, requestOptions)
    .then((result) => result.json())
    .catch((error) => console.log("error", error));

  
  
  console.log("result", result);

  return result;
}

export async function getLecture(lecture_id: any) {
  const requestOptions: any = {
    method: "GET",
    redirect: "follow",
    credentials: "include",
  };

  const result: any = await fetch(`${getAPIUrl()}lectures/${lecture_id}`, requestOptions)
    .then((result) => result.json())
    .catch((error) => console.log("error", error));

  return result;
}

export async function updateLecture(data: any, lecture_id: any) {
  const HeadersConfig = new Headers({ "Content-Type": "application/json" });

  const requestOptions: any = {
    method: "PUT",
    headers: HeadersConfig,
    redirect: "follow",
    credentials: "include",
    body: JSON.stringify(data),
  };

  const result: any = await fetch(`${getAPIUrl()}lectures/${lecture_id}`, requestOptions)
    .then((result) => result.json())
    .catch((error) => console.log("error", error));

  return result;
}
