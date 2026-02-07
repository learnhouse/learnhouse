'use client'

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
} from 'react'
import {
  getAPIUrl,
  getLEARNHOUSE_TOP_DOMAIN_VAL,
  getLEARNHOUSE_DOMAIN_VAL,
} from '@services/config/config'
import { isSubdomainOf, isSameHost, isLocalhost as isLocalhostCheck } from '@services/utils/ts/hostUtils'

// Types matching NextAuth's session structure
export interface Session {
  user: any | undefined
  roles?: string[] | undefined
  tokens?: {
    access_token?: string | undefined
    refresh_token?: string | undefined
    expiry?: number | undefined
  } | undefined
}

export type SessionStatus = 'loading' | 'authenticated' | 'unauthenticated'

export interface UseSessionReturn {
  data: Session | null
  status: SessionStatus
  update: () => Promise<void>
}

export interface SignInOptions {
  redirect?: boolean
  callbackUrl?: string
  email?: string
  password?: string
  // SSO fields
  sso?: string
  sso_access_token?: string
  sso_refresh_token?: string
  sso_user?: string
  sso_expiry?: number
  // For OAuth
  orgId?: number
  orgSlug?: string
}

export interface SignInResult {
  ok: boolean
  error: string | null
  url: string | null
  status: number
}

export interface SignOutOptions {
  callbackUrl?: string
  redirect?: boolean
}

// Session cache for performance (similar to NextAuth's 10s cache)
interface SessionCache {
  data: Session
  timestamp: number
}

const SESSION_CACHE_TTL = 10 * 1000 // 10 seconds
const TOKEN_REFRESH_THRESHOLD = 60 * 1000 // 1 minute before expiry
const AUTH_BROADCAST_CHANNEL = 'learnhouse_auth_sync'
const OAUTH_STATE_COOKIE = 'learnhouse_oauth_state'

// Context
interface AuthContextValue {
  session: Session | null
  status: SessionStatus
  accessToken: string | null
  refreshSession: () => Promise<void>
  signIn: (provider: string, options?: SignInOptions) => Promise<SignInResult | void>
  signOut: (options?: SignOutOptions) => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

// Generate cryptographically secure random string for CSRF protection
function generateSecureToken(length: number = 32): string {
  const array = new Uint8Array(length)
  crypto.getRandomValues(array)
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('')
}

// Check if current hostname is a custom domain
function isCustomDomain(): boolean {
  if (typeof window === 'undefined') return false
  const hostname = window.location.hostname
  const domain = getLEARNHOUSE_DOMAIN_VAL()
  return !isSubdomainOf(hostname, domain) && !isSameHost(hostname, domain) && !isLocalhostCheck(hostname)
}

// Get cookie attributes based on current domain context
function getCookieAttributes(): { secureAttr: string; domainAttr: string; sameSiteAttr: string } {
  const isSecure = typeof window !== 'undefined' && window.location.protocol === 'https:'
  const secureAttr = isSecure ? '; Secure' : ''
  const topDomain = getLEARNHOUSE_TOP_DOMAIN_VAL()

  // For custom domains, don't set domain attribute (host-only cookie)
  // For localhost, don't set domain attribute
  // For subdomains of main domain, set domain to allow sharing
  let domainAttr = ''
  if (!isCustomDomain() && topDomain !== 'localhost') {
    domainAttr = `; domain=.${topDomain}`
  }

  // SameSite=Lax is generally safe and allows top-level navigation
  const sameSiteAttr = '; SameSite=Lax'

  return { secureAttr, domainAttr, sameSiteAttr }
}

// Store OAuth CSRF state in a cookie (shared across subdomains, unlike sessionStorage)
// For custom domains, cookie is host-only so it stays on the same origin.
// For subdomains, cookie is scoped to top domain so callback on main domain can read it.
function setOAuthStateCookie(csrf: string): void {
  const { secureAttr, domainAttr, sameSiteAttr } = getCookieAttributes()
  // 5 minute expiry matching the state validation window
  const expires = new Date(Date.now() + 5 * 60 * 1000).toUTCString()
  const value = JSON.stringify({ csrf, timestamp: Date.now() })
  document.cookie = `${OAUTH_STATE_COOKIE}=${encodeURIComponent(value)}; path=/${sameSiteAttr}${secureAttr}${domainAttr}; expires=${expires}`
}

function getOAuthStateCookie(): { csrf: string; timestamp: number } | null {
  try {
    const cookies = document.cookie.split(';')
    for (const cookie of cookies) {
      const [name, ...rest] = cookie.trim().split('=')
      if (name === OAUTH_STATE_COOKIE) {
        return JSON.parse(decodeURIComponent(rest.join('=')))
      }
    }
  } catch {}
  return null
}

function clearOAuthStateCookie(): void {
  const { secureAttr, domainAttr, sameSiteAttr } = getCookieAttributes()
  document.cookie = `${OAUTH_STATE_COOKIE}=; path=/${sameSiteAttr}${secureAttr}${domainAttr}; expires=Thu, 01 Jan 1970 00:00:00 GMT`
}

// Session Provider Component
interface SessionProviderProps {
  children: React.ReactNode
  refetchInterval?: number
}

export function SessionProvider({
  children,
  refetchInterval = 60000,
}: SessionProviderProps) {
  const [session, setSession] = useState<Session | null>(null)
  const [status, setStatus] = useState<SessionStatus>('loading')
  const [accessToken, setAccessToken] = useState<string | null>(null)
  const [tokenExpiry, setTokenExpiry] = useState<number | null>(null)
  const sessionCacheRef = useRef<SessionCache | null>(null)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)
  const broadcastChannelRef = useRef<BroadcastChannel | null>(null)

