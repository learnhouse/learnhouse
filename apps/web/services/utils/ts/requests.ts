import { getUriWithOrg, getAPIUrl } from '@services/config/config'
import { dispatchAuthExpired } from '@/lib/auth/events'
import { hasSessionMarker } from '@services/auth/sessionMarker'

/**
 * Validates that a URL is a safe API URL by checking it starts with the configured API base URL.
 * This prevents SSRF attacks by ensuring requests only go to the expected API server.
 */
function validateApiUrl(url: string): void {
  const apiBase = getAPIUrl();
  if (!url.startsWith(apiBase)) {
    throw new Error(`Invalid API URL: URL must start with ${apiBase}`);
  }
}

/**
 * A secure fetch wrapper that validates URLs before making requests.
 * Use this for all API calls to prevent SSRF vulnerabilities.
 */
export async function secureFetch(url: string, options: RequestInit): Promise<Response> {
  validateApiUrl(url);
  return fetch(url, options);
}

export const RequestBody = (method: string, data: any, next: any) => {
  let HeadersConfig = new Headers({ 'Content-Type': 'application/json' })
  let options: any = {
    method: method,
    headers: HeadersConfig,
    redirect: 'follow',
    credentials: 'include',
    // Next.js
    next: next,
  }
  if (data) {
    options.body = JSON.stringify(data)
  }
  return options
}

export const RequestBodyWithAuthHeader = (
  method: string,
  data: any,
  next: any,
  token?: string
): RequestInit => {
  let HeadersConfig = new Headers(
    token
      ? { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
      : { 'Content-Type': 'application/json' }
  )
  // Always bypass the Next.js fetch data cache for API requests. Two reasons:
  //   1. It keys by URL+method+body only (not Authorization), so an authed
  //      response can be served to an anonymous caller.
  //   2. Access state (public ↔ UsersOnly, published ↔ draft, group membership)
  //      can change at any time and the tag-based revalidation isn't reliable
  //      across every code path that mutates it. The backend already has its
  //      own Redis cache on hot endpoints, so the performance impact is small.
  return {
    method: method,
    headers: HeadersConfig,
    redirect: 'follow',
    credentials: 'include',
    cache: 'no-store',
    body: (method === 'POST' || method === 'PUT' || method === 'DELETE') && data !== null ? JSON.stringify(data) : null,
  }
}

export const RequestBodyForm = (method: string, data: any, next: any) => {
  let HeadersConfig = new Headers({})
  let options: any = {
    method: method,
    headers: HeadersConfig,
    redirect: 'follow',
    credentials: 'include',
    body: (method === 'POST' || method === 'PUT') ? JSON.stringify(data) : null,
    // Next.js
    next: next,
  }
  return options
}

export const RequestBodyFormWithAuthHeader = (
  method: string,
  data: any,
  next: any,
  access_token: string
) => {
  let HeadersConfig = new Headers({
    Authorization: `Bearer ${access_token}`,
  })
  let options: any = {
    method: method,
    headers: HeadersConfig,
    redirect: 'follow',
    credentials: 'include',
    body: data,
    // Next.js
    next: next,
  }
  return options
}

const UPLOAD_TIMEOUT_MS = 30 * 60 * 1000

/**
 * POST a FormData payload with REAL upload progress.
 *
 * Uses XMLHttpRequest because fetch() cannot report request-body upload
 * progress: large files otherwise sit on an indeterminate spinner for minutes.
 * Resolves with the parsed JSON body and rejects with the backend `detail`
 * message (or an HTTP-status message when the body isn't JSON, which is what
 * an nginx 413 or a gateway 502 returns).
 */
export function uploadFormWithProgress<T = any>(
  url: string,
  formData: FormData,
  access_token: string,
  onProgress?: (_percent: number) => void
): Promise<T> {
  validateApiUrl(url)
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', url)
    xhr.setRequestHeader('Authorization', `Bearer ${access_token}`)
    xhr.withCredentials = true
    xhr.timeout = UPLOAD_TIMEOUT_MS

    xhr.upload.onprogress = (e) => {
      if (onProgress && e.lengthComputable) {
        onProgress(Math.round((e.loaded / e.total) * 100))
      }
    }

    xhr.onload = () => {
      // Status first, body second: a successful upload with an empty body must
      // not be reported as a failure, and a non-JSON error body must not hide
      // the status code.
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText))
        } catch {
          resolve({} as T)
        }
        return
      }
      if (xhr.status === 413) {
        reject(new Error('The file is too large to upload.'))
        return
      }
      let detail: string | undefined
      try {
        const body = JSON.parse(xhr.responseText)
        detail =
          typeof body?.detail === 'string'
            ? body.detail
            : Array.isArray(body?.detail)
              ? body.detail.map((e: any) => e.msg).join(', ')
              : undefined
      } catch {
        /* non-JSON error body (nginx / gateway HTML) */
      }
      reject(new Error(detail || `Upload failed (HTTP ${xhr.status})`))
    }

    xhr.onerror = () =>
      reject(new Error('Upload failed. Please check your connection and try again.'))
    xhr.ontimeout = () =>
      reject(new Error('Upload timed out. Please try again on a faster connection.'))
    xhr.onabort = () => reject(new Error('Upload cancelled.'))

    xhr.send(formData)
  })
}

