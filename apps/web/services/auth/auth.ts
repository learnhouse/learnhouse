import { getAPIUrl } from '@services/config/config'
import { RequestBody, getResponseMetadata } from '@services/utils/ts/requests'

// Thin fetch wrappers around the backend auth endpoints. The app-wide auth
// security hardening (cookie clearing, open-redirect guards, session-marker
// handling, OAuth redirect validation) now lives in the same-origin proxy
// (app/api/auth/[...path]) + AuthContext + services/auth/{cookies,redirects}.
// REMAINING CLEANUP: several wrappers below still hit the backend DIRECTLY
// (loginAndGetToken, refresh, logout, getUserSession) instead of going through
// the /api/auth/* same-origin proxy, so they do not set/clear .io-origin
// cookies. Prefer the proxy path for any new auth call; consolidate these over.

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
  accessToken: string,
  orgId?: number
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

  // Add org_id as query parameter if provided
  const url = orgId
    ? `${getAPIUrl()}auth/oauth?org_id=${orgId}`
    : `${getAPIUrl()}auth/oauth`;

  // fetch using await and async
  const response = await fetch(url, requestOptions)
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
    `${getAPIUrl()}users/reset_password/change_password/${email}`,
    RequestBody('POST', { new_password, org_id, reset_code }, null)
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

  try {
    const response = await fetch(`${getAPIUrl()}users/session`, requestOptions);
    if (!response.ok) {
        console.error(`Session fetch failed with status: ${response.status}`);
        return null;
    }
    return await response.json();
  } catch (error) {
    console.error('Error fetching user session:', error);
    return null;
  }
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
      Cookie: `LH_refresh=${refresh_token_cookie}`,
    },
    credentials: 'include',
  }
  return fetch(`${getAPIUrl()}auth/refresh`, requestOptions)
    .then((result) => result.json())
    .catch((error) => console.log('error', error))
}

// cookies

export async function getAccessTokenFromRefreshTokenCookie(cookieStore: any) {
  const refresh_token_cookie: any = cookieStore.get('LH_refresh')
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
  // Cloudflare Turnstile token collected by the signup form. Optional so OSS /
  // Turnstile-disabled deployments keep working.
  turnstileToken?: string | null
}

// Signup goes through the same-origin gateway (app/api/signup/route.ts), which
// verifies Turnstile + rejects disposable emails server-side, forwards to the
// backend user-create endpoint, then syncs the Loops marketing contact. The
// gateway mirrors the backend's status + JSON, so callers keep reading
// `res.status` / `res.json().detail` exactly as before.
export async function signup(body: NewAccountBody): Promise<any> {
  const requestOptions: any = {
    method: 'POST',
    headers: new Headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
    redirect: 'follow',
  }

  return await fetch('/api/signup', requestOptions)
}

export async function signUpWithInviteCode(
  body: NewAccountBody,
  invite_code: string
): Promise<any> {
  const requestOptions: any = {
    method: 'POST',
    headers: new Headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ ...body, inviteCode: invite_code }),
    redirect: 'follow',
  }

  return await fetch('/api/signup', requestOptions)
}

// Email Verification

export async function verifyEmail(
  token: string,
  userUuid: string,
  orgUuid: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const HeadersConfig = new Headers({ 'Content-Type': 'application/json' })

    const requestOptions: RequestInit = {
      method: 'POST',
      headers: HeadersConfig,
      body: JSON.stringify({
        token,
        user_uuid: userUuid,
        org_uuid: orgUuid,
      }),
      // Go through the same-origin auth proxy so the session cookies the
      // backend returns on success are mirrored onto this origin (auto sign-in).
      credentials: 'include',
    }

    const response = await fetch('/api/auth/verify-email', requestOptions)
    const data = await response.json()

    if (response.ok) {
      return { success: true }
    } else {
      return {
        success: false,
        error: data.detail || 'Verification failed',
      }
    }
  } catch {
    return {
      success: false,
      error: 'An error occurred during verification',
    }
  }
}

export async function resendVerificationEmail(
  email: string,
  orgId: number
): Promise<{ success: boolean; error?: string }> {
  try {
    const HeadersConfig = new Headers({ 'Content-Type': 'application/json' })

    const requestOptions: RequestInit = {
      method: 'POST',
      headers: HeadersConfig,
      body: JSON.stringify({
        email,
        org_id: orgId,
      }),
    }

    const response = await fetch(`${getAPIUrl()}auth/resend-verification`, requestOptions)
    const data = await response.json()

    if (response.ok) {
      return { success: true }
    } else {
      return {
        success: false,
        error: data.detail || 'Failed to resend verification email',
      }
    }
  } catch {
    return {
      success: false,
      error: 'An error occurred',
    }
  }
}