  // Use ref for refresh promise to avoid issues with stale closures
  // but still deduplicate within the same tab
  const refreshPromiseRef = useRef<Promise<{ access_token: string; expiry?: number } | null> | null>(null)
  const isRefreshingRef = useRef(false)

  // Set up BroadcastChannel for cross-tab communication
  useEffect(() => {
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      broadcastChannelRef.current = new BroadcastChannel(AUTH_BROADCAST_CHANNEL)

      broadcastChannelRef.current.onmessage = (event) => {
        if (event.data.type === 'LOGOUT') {
          // Another tab logged out, clear our state too
          setSession(null)
          setAccessToken(null)
          setTokenExpiry(null)
          setStatus('unauthenticated')
          sessionCacheRef.current = null
        } else if (event.data.type === 'LOGIN') {
          // Another tab logged in, refresh our session
          refreshSessionInternal()
        }
      }
    }

    return () => {
      broadcastChannelRef.current?.close()
    }
  }, [])

  // Fetch user session from backend
  const fetchUserSession = useCallback(async (token: string, expiry?: number): Promise<Session | null> => {
    try {
      const response = await fetch(`${getAPIUrl()}users/session`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        credentials: 'include',
      })

      if (!response.ok) {
        console.error(`Session fetch failed with status: ${response.status}`)
        return null
      }

      const data = await response.json()
      return {
        user: data.user,
        roles: data.roles,
        tokens: {
          access_token: token,
          refresh_token: undefined, // Stored in httpOnly cookie
          expiry: expiry,
        },
      }
    } catch (error) {
      console.error('Error fetching user session:', error)
      return null
    }
  }, [])

  // Check if a session might exist (marker cookie is set alongside httpOnly auth cookies)
  const hasSessionMarker = useCallback((): boolean => {
    return typeof document !== 'undefined' && document.cookie.includes('learnhouse_has_session')
  }, [])

  // Refresh access token using refresh token cookie
  const refreshAccessToken = useCallback(async (): Promise<{ access_token: string; expiry?: number } | null> => {
    // Deduplicate refresh requests within this tab
    if (isRefreshingRef.current && refreshPromiseRef.current) {
      return refreshPromiseRef.current
    }

    isRefreshingRef.current = true
    refreshPromiseRef.current = (async () => {
      try {
        // Use Next.js API route to ensure cookies are set correctly
        const response = await fetch('/api/auth/refresh', {
          method: 'GET',
          credentials: 'include',
        })

        if (!response.ok) {
          if (response.status === 401) {
            // Refresh token expired or invalid
            return null
          }
          throw new Error(`Refresh failed with status: ${response.status}`)
        }

        const data = await response.json()

        // Validate response structure
        if (!data.access_token) {
          console.error('Invalid refresh response: missing access_token')
          return null
        }

        return {
          access_token: data.access_token,
          expiry: typeof data.expiry === 'number' ? data.expiry : undefined,
        }
      } catch (error) {
        console.error('Token refresh failed:', error)
        return null
      } finally {
        isRefreshingRef.current = false
        refreshPromiseRef.current = null
      }
    })()

    return refreshPromiseRef.current
  }, [])

  // Check if token needs refresh
  const isTokenExpiringSoon = useCallback((expiry?: number | null): boolean => {
    if (!expiry) return false
    return Date.now() + TOKEN_REFRESH_THRESHOLD >= expiry
  }, [])

  // Internal refresh session function (used by broadcast channel)
  const refreshSessionInternal = useCallback(async () => {
    try {
      const refreshResult = await refreshAccessToken()
      if (refreshResult) {
        setAccessToken(refreshResult.access_token)
        setTokenExpiry(refreshResult.expiry || null)

        const sessionData = await fetchUserSession(refreshResult.access_token, refreshResult.expiry)
        if (sessionData) {
          setSession(sessionData)
          setStatus('authenticated')
          sessionCacheRef.current = {
            data: sessionData,
            timestamp: Date.now(),
          }
        }
      }
    } catch (error) {
      console.error('Session refresh error:', error)
    }
  }, [refreshAccessToken, fetchUserSession])

  // Main session refresh function
  const refreshSession = useCallback(async () => {
    // Check cache first
    const now = Date.now()
    if (
      sessionCacheRef.current &&
      now - sessionCacheRef.current.timestamp < SESSION_CACHE_TTL
    ) {
      setSession(sessionCacheRef.current.data)
      setStatus('authenticated')
      return
    }

    try {
      // Try to refresh token if we don't have one or it's expiring
      let currentToken = accessToken
      let currentExpiry = tokenExpiry

      if (!currentToken || isTokenExpiringSoon(currentExpiry)) {
        const refreshResult = await refreshAccessToken()
        if (refreshResult) {
          currentToken = refreshResult.access_token
          currentExpiry = refreshResult.expiry || null
          setAccessToken(currentToken)
          setTokenExpiry(currentExpiry)
        } else {
          // No valid token, user is unauthenticated
          setSession(null)
          setStatus('unauthenticated')
          setAccessToken(null)
          setTokenExpiry(null)
          sessionCacheRef.current = null
          return
        }
      }

      // Fetch session data with the CURRENT expiry (from refresh, not stale state)
      const sessionData = await fetchUserSession(currentToken, currentExpiry || undefined)
      if (sessionData) {
        setSession(sessionData)
        setStatus('authenticated')
        sessionCacheRef.current = {
          data: sessionData,
          timestamp: now,
        }
      } else {
        setSession(null)
        setStatus('unauthenticated')
        sessionCacheRef.current = null
      }
    } catch (error) {
      console.error('Session refresh error:', error)
      setSession(null)
      setStatus('unauthenticated')
    }
  }, [accessToken, tokenExpiry, fetchUserSession, isTokenExpiringSoon, refreshAccessToken])

  // Initialize session on mount
  useEffect(() => {
    let isMounted = true

    const initSession = async () => {
      // Skip entirely if no session marker — no httpOnly refresh token exists
      if (!hasSessionMarker()) {
        setStatus('unauthenticated')
        return
      }

      setStatus('loading')

      // Try to restore session from refresh token
      const refreshResult = await refreshAccessToken()

      if (!isMounted) return

      if (refreshResult) {
        setAccessToken(refreshResult.access_token)
        setTokenExpiry(refreshResult.expiry || null)

        // Fetch full session
        const sessionData = await fetchUserSession(refreshResult.access_token, refreshResult.expiry)

        if (!isMounted) return

        if (sessionData) {
          setSession(sessionData)
          setStatus('authenticated')
          sessionCacheRef.current = {
            data: sessionData,
            timestamp: Date.now(),
          }
        } else {
          setStatus('unauthenticated')
        }
      } else {
        setStatus('unauthenticated')
      }
    }

    initSession()

    return () => {
      isMounted = false
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Set up refetch interval
  useEffect(() => {
    if (refetchInterval && status === 'authenticated') {
      intervalRef.current = setInterval(() => {
        refreshSession()
      }, refetchInterval)
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
    }
  }, [refetchInterval, status, refreshSession])

  // Sign in function
  const handleSignIn = useCallback(
    async (provider: string, options: SignInOptions = {}): Promise<SignInResult | void> => {
      const { redirect = true, callbackUrl = '/' } = options

      try {
        if (provider === 'credentials') {
          // Handle SSO login (tokens already obtained)
          if (options.sso === 'true' && options.sso_access_token) {
            const user = options.sso_user ? JSON.parse(options.sso_user) : null
            // Use server-provided expiry or default to 8 hours
            const expiry = options.sso_expiry || (Date.now() + 8 * 60 * 60 * 1000)

            const newSession: Session = {
              user,
              roles: [],
              tokens: {
                access_token: options.sso_access_token,
                refresh_token: options.sso_refresh_token,
                expiry,
              },
            }
            setSession(newSession)
            setAccessToken(options.sso_access_token)
            setTokenExpiry(expiry)
            setStatus('authenticated')
            sessionCacheRef.current = {
              data: newSession,
              timestamp: Date.now(),
            }

            // Notify other tabs
            broadcastChannelRef.current?.postMessage({ type: 'LOGIN' })

            if (redirect) {
              window.location.href = callbackUrl
            }

            return { ok: true, error: null, url: callbackUrl, status: 200 }
          }

          // Regular credentials login
          // Use Next.js API route to ensure cookies are set correctly
          const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
              username: options.email || '',
              password: options.password || '',
            }),
            credentials: 'include',
          })

          const data = await response.json()

          if (!response.ok) {
            // Return error in same format as NextAuth
            const errorData = data.detail || data
            return {
              ok: false,
              error: JSON.stringify({
                code: errorData?.code || 'UNKNOWN_ERROR',
                message: errorData?.message || 'Login failed',
                email: errorData?.email,
                retry_after: errorData?.retry_after,
              }),
              url: null,
              status: response.status,
            }
          }

          // Validate response structure
          if (!data.tokens?.access_token) {
            return {
              ok: false,
              error: JSON.stringify({ code: 'INVALID_RESPONSE', message: 'Invalid server response' }),
              url: null,
              status: 500,
            }
          }

          // Login successful
          const newSession: Session = {
            user: data.user,
            roles: [],
            tokens: {
              access_token: data.tokens.access_token,
              refresh_token: data.tokens.refresh_token,
              expiry: data.tokens.expiry,
            },
          }

          setSession(newSession)
          setAccessToken(data.tokens.access_token)
          setTokenExpiry(data.tokens.expiry || null)
          setStatus('authenticated')
          sessionCacheRef.current = {
            data: newSession,
            timestamp: Date.now(),
          }

          // Fetch full session with roles
          const fullSession = await fetchUserSession(data.tokens.access_token, data.tokens.expiry)
          if (fullSession) {
            fullSession.tokens = newSession.tokens
            setSession(fullSession)
            sessionCacheRef.current = {
              data: fullSession,
              timestamp: Date.now(),
            }
          }

          // Notify other tabs
          broadcastChannelRef.current?.postMessage({ type: 'LOGIN' })

          if (redirect) {
            window.location.href = callbackUrl
          }

          return { ok: true, error: null, url: callbackUrl, status: 200 }
        }

        if (provider === 'google') {
          // Store org context in cookies before OAuth redirect
          const { secureAttr, domainAttr, sameSiteAttr } = getCookieAttributes()
          const baseAttributes = `; path=/${sameSiteAttr}${secureAttr}`

          if (options.orgSlug || options.orgId) {
            if (options.orgSlug) {
              document.cookie = `learnhouse_oauth_orgslug=${options.orgSlug}${baseAttributes}${domainAttr}`
            }
            if (options.orgId) {
              document.cookie = `learnhouse_oauth_org_id=${options.orgId}${baseAttributes}${domainAttr}`
            }
          }

          // Generate CSRF token for state parameter
          const csrfToken = generateSecureToken()
          const stateData: Record<string, any> = {
            callbackUrl,
            csrf: csrfToken,
            timestamp: Date.now(),
          }

          // For custom domains, embed returnOrigin so the main domain callback can bounce back
          if (isCustomDomain()) {
            stateData.returnOrigin = window.location.origin
          }

          const state = btoa(JSON.stringify(stateData))

          // Store CSRF token in cookie for validation on callback
          setOAuthStateCookie(csrfToken)

          // Always use main domain for redirect URI — only one URI registered with Google
          const redirectUri = `${window.location.protocol}//${getLEARNHOUSE_DOMAIN_VAL()}/auth/callback/google`

          // Get Google OAuth URL from server (client ID lives server-side only)
          const authResponse = await fetch('/api/auth/google/authorize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ redirect_uri: redirectUri, state, scope: 'openid email profile' }),
          })

          if (!authResponse.ok) {
            const errorData = await authResponse.json().catch(() => ({}))
            console.error('Google OAuth initiation failed:', errorData)
            return {
              ok: false,
              error: errorData.error || 'Google OAuth not configured',
              url: null,
              status: authResponse.status,
            }
          }

          const { url: googleAuthUrl } = await authResponse.json()
          window.location.href = googleAuthUrl
          return
        }

        // Unknown provider
        return {
          ok: false,
          error: `Unknown provider: ${provider}`,
          url: null,
          status: 400,
        }
      } catch (error: any) {
        console.error('Sign in error:', error)
        return {
          ok: false,
          error: error.message || 'Sign in failed',
          url: null,
          status: 500,
        }
      }
    },
    [fetchUserSession]
  )

  // Sign out function
  const handleSignOut = useCallback(async (options: SignOutOptions = {}) => {
    const { callbackUrl = '/', redirect = true } = options

    let logoutSuccess = false
    try {
      // Use Next.js API route to ensure cookies are cleared correctly
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      })
      logoutSuccess = response.ok
    } catch (error) {
      console.error('Logout error:', error)
    }

    // Clear local state regardless of backend response
    setSession(null)
    setAccessToken(null)
    setTokenExpiry(null)
    setStatus('unauthenticated')
    sessionCacheRef.current = null

    // Clear refresh promise
    refreshPromiseRef.current = null
    isRefreshingRef.current = false

    // Clear any auth cookies on client side
    const { secureAttr, domainAttr, sameSiteAttr } = getCookieAttributes()
    const expireAttr = '; expires=Thu, 01 Jan 1970 00:00:00 GMT'
    document.cookie = `learnhouse_oauth_orgslug=; path=/${expireAttr}${secureAttr}${domainAttr}`
    document.cookie = `learnhouse_oauth_org_id=; path=/${expireAttr}${secureAttr}${domainAttr}`

    // Clear OAuth state
    clearOAuthStateCookie()

    // Notify other tabs about logout
    broadcastChannelRef.current?.postMessage({ type: 'LOGOUT' })

    if (redirect) {
      window.location.href = callbackUrl
    }

    // If backend logout failed, log a warning (user is still logged out locally)
    if (!logoutSuccess) {
      console.warn('Backend logout may have failed. User logged out locally.')
    }
  }, [])

  const contextValue: AuthContextValue = {
    session,
    status,
    accessToken,
    refreshSession,
    signIn: handleSignIn,
    signOut: handleSignOut,
  }

  return (
    <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>
  )
}

