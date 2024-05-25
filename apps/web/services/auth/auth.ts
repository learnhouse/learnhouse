import { getAPIUrl } from '@services/config/config'
import { RequestBody, getResponseMetadata } from '@services/utils/ts/requests'

interface LoginAndGetTokenResponse {
  access_token: 'string'
  token_type: 'string'
}

// ⚠️ mvp phase code
// TODO : everything in this file need to be refactored including security issues fix

export async function loginAndGetToken(
  username: any,
  password: any
): Promise<any> {
  // Request Config

  // get origin
  const HeadersConfig = new Headers({
    'Content-Type': 'application/x-www-form-urlencoded',
  })
  const urlencoded = new URLSearchParams({
    username: username,
    password: password,
  })

  const requestOptions: any = {
    method: 'POST',
    headers: HeadersConfig,
    body: urlencoded,
    redirect: 'follow',
    credentials: 'include',
  }

  // fetch using await and async
  const response = await fetch(`${getAPIUrl()}auth/login`, requestOptions)
  return response
}

export async function loginWithOAuthToken(
  email: any,
  provider: any,
  accessToken: string
): Promise<any> {
  // Request Config

  // get origin
  const HeadersConfig = new Headers({
    'Content-Type': 'application/json',
  })
  const body = {
    email: email,
    provider: provider,
    access_token: accessToken,
  }
  const jsonBody = JSON.stringify(body);

  const requestOptions: any = {
    method: 'POST',
    headers: HeadersConfig,
    body: jsonBody,
    redirect: 'follow',
    credentials: 'include',
  }

  // fetch using await and async
  const response = await fetch(`${getAPIUrl()}auth/oauth`, requestOptions)
  return response
}

export async function sendResetLink(email: string, org_id: number) {
  const result = await fetch(
    `${getAPIUrl()}users/reset_password/send_reset_code/${email}?org_id=${org_id}`,
    RequestBody('POST', null, null)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function resetPassword(
  email: string,
  new_password: string,
  org_id: number,
  reset_code: string
) {
  const result = await fetch(
    `${getAPIUrl()}users/reset_password/change_password/${email}?reset_code=${reset_code}&new_password=${new_password}&org_id=${org_id}`,
    RequestBody('POST', null, null)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function logout(): Promise<any> {
  // Request Config

  // get origin
  const HeadersConfig = new Headers({
    'Content-Type': 'application/x-www-form-urlencoded',
  })
  const urlencoded = new URLSearchParams()

  const requestOptions: any = {
    method: 'DELETE',
    headers: HeadersConfig,
    body: urlencoded,
    redirect: 'follow',
    credentials: 'include',
  }

  // fetch using await and async
  const response = await fetch(`${getAPIUrl()}auth/logout`, requestOptions)
  return response
}

export async function getUserInfo(token: string): Promise<any> {
  const origin = window.location.origin
  const HeadersConfig = new Headers({
    Authorization: `Bearer ${token}`,
    Origin: origin,
  })

  const requestOptions: any = {
    method: 'GET',
    headers: HeadersConfig,
    redirect: 'follow',
    credentials: 'include',
  }

  return fetch(`${getAPIUrl()}users/profile`, requestOptions)
    .then((result) => result.json())
    .catch((error) => console.log('error', error))
}

export async function getUserSession(token: string): Promise<any> {
  const HeadersConfig = new Headers({
    Authorization: `Bearer ${token}`,
  })

  const requestOptions: any = {
    method: 'GET',
    headers: HeadersConfig,
    redirect: 'follow',
    credentials: 'include',
  }

  return fetch(`${getAPIUrl()}users/session`, requestOptions)
    .then((result) => result.json())
    .catch((error) => console.log('error', error))
}

export async function getNewAccessTokenUsingRefreshToken(): Promise<any> {
  const requestOptions: any = {
    method: 'GET',
    redirect: 'follow',
    credentials: 'include',
  }

  return fetch(`${getAPIUrl()}auth/refresh`, requestOptions)
    .then((result) => result.json())
    .catch((error) => console.log('error', error))
}

export async function getNewAccessTokenUsingRefreshTokenServer(
  refresh_token_cookie: any
): Promise<any> {
  const requestOptions: any = {
    method: 'GET',
    redirect: 'follow',
    headers: {
      Cookie: `refresh_token_cookie=${refresh_token_cookie}`,
    },
    credentials: 'include',
  }
  return fetch(`${getAPIUrl()}auth/refresh`, requestOptions)
    .then((result) => result.json())
    .catch((error) => console.log('error', error))
}

// cookies

export async function getAccessTokenFromRefreshTokenCookie(cookieStore: any) {
  const refresh_token_cookie: any = cookieStore.get('refresh_token_cookie')
  const access_token_cookie: any =
    await getNewAccessTokenUsingRefreshTokenServer(refresh_token_cookie?.value)
  return access_token_cookie && refresh_token_cookie
    ? access_token_cookie.access_token
    : null
}

// signup

interface NewAccountBody {
  username: string
  email: string
  password: string
  org_slug: string
  org_id: string
}

export async function signup(body: NewAccountBody): Promise<any> {
  const HeadersConfig = new Headers({ 'Content-Type': 'application/json' })

  const requestOptions: any = {
    method: 'POST',
    headers: HeadersConfig,
    body: JSON.stringify(body),
    redirect: 'follow',
  }

  const res = await fetch(`${getAPIUrl()}users/${body.org_id}`, requestOptions)

  return res
}

export async function signUpWithInviteCode(
  body: NewAccountBody,
  invite_code: string
): Promise<any> {
  const HeadersConfig = new Headers({ 'Content-Type': 'application/json' })

  const requestOptions: any = {
    method: 'POST',
    headers: HeadersConfig,
    body: JSON.stringify(body),
    redirect: 'follow',
  }

  const res = await fetch(
    `${getAPIUrl()}users/${body.org_id}/invite/${invite_code}`,
    requestOptions
  )

  return res
}