export const apiFetch = async (url: string, token?: string) => {
  // Create the request options
  let HeadersConfig = new Headers(
    token
      ? { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
      : { 'Content-Type': 'application/json' }
  )
  let options: any = {
    method: 'GET',
    headers: HeadersConfig,
    redirect: 'follow',
    credentials: 'include',
  }

  const request = await fetch(url, options)
  return errorHandling(request)
}

export const errorHandling = async (res: any) => {
  if (!res.ok) {
    let detail: any = res.statusText
    try {
      const body = await res.json()
      detail = body.detail || body.message || body
    } catch (_e) {
      // If we can't parse JSON, use statusText
    }
    let message: string
    if (typeof detail === 'string') {
      message = detail
    } else if (detail && typeof detail === 'object' && typeof detail.message === 'string') {
      message = detail.message
    } else {
      message = JSON.stringify(detail)
    }
    const error: any = new Error(message)
    error.status = res.status
    error.detail = detail
    // Only treat a 401 as an EXPIRED session (→ force login) when the user
    // actually had one. An anonymous visitor on public content legitimately gets
    // 401s from auth-required endpoints (progress, enrollment, …) and must NOT be
    // redirected to login.
    if (typeof window !== 'undefined' && res.status === 401 && hasSessionMarker()) {
      dispatchAuthExpired({
        callbackUrl: window.location.pathname.startsWith('/admin') ? '/admin/login' : '/login',
        reason: 'api_401',
      })
    }
    throw error
  }
  return res.json()
}

type CustomResponseTyping = {
  success: boolean
  data: any
  status: number
  HTTPmessage: string
}

export const getResponseMetadata = async (
  fetch_result: any
): Promise<CustomResponseTyping> => {
  // Not every response carries JSON: a 204, an empty body, or an HTML error
  // page from a proxy all make .json() throw. That rejection used to surface as
  // an unrelated crash in whatever component was awaiting the call.
  let json: any = null
  try {
    json = await fetch_result.json()
  } catch (_e) {
    json = null
  }
  const ok = fetch_result.ok ?? fetch_result.status === 200
  return {
    success: ok,
    data: json,
    status: fetch_result.status,
    HTTPmessage: fetch_result.statusText,
  }
}

/**
 * Coerce an API result into an array before rendering it as a list.
 *
 * `getResponseMetadata` returns the parsed body under `data` whether the call
 * succeeded or not, so an error response puts an object (`{detail: ...}`) where
 * a list was expected. `res?.data ?? []` happily passes that object through and
 * the component dies on `.map is not a function` / `.filter is not a function`
 * — a blank page for what is really just a failed request.
 */
export const asArray = <T = any>(value: any): T[] => {
  if (Array.isArray(value)) return value as T[]
  if (Array.isArray(value?.data)) return value.data as T[]
  return []
}

export const revalidateTags = async (tags: string[], orgslug: string) => {
  const url = getUriWithOrg(orgslug, '')
  // Call each tag revalidation multiple times to hit different pods
  // behind the load balancer (cookie affinity only applies to the
  // user's browser session, not to these programmatic fetches).
  const calls = tags.flatMap((tag) => {
    const endpoint = `${url}/api/revalidate?tag=${tag}`
    return [
      fetch(endpoint, { cache: 'no-store' }).catch((err) =>
        console.error(`Failed to revalidate tag ${tag}:`, err)
      ),
      fetch(endpoint, { cache: 'no-store' }).catch((err) =>
        console.error(`Failed to revalidate tag ${tag}:`, err)
      ),
    ]
  })
  await Promise.allSettled(calls)
}