// useSession hook - matches NextAuth's API exactly
export function useSession(): UseSessionReturn {
  const context = useContext(AuthContext)

  if (!context) {
    // Return unauthenticated state if used outside provider
    return {
      data: null,
      status: 'unauthenticated',
      update: async () => {},
    }
  }

  return {
    data: context.session,
    status: context.status,
    update: context.refreshSession,
  }
}

// Validate OAuth state parameter (call this on callback page)
export function validateOAuthState(state: string): { valid: boolean; callbackUrl: string } {
  const defaultResult = { valid: false, callbackUrl: '/redirect_from_auth' }

  try {
    const stateData = JSON.parse(atob(state))
    const stored = getOAuthStateCookie()

    if (!stored) {
      console.error('No stored OAuth state found')
      return defaultResult
    }

    // Validate CSRF token matches
    if (stateData.csrf !== stored.csrf) {
      console.error('OAuth CSRF token mismatch')
      return defaultResult
    }

    // Validate state is not too old (5 minutes max)
    const stateAge = Date.now() - stateData.timestamp
    if (stateAge > 5 * 60 * 1000) {
      console.error('OAuth state expired')
      return defaultResult
    }

    // Clear stored state after successful validation
    clearOAuthStateCookie()

    return {
      valid: true,
      callbackUrl: stateData.callbackUrl || '/redirect_from_auth',
    }
  } catch (error) {
    console.error('OAuth state validation error:', error)
    return defaultResult
  }
}

