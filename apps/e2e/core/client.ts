/**
 * Generic, feature-agnostic REST client for the LearnHouse API.
 *
 * Holds only platform-level primitives every feature needs: the low-level
 * request wrapper, login (with per-email token caching + 429 retry), org
 * lookup, and user creation. Feature-specific calls (assignments, courses, …)
 * live in their own `features/<area>/api.ts` and build on `req` from here.
 */
import { API_URL, ORG_SLUG } from './instance'

export interface Org {
  id: number
  slug: string
}

/** Low-level request wrapper. JSON by default; pass asForm for urlencoded bodies. */
export async function req<T = any>(
  method: string,
  path: string,
  token: string | null,
  body?: unknown,
  asForm = false,
): Promise<T> {
  const headers: Record<string, string> = {}
  if (token) headers.Authorization = `Bearer ${token}`
  let payload: BodyInit | undefined
  if (asForm) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded'
    payload = new URLSearchParams(body as Record<string, string>)
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  const res = await fetch(`${API_URL}${path}`, { method, headers, body: payload })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`${method} ${path} -> ${res.status}: ${text}`)
  }
  return (text ? JSON.parse(text) : undefined) as T
}

/** GET helper returning parsed JSON. */
export function apiGet<T = any>(path: string, token: string): Promise<T> {
  return req<T>('GET', path, token)
}

// Cache API tokens per email so repeated read-backs / seeds for the same user
// don't each spend a login — the API enforces 30 logins / 5 min / IP.
const _tokenCache = new Map<string, string>()

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** Log in and return a bearer token (cached per email; retries once on 429). */
export async function login(email: string, password: string): Promise<string> {
  const cached = _tokenCache.get(email)
  if (cached) return cached
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const data = await req<any>('POST', '/auth/login', null, { username: email, password }, true)
      const token = data?.tokens?.access_token || data?.access_token
      if (!token) throw new Error('login: no access_token')
      _tokenCache.set(email, token)
      return token
    } catch (e) {
      if (attempt === 0 && /-> 429/.test((e as Error).message)) {
        await sleep(8000)
        continue
      }
      throw e
    }
  }
  throw new Error(`login failed for ${email}`)
}

export async function getOrg(): Promise<Org> {
  return req<Org>('GET', `/orgs/slug/${ORG_SLUG}`, null)
}

/** Create a user attached to the org. Returns the new user id. */
export async function createStudent(
  adminToken: string,
  orgId: number,
  student: { email: string; username: string; password: string; first_name?: string; last_name?: string },
): Promise<number> {
  const user = await req<any>('POST', `/users/${orgId}`, adminToken, {
    email: student.email,
    username: student.username,
    password: student.password,
    first_name: student.first_name ?? '',
    last_name: student.last_name ?? '',
  })
  return user.id
}
