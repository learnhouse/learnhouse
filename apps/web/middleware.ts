import { isInstallModeEnabled } from '@services/install/install'
import {
  LEARNHOUSE_DOMAIN,
  getDefaultOrg,
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
  let orgslug = fullhost
    ? fullhost.replace(`.${LEARNHOUSE_DOMAIN}`, '')
    : (default_org as string)

  if (fullhost) {
    req.headers.set('X-Forwarded-Host', fullhost)
  }

  // Out of orgslug paths & rewrite
  const standard_paths = ['/home']
  if (standard_paths.includes(pathname)) {
    // Redirect to the same pathname with the original search params
    return NextResponse.rewrite(new URL(`${pathname}${search}`, req.url))
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

  // Multi-Organization Mode
  if (hosting_mode === 'multi') {
    // Check for custom domain and override orgslug if found
    const customDomainInfo = await fetchForCustomDomainInRegistry(cleanDomain)

    const resolvedOrgslug = customDomainInfo?.orgslug || orgslug

    // Rewrite the URL to include the resolved orgslug
    const response = NextResponse.rewrite(
      new URL(`/orgs/${resolvedOrgslug}${pathname}`, req.url)
    )

    return response
  }

  // Single Organization Mode
  if (hosting_mode === 'single') {
    // Get the default organization slug
    const orgslug = default_org as string
    const response = NextResponse.rewrite(
      new URL(`/orgs/${orgslug}${pathname}`, req.url)
    )

    return response
  }
}