// signIn function - matches NextAuth's API
export async function signIn(
  provider: string,
  options?: SignInOptions
): Promise<SignInResult | void> {
  // This needs to be called from within a component that has access to the context
  // For now, we'll handle it differently for Google OAuth which needs redirect

  if (provider === 'google') {
    const { secureAttr, domainAttr, sameSiteAttr } = getCookieAttributes()
    const baseAttributes = `; path=/${sameSiteAttr}${secureAttr}`

    // Store org context from cookies if present (for compatibility)
    // The options should contain orgSlug and orgId if needed

    // Generate CSRF token for state parameter
    const csrfToken = generateSecureToken()
    const callbackUrl = options?.callbackUrl || '/'
    const stateData: Record<string, any> = {
      callbackUrl,
      csrf: csrfToken,
      timestamp: Date.now(),
    }

    // For custom domains, embed returnOrigin so the main domain callback can bounce back
    if (isCustomDomain()) {
      stateData.returnOrigin = window.location.origin
    }

    const state = btoa(JSON.stringify(stateData))

    // Store CSRF token in cookie for validation on callback
    setOAuthStateCookie(csrfToken)

    // Always use main domain for redirect URI — only one URI registered with Google
    const redirectUri = `${window.location.protocol}//${getLEARNHOUSE_DOMAIN_VAL()}/auth/callback/google`

    // Get Google OAuth URL from server (client ID lives server-side only)
    const authResponse = await fetch('/api/auth/google/authorize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ redirect_uri: redirectUri, state, scope: 'openid email profile' }),
    })

    if (!authResponse.ok) {
      const errorData = await authResponse.json().catch(() => ({}))
      console.error('Google OAuth initiation failed:', errorData)
      return {
        ok: false,
        error: errorData.error || 'Google OAuth not configured',
        url: null,
        status: authResponse.status,
      }
    }

    const { url: googleAuthUrl } = await authResponse.json()
    window.location.href = googleAuthUrl
    return
  }

  // For credentials, we need context - this will be handled by the component
  console.warn('signIn should be called with useAuth() context for credentials provider')
  return {
    ok: false,
    error: 'Use useAuth().signIn() for credentials provider',
    url: null,
    status: 400,
  }
}

