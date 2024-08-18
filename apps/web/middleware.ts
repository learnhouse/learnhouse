import { isInstallModeEnabled } from '@services/install/install'
import {
  LEARNHOUSE_DOMAIN,
  LEARNHOUSE_HTTP_PROTOCOL,
  LEARNHOUSE_TOP_DOMAIN,
  getAPIUrl,
  getDefaultOrg,
  getUriWithOrg,
  getUriWithoutOrg,
  isMultiOrgModeEnabled,
} from './services/config/config'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

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
  if (pathname == '/redirect_from_auth') {
    if (cookie_orgslug) {
      const searchParams = req.nextUrl.searchParams
      const queryString = searchParams.toString()
      const redirectPathname = '/'
      const redirectUrl = new URL(
        getUriWithOrg(cookie_orgslug, redirectPathname),
        req.url
      )

      if (queryString) {
        redirectUrl.search = queryString
      }
      return NextResponse.redirect(redirectUrl)
    } else {
      return 'Did not find the orgslug in the cookie'
    }
  }

  // Multi Organization Mode
  if (hosting_mode === 'multi') {
    // Get the organization slug from the URL
    const orgslugFromSubdomain = fullhost
      ? fullhost.replace(`.${LEARNHOUSE_DOMAIN}`, '')
      : (default_org as string)

    // Check custom domain first
    let orgslug = orgslugFromSubdomain // Set a default value
    let InfoFromCustomDomain = null // Initialize to null
    try {
      console.log(getUriWithOrg('internal', `/api/domains?cleanDomain=${cleanDomain}`))
      const domain_check = await fetch(
        getUriWithOrg('internal', `/api/domains?cleanDomain=${cleanDomain}`)
      )
      if (!domain_check.ok) {
        console.log(`Error Response status: ${domain_check.status}`)
      } else {
        InfoFromCustomDomain = await domain_check.json()
        console.log('InfoFromCustomDomain', InfoFromCustomDomain)
      }
    } catch (error) {
      console.error('Failed to fetch domain information:', error)
    }

    if (InfoFromCustomDomain) {
      orgslug = InfoFromCustomDomain.orgslug
    }

    const response = NextResponse.rewrite(
      new URL(`/orgs/${orgslug}${pathname}`, req.url)
    )

    // Set the cookie with the orgslug value
    response.cookies.set({
      name: 'learnhouseOrgSlug',
      value: orgslug,
      domain:
        LEARNHOUSE_TOP_DOMAIN === 'localhost' ? '' : LEARNHOUSE_TOP_DOMAIN,
      path: '/',
    })

    // Set the cookie with the custom domain value if available
    if (InfoFromCustomDomain) {
      response.cookies.set({
        name: 'learnhouseCustomDomain',
        value: InfoFromCustomDomain.domain,
        domain: InfoFromCustomDomain.domain,
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
