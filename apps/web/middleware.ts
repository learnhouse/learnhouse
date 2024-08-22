import { isInstallModeEnabled } from '@services/install/install'
import {
  LEARNHOUSE_DOMAIN,
  LEARNHOUSE_TOP_DOMAIN,
  getDefaultOrg,
  getUriWithOrg,
  isMultiOrgModeEnabled,
} from './services/config/config'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { fetchForCustomDomainInRegistry } from '@services/config/utils'

export const config = {
  matcher: [
    /*
     * Match all paths except for:
     * 1. /api routes
     * 2. /_next (Next.js internals)
     * 3. /fonts (inside /public)
     * 4. Umami Analytics
     * 4. /examples (inside /public)
     * 5. all root files inside /public (e.g. /favicon.ico)
     */
    '/((?!api|_next|fonts|umami|examples|[\\w-]+\\.\\w+).*)',
  ],
}

export default async function middleware(req: NextRequest) {
  // Get initial data
  const hosting_mode = isMultiOrgModeEnabled() ? 'multi' : 'single'
  const default_org = getDefaultOrg()
  const { pathname, search } = req.nextUrl
  const fullhost = req.headers ? req.headers.get('host') : ''
  const cleanDomain = fullhost ? fullhost.split(':')[0] : null
  const cookie_orgslug = req.cookies.get('learnhouseOrgSlug')?.value
  let orgslug = fullhost
    ? fullhost.replace(`.${LEARNHOUSE_DOMAIN}`, '')
    : (default_org as string)

  // Out of orgslug paths & rewrite
  const standard_paths = ['/home']
  const auth_paths = ['/login', '/signup', '/reset']
  if (standard_paths.includes(pathname)) {
    // Redirect to the same pathname with the original search params
    return NextResponse.rewrite(new URL(`${pathname}${search}`, req.url))
  }

  if (auth_paths.includes(pathname)) {
    const response = NextResponse.rewrite(
      new URL(`/auth${pathname}${search}`, req.url)
    )

    // Parse the search params
    const searchParams = new URLSearchParams(search)
    const orgslug = searchParams.get('orgslug')

    if (orgslug) {
      response.cookies.set({
        name: 'learnhouseOrgSlug',
        value: orgslug,
        domain:
          LEARNHOUSE_TOP_DOMAIN == 'localhost' ? '' : LEARNHOUSE_TOP_DOMAIN,
      })
    }
    return response
  }

  // Install Page (depreceated)
  if (pathname.startsWith('/install')) {
    // Check if install mode is enabled
    const install_mode = await isInstallModeEnabled()
    if (install_mode) {
      return NextResponse.rewrite(new URL(pathname, req.url))
    } else {
      return NextResponse.redirect(new URL('/', req.url))
    }
  }

  // Dynamic Pages Editor
  if (pathname.match(/^\/course\/[^/]+\/activity\/[^/]+\/edit$/)) {
    return NextResponse.rewrite(new URL(`/editor${pathname}`, req.url))
  }

  // Auth Redirects
  if (pathname === '/redirect_from_auth') {
    const searchParams = req.nextUrl.searchParams
    const queryString = searchParams.toString()

    // Check if orgslug is present in the cookie
    if (cookie_orgslug) {
      const redirectPathname = '/'
      const redirectUrl = new URL(
        getUriWithOrg(cookie_orgslug, redirectPathname),
        req.url
      )

      // Add query string if present
      if (queryString) {
        redirectUrl.search = queryString
      }

      // Handle custom domain if available
      const customDomainInfo =
        await fetchForCustomDomainInRegistry(cookie_orgslug)
      if (customDomainInfo?.domain) {
        redirectUrl.hostname = customDomainInfo.domain
      }

      return NextResponse.redirect(redirectUrl)
    } else {
      return new Response('Did not find the orgslug in the cookie', {
        status: 400,
      })
    }
  }

  // Multi-Organization Mode
  if (hosting_mode === 'multi') {
    // Determine the organization slug from the subdomain or use default
    const orgslug = fullhost
      ? fullhost.replace(`.${LEARNHOUSE_DOMAIN}`, '')
      : (default_org as string)

    // Check for custom domain and override orgslug if found
    const customDomainInfo = await fetchForCustomDomainInRegistry(cleanDomain)

    const resolvedOrgslug = customDomainInfo?.orgslug || orgslug

    // Rewrite the URL to include the resolved orgslug
    const response = NextResponse.rewrite(
      new URL(`/orgs/${resolvedOrgslug}${pathname}`, req.url)
    )

    // Set cookies for orgslug and custom domain if applicable
    const topDomain =
      LEARNHOUSE_TOP_DOMAIN === 'localhost' ? '' : LEARNHOUSE_TOP_DOMAIN

    response.cookies.set({
      name: 'learnhouseOrgSlug',
      value: resolvedOrgslug,
      domain: topDomain,
      path: '/',
    })

    if (customDomainInfo) {
      const { domain } = customDomainInfo
      response.cookies.set({
        name: 'learnhouseCustomDomain',
        value: domain,
        domain: domain,
        path: '/',
      })
    }

    return response
  }

  // Single Organization Mode
  if (hosting_mode === 'single') {
    // Get the default organization slug
    const orgslug = default_org as string
    const response = NextResponse.rewrite(
      new URL(`/orgs/${orgslug}${pathname}`, req.url)
    )

    // Set the cookie with the orgslug value
    response.cookies.set({
      name: 'learnhouseOrgSlug',
      value: orgslug,
      domain: LEARNHOUSE_TOP_DOMAIN == 'localhost' ? '' : LEARNHOUSE_TOP_DOMAIN,
      path: '/',
    })

    return response
  }
}