// signOut function - matches NextAuth's API
export async function signOut(options?: SignOutOptions): Promise<void> {
  const { callbackUrl = '/', redirect = true } = options || {}

  try {
    // Use Next.js API route to ensure cookies are cleared correctly
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
    })
  } catch (error) {
    console.error('Logout error:', error)
  }

  // Clear cookies
  const { secureAttr, domainAttr, sameSiteAttr } = getCookieAttributes()
  const expireAttr = '; expires=Thu, 01 Jan 1970 00:00:00 GMT'
  document.cookie = `learnhouse_oauth_orgslug=; path=/${expireAttr}${secureAttr}${domainAttr}`
  document.cookie = `learnhouse_oauth_org_id=; path=/${expireAttr}${secureAttr}${domainAttr}`

  // Clear OAuth state
  clearOAuthStateCookie()

  // Try to notify other tabs (if BroadcastChannel is available)
  try {
    const bc = new BroadcastChannel(AUTH_BROADCAST_CHANNEL)
    bc.postMessage({ type: 'LOGOUT' })
    bc.close()
  } catch {
    // BroadcastChannel not available
  }

  if (redirect) {
    window.location.href = callbackUrl
  }
}

// Hook for components that need full auth control
export function useAuth() {
  const context = useContext(AuthContext)

  if (!context) {
    throw new Error('useAuth must be used within a SessionProvider')
  }

  return {
    session: context.session,
    status: context.status,
    accessToken: context.accessToken,
    signIn: context.signIn,
    signOut: context.signOut,
    refreshSession: context.refreshSession,
    // Convenience method to get valid access token (refreshes if needed)
    getAccessToken: async (): Promise<string | null> => {
      if (context.accessToken) {
        const expiry = context.session?.tokens?.expiry
        if (expiry && Date.now() + TOKEN_REFRESH_THRESHOLD >= expiry) {
          await context.refreshSession()
        }
        return context.accessToken
      }
      return null
    },
  }
}

export default SessionProvider
