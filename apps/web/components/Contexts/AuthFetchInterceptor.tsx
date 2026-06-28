'use client'

import { useEffect } from 'react'
import { getAPIUrl } from '@services/config/config'
import { dispatchAuthExpired, dispatchAuthRefreshed } from '@/lib/auth/events'

const AUTH_RETRY_HEADER = 'X-LH-Auth-Retry'

function getRequestUrl(input: RequestInfo | URL): string | null {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  if (typeof Request !== 'undefined' && input instanceof Request) return input.url
  return null
}

function getHeaders(init?: RequestInit): Headers {
  return new Headers(init?.headers || {})
}

function isApiRequest(url: string): boolean {
  const apiUrl = getAPIUrl()
  return url.startsWith('/api/v1/') || url.startsWith(apiUrl)
}

function isAuthRoute(url: string): boolean {
  return url.includes('/api/auth/')
}

function getLoginCallbackUrl(): string {
  if (typeof window === 'undefined') return '/login'
  return window.location.pathname.startsWith('/admin') ? '/admin/login' : '/login'
}

export default function AuthFetchInterceptor() {
  useEffect(() => {
    if (typeof window === 'undefined') return

    const originalFetch = window.fetch.bind(window)
    let refreshPromise: Promise<{ access_token: string } | null> | null = null

    const refreshAccessToken = async (): Promise<{ access_token: string } | null> => {
      if (refreshPromise) return refreshPromise

      refreshPromise = (async () => {
        try {
          const response = await originalFetch('/api/auth/refresh', {
            method: 'GET',
            credentials: 'include',
            headers: {
              [AUTH_RETRY_HEADER]: '1',
            },
          })

          if (!response.ok) {
            return null
          }

          const data = await response.json()
          if (!data?.access_token) {
            return null
          }

          dispatchAuthRefreshed({
            access_token: data.access_token,
            expiry: typeof data.expiry === 'number' ? data.expiry : undefined,
          })
          return {
            access_token: data.access_token,
          }
        } catch {
          return null
        } finally {
          refreshPromise = null
        }
      })()

      return refreshPromise
    }

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = getRequestUrl(input)
      const headers = getHeaders(init)
      const authHeader = headers.get('Authorization')
      const hasRetried = headers.get(AUTH_RETRY_HEADER) === '1'

      const response = await originalFetch(input, init)

      if (
        !url ||
        response.status !== 401 ||
        !isApiRequest(url) ||
        isAuthRoute(url) ||
        !authHeader?.startsWith('Bearer ') ||
        hasRetried ||
        (typeof Request !== 'undefined' && input instanceof Request)
      ) {
        return response
      }

      const refreshed = await refreshAccessToken()
      if (!refreshed?.access_token) {
        dispatchAuthExpired({
          callbackUrl: getLoginCallbackUrl(),
          reason: 'refresh_failed',
        })
        return response
      }

      const retryHeaders = new Headers(init?.headers || {})
      retryHeaders.set('Authorization', `Bearer ${refreshed.access_token}`)
      retryHeaders.set(AUTH_RETRY_HEADER, '1')

      const retryResponse = await originalFetch(input, {
        ...init,
        headers: retryHeaders,
      })

      if (retryResponse.status === 401) {
        dispatchAuthExpired({
          callbackUrl: getLoginCallbackUrl(),
          reason: 'retry_failed',
        })
      }

      return retryResponse
    }

    return () => {
      window.fetch = originalFetch
    }
  }, [])

  return null
}
