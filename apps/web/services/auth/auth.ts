import { getAPIUrl } from "@services/config/config";
import { NextApiRequestCookies } from "next/dist/server/api-utils";

interface LoginAndGetTokenResponse {
  access_token: "string";
  token_type: "string";
}

// ⚠️ mvp phase code
// TODO : everything in this file need to be refactored including security issues fix

export async function loginAndGetToken(username: string, password: string): Promise<any> {
  // Request Config

  // get origin
  const HeadersConfig = new Headers({ "Content-Type": "application/x-www-form-urlencoded" });
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
  return response;
}

export async function getUserInfo(token: string): Promise<any> {
  const origin = window.location.origin;
  const HeadersConfig = new Headers({ Authorization: `Bearer ${token}`, Origin: origin });

  const requestOptions: any = {
    method: "GET",
    headers: HeadersConfig,
    redirect: "follow",
    credentials: "include",
  };

  return fetch(`${getAPIUrl()}users/profile`, requestOptions)
    .then((result) => result.json())
    .catch((error) => console.log("error", error));
}

export async function getNewAccessTokenUsingRefreshToken(): Promise<any> {
  const requestOptions: any = {
    method: "POST",
    redirect: "follow",
    credentials: "include",
  };

  return fetch(`${getAPIUrl()}auth/refresh`, requestOptions)
    .then((result) => result.json())
    .catch((error) => console.log("error", error));
}

export async function getNewAccessTokenUsingRefreshTokenServer(refresh_token_cookie: any): Promise<any> {
  const requestOptions: any = {
    method: "POST",
    redirect: "follow",
    headers: {
      Cookie: `refresh_token_cookie=${refresh_token_cookie}`,
    },
    credentials: "include",
  };
  return fetch(`${getAPIUrl()}auth/refresh`, requestOptions)
    .then((result) => result.json())
    .catch((error) => console.log("error", error));
}

// cookies

export async function getAccessTokenFromRefreshTokenCookie(cookieStore: any) {
  const refresh_token_cookie: any = cookieStore.get("refresh_token_cookie");
  const access_token_cookie: any = await getNewAccessTokenUsingRefreshTokenServer(refresh_token_cookie?.value);
  return access_token_cookie && refresh_token_cookie ? access_token_cookie.access_token : null;
}

// signup

interface NewAccountBody {
  username: string;
  email: string;
  password: string;
  org_slug: string;
}

export async function signup(body: NewAccountBody): Promise<any> {
  const HeadersConfig = new Headers({ "Content-Type": "application/json" });

  const requestOptions: any = {
    method: "POST",
    headers: HeadersConfig,
    body: JSON.stringify(body),
    redirect: "follow",
  };

  const res = await fetch(`${getAPIUrl()}users/?org_slug=${body.org_slug}`, requestOptions);
  return res;
}
