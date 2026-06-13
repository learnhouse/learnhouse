import { NextRequest } from 'next/server'
import { isSubdomainOf, isSameHost, isLocalhost, stripPort } from '@services/utils/ts/hostUtils'
import { getConfig } from '@services/config/config'

export const ACCESS_TOKEN_COOKIE = 'LH_access'
export const REFRESH_TOKEN_COOKIE = 'LH_refresh'
export const ACCESS_TOKEN_MAX_AGE = 8 * 60 * 60 // 8 hours
export const REFRESH_TOKEN_MAX_AGE = 30 * 24 * 60 * 60 // 30 days

export function getDomainFromRequest(request: NextRequest): { domain: string; topDomain: string } {
  const envDomain = getConfig('NEXT_PUBLIC_LEARNHOUSE_DOMAIN')
  const envTopDomain = getConfig('NEXT_PUBLIC_LEARNHOUSE_TOP_DOMAIN')
  if (envDomain) {
    return {
      domain: envDomain,
      topDomain: stripPort(envTopDomain || envDomain),
    }
  }

  const cookieDomain = request.cookies.get('LH_frontend_domain')?.value
  const cookieTopDomain = request.cookies.get('LH_top_domain')?.value
  if (cookieDomain) {
    return {
      domain: cookieDomain,
      topDomain: stripPort(cookieTopDomain || cookieDomain),
    }
  }

  return { domain: 'localhost', topDomain: 'localhost' }
}

export function getCookieDomain(request: NextRequest): string | undefined {
  // Tenancy is the source of truth: in single mode cookies are always
  // host-only on whatever Host the request arrived with, regardless of
  // whether that's localhost or a self-hosted VPS hostname. In multi mode
  // we use the configured top domain so subdomains share the session.
  const tenancy = request.cookies.get('LH_tenancy')?.value || 'single'
  if (tenancy === 'single') return undefined

  const host = request.headers.get('host')
  const { domain, topDomain } = getDomainFromRequest(request)

  if (isLocalhost(host)) return undefined
  if (topDomain === 'localhost') return undefined
  if (isSubdomainOf(host, domain) || isSameHost(host, domain)) {
    return `.${topDomain}`
  }
  // Custom (per-org) domain in multi mode → host-only.
  return undefined
}

export function getCookieOptions(request: NextRequest) {
  const isSecure = request.nextUrl.protocol === 'https:'
  const domain = getCookieDomain(request)
  // Embedded in the PSP shell (cross-origin iframe): browsers only send cookies
  // on cross-site subrequests when SameSite=None; Secure. Gated by env so
  // standalone LearnHouse keeps its stricter Lax default. SameSite=None REQUIRES
  // Secure, so force secure in embed mode (the shell is always HTTPS).
  const embedMode = getConfig('NEXT_PUBLIC_LEARNHOUSE_EMBED_MODE') === 'true'
  return {
    httpOnly: true,
    secure: embedMode ? true : isSecure,
    sameSite: embedMode ? ('none' as const) : ('lax' as const),
    path: '/',
    ...(domain ? { domain } : {}),
  }
}
