import { getAPIUrl } from "../config";

export async function createElement(data: any, chapter_id: any) {
    data.content = {}
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
  
    const result: any = await fetch(`${getAPIUrl()}elements/?coursechapter_id=${chapter_id}`, requestOptions)
      .then((result) => result.json())
      .catch((error) => console.log("error", error));
  
    console.log("result", result);
    
    return result;
  }

  export async function getElement(element_id: any) {
    const requestOptions: any = {
      method: "GET",
      redirect: "follow",
      credentials: "include",
    };
  
    const result: any = await fetch(`${getAPIUrl()}elements/${element_id}`, requestOptions)
      .then((result) => result.json())
      .catch((error) => console.log("error", error));
  
    return result;
  }

  export async function updateElement(data: any, element_id: any) {
    const HeadersConfig = new Headers({ "Content-Type": "application/json" });
  
    const requestOptions: any = {
      method: "PUT",
      headers: HeadersConfig,
      redirect: "follow",
      credentials: "include",
      body: JSON.stringify(data),
    };
  
    const result: any = await fetch(`${getAPIUrl()}elements/${element_id}`, requestOptions)
      .then((result) => result.json())
      .catch((error) => console.log("error", error));
  
    return result;
  }