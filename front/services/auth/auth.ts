import { getAPIUrl } from "../config";

interface LoginAndGetTokenResponse {
  access_token: "string";
  token_type: "string";
}

// ⚠️ mvp phase code 
// TODO : everything in this file need to be refactored including security issues fix 

export async function loginAndGetToken(username: string, password: string): Promise<LoginAndGetTokenResponse> {
  // Request Config
  const HeadersConfig = new Headers({ "Content-Type": "application/x-www-form-urlencoded" , Origin: "http://localhost:3000" });
  const urlencoded = new URLSearchParams({ username: username, password: password });

  const requestOptions: any = {
    method: "POST",
    headers: HeadersConfig,
    body: urlencoded,
    redirect: "follow",
    credentials: "include",
  };  

  // fetch using await and async
  const response = await fetch(`${getAPIUrl()}auth/login`, requestOptions);
  const data = await response.json();
  return data;
}

export async function getUserInfo(token: string): Promise<any> {
  const HeadersConfig = new Headers({ Authorization: `Bearer ${token}`, Origin: "http://localhost:3000" });

  const requestOptions: any = {
    method: "GET",
    headers: HeadersConfig,
    redirect: "follow",
    credentials: "include",
  };

  return fetch(`${getAPIUrl()}users/profile_metadata`, requestOptions)
    .then((result) => result.json())
    .catch((error) => console.log("error", error));
}

export async function getRefreshToken(): Promise<any> {
  const requestOptions: any = {
    method: "POST",
    redirect: "follow",
    credentials: "include",
  };

  return fetch(`${getAPIUrl()}auth/refresh`, requestOptions)
    .then((result) => result.json())
    .catch((error) => console.log("error", error));
}

// signup

interface NewAccountBody {
  username: string;
  email: string;
  password: string;
}

export async function signup(body: NewAccountBody): Promise<any> {
  const HeadersConfig = new Headers({ "Content-Type": "application/json" });
  
  const requestOptions: any = {
    method: "POST",
    headers: HeadersConfig,
    body: JSON.stringify(body),
    redirect: "follow",
  };

  return fetch(`${getAPIUrl()}users/`, requestOptions)
    .then((result) => result.json())
    .catch((error) => console.log("error", error));
}


