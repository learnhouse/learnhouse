import {
  getLEARNHOUSE_DOMAIN_VAL,
  getLEARNHOUSE_TOP_DOMAIN_VAL,
  getDefaultOrg,
  isMultiOrgModeEnabled,
  getAPIUrl,
} from './services/config/config'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { stripPort, isSubdomainOf, isSameHost, extractSubdomain, isLocalhost as isLocalhostCheck } from './services/utils/ts/hostUtils'

// Helper function to resolve custom domain to org
async function resolveCustomDomain(domain: string): Promise<{ slug: string } | null> {
  try {
    const apiUrl = getAPIUrl()
    const res = await fetch(`${apiUrl}orgs/resolve/domain/${encodeURIComponent(stripPort(domain))}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      // Short timeout for middleware
      signal: AbortSignal.timeout(5000),
    })
    if (res.ok) {
      const data = await res.json()
      return { slug: data.org_slug }
    }
    return null
  } catch (error) {
    console.error('Error resolving custom domain:', error)
    return null
  }
}

// Check if the host is a custom domain (not a subdomain of LEARNHOUSE_DOMAIN)
function isCustomDomain(fullhost: string | null): boolean {
  if (!fullhost) return false
  const domain = getLEARNHOUSE_DOMAIN_VAL()
  return !isSubdomainOf(fullhost, domain) && !isSameHost(fullhost, domain) && !isLocalhostCheck(fullhost)
}

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
     * 6. /embed (activity embeds)
     */
    '/((?!api|_next|fonts|umami|examples|embed|monitoring|[\\w-]+\\.\\w+).*)',
    '/sitemap.xml',
    '/payments/stripe/connect/oauth',
  ],
}

export default async function proxy(req: NextRequest) {
  // Get initial data
  const hosting_mode = isMultiOrgModeEnabled() ? 'multi' : 'single'
  const default_org = getDefaultOrg()
  const { pathname, search } = req.nextUrl
  const fullhost = req.headers ? req.headers.get('host') : ''
  // Check both old and new cookie names for backward compatibility
  const cookie_orgslug = req.cookies.get('learnhouse_orgslug')?.value || req.cookies.get('learnhouse_current_orgslug')?.value

  // Cache custom domain resolution within this middleware invocation
  let _resolvedCustomDomainOrg: { slug: string } | null | undefined = undefined
  async function getResolvedCustomDomain(host: string): Promise<{ slug: string } | null> {
    if (_resolvedCustomDomainOrg !== undefined) return _resolvedCustomDomainOrg
    _resolvedCustomDomainOrg = await resolveCustomDomain(host)
    return _resolvedCustomDomainOrg
  }
  

  // Out of orgslug paths & rewrite
  const standard_paths = ['/home']
  const auth_paths = ['/login', '/signup', '/reset', '/forgot', '/verify-email']
  if (standard_paths.includes(pathname)) {
    // Redirect to the same pathname with the original search params
    return NextResponse.rewrite(new URL(`${pathname}${search}`, req.url))
  }

  if (auth_paths.includes(pathname)) {
    const LEARNHOUSE_DOMAIN = getLEARNHOUSE_DOMAIN_VAL()
    const LEARNHOUSE_TOP_DOMAIN = getLEARNHOUSE_TOP_DOMAIN_VAL()

    // Resolve orgslug: custom domain > subdomain > cookie
    let orgslug: string | undefined
    let customDomain: string | undefined

    // 1. Check for custom domain first
    if (isCustomDomain(fullhost)) {
      const resolvedOrg = await getResolvedCustomDomain(fullhost as string)
      if (resolvedOrg) {
        orgslug = resolvedOrg.slug
        customDomain = fullhost as string
      }
    }

    // 2. Try to extract from subdomain
    if (!orgslug && fullhost && !isSameHost(fullhost, LEARNHOUSE_DOMAIN)) {
      const extracted = extractSubdomain(fullhost, LEARNHOUSE_DOMAIN)
      if (extracted && extracted !== 'auth' && extracted !== 'www' && extracted !== 'api') {
        orgslug = extracted
      }
    }

    // 3. Fall back to cookie
    if (!orgslug) {
      orgslug = cookie_orgslug
    }

    const response = NextResponse.rewrite(
      new URL(`/auth${pathname}${search}`, req.url)
    )

    // Set cookie if we have an orgslug
    if (orgslug) {
      // For custom domains, don't set domain on cookies (let them be host-specific)
      const cookieDomain = customDomain ? '' : (LEARNHOUSE_TOP_DOMAIN == 'localhost' ? '' : `.${LEARNHOUSE_TOP_DOMAIN}`)

      // Set both old and new cookie names for compatibility
      response.cookies.set({
        name: 'learnhouse_current_orgslug',
        value: orgslug,
        domain: cookieDomain,
        path: '/',
      })
      response.cookies.set({
        name: 'learnhouse_orgslug',
        value: orgslug,
        domain: cookieDomain,
        path: '/',
      })

      // Set custom domain cookie if applicable
      if (customDomain) {
        response.cookies.set({
          name: 'learnhouse_custom_domain',
          value: customDomain,
          path: '/',
        })
        response.headers.set('x-custom-domain', customDomain)
      }
    }

    return response
  }

  // Auth callbacks - pass through without org rewrite
  if (pathname.startsWith('/auth/sso/') || pathname.startsWith('/auth/callback/')) {
    return NextResponse.rewrite(new URL(`${pathname}${search}`, req.url))
  }

  // Dynamic Pages Editor
  if (pathname.match(/^\/course\/[^/]+\/activity\/[^/]+\/edit$/)) {
    return NextResponse.rewrite(new URL(`/editor${pathname}`, req.url))
  }

  // Check if the request is for the Stripe callback URL
  if (req.nextUrl.pathname.startsWith('/payments/stripe/connect/oauth')) {
    const searchParams = req.nextUrl.searchParams
    const orgslug = searchParams.get('state')?.split('_')[0] // Assuming state parameter contains orgslug_randomstring
    
    // Construct the new URL with the required parameters
    const redirectUrl = new URL('/payments/stripe/connect/oauth', req.url)
    
    // Preserve all original search parameters
    searchParams.forEach((value, key) => {
      redirectUrl.searchParams.append(key, value)
    })
    
    // Add orgslug if available
    if (orgslug) {
      redirectUrl.searchParams.set('orgslug', orgslug)
    }

    return NextResponse.rewrite(redirectUrl)
  }

  // Health Check
  if (pathname.startsWith('/health')) {
    return NextResponse.rewrite(new URL(`/api/health`, req.url))
  }

  // Auth Redirects
  if (pathname == '/redirect_from_auth') {
    const searchParams = req.nextUrl.searchParams
    const queryString = searchParams.toString()
    const redirectPathname = '/'

    // Check if we have a custom domain cookie
    const customDomain = req.cookies.get('learnhouse_custom_domain')?.value
    let redirectUrl: URL

    if (customDomain) {
      // Redirect to the custom domain
      const protocol = req.nextUrl.protocol + '//'
      redirectUrl = new URL(`${protocol}${customDomain}${redirectPathname}`)
    } else {
      // Redirect to root on the same origin the request came from
      redirectUrl = new URL(redirectPathname, req.url)
    }

    if (queryString) {
      redirectUrl.search = queryString
    }
    return NextResponse.redirect(redirectUrl)
  }

  if (pathname.startsWith('/sitemap.xml')) {
    let orgslug: string;

    if (hosting_mode === 'multi') {
      orgslug = extractSubdomain(fullhost, getLEARNHOUSE_DOMAIN_VAL()) || (default_org as string);
    } else {
      // Single hosting mode
      orgslug = default_org as string;
    }

    const sitemapUrl = new URL(`/api/sitemap`, req.url);

    // Create a response object
    const response = NextResponse.rewrite(sitemapUrl);

    // Set the orgslug in a header
    response.headers.set('X-Sitemap-Orgslug', orgslug);

    return response;
  }

  // Custom Domain Detection - check before multi-org mode
  if (isCustomDomain(fullhost)) {
    const resolvedOrg = await getResolvedCustomDomain(fullhost as string)
    if (resolvedOrg) {
      const response = NextResponse.rewrite(
        new URL(`/orgs/${resolvedOrg.slug}${pathname}`, req.url)
      )

      // Set cookies for the org
      response.cookies.set({
        name: 'learnhouse_current_orgslug',
        value: resolvedOrg.slug,
        path: '/',
      })
      response.cookies.set({
        name: 'learnhouse_orgslug',
        value: resolvedOrg.slug,
        path: '/',
      })
      // Set custom domain cookie for link handling
      response.cookies.set({
        name: 'learnhouse_custom_domain',
        value: fullhost as string,
        path: '/',
      })
      // Set header for server components
      response.headers.set('x-custom-domain', fullhost as string)

      return response
    }
    // If custom domain not found, fall through to default behavior
  }

  // Multi Organization Mode
  if (hosting_mode === 'multi') {
    // Get the organization slug from the URL
    const LEARNHOUSE_DOMAIN = getLEARNHOUSE_DOMAIN_VAL()
    const LEARNHOUSE_TOP_DOMAIN = getLEARNHOUSE_TOP_DOMAIN_VAL()

    let orgslug: string;
    const extracted = extractSubdomain(fullhost, LEARNHOUSE_DOMAIN)
    if (extracted) {
      orgslug = extracted
    } else if (isLocalhostCheck(fullhost)) {
      orgslug = default_org as string
    } else if (fullhost && !isSameHost(fullhost, LEARNHOUSE_DOMAIN)) {
      orgslug = cookie_orgslug || (default_org as string)
    } else {
      orgslug = default_org as string
    }

    const response = NextResponse.rewrite(
      new URL(`/orgs/${orgslug}${pathname}`, req.url)
    )

    // Set the cookie with the orgslug value (both old and new names)
    response.cookies.set({
      name: 'learnhouse_current_orgslug',
      value: orgslug,
      domain: LEARNHOUSE_TOP_DOMAIN == 'localhost' ? '' : `.${LEARNHOUSE_TOP_DOMAIN}`,
      path: '/',
    })
    response.cookies.set({
      name: 'learnhouse_orgslug',
      value: orgslug,
      domain: LEARNHOUSE_TOP_DOMAIN == 'localhost' ? '' : `.${LEARNHOUSE_TOP_DOMAIN}`,
      path: '/',
    })

    return response
  }

  // Single Organization Mode
  if (hosting_mode === 'single') {
    // Get the default organization slug
    const LEARNHOUSE_TOP_DOMAIN = getLEARNHOUSE_TOP_DOMAIN_VAL()
    const orgslug = default_org as string
    const response = NextResponse.rewrite(
      new URL(`/orgs/${orgslug}${pathname}`, req.url)
    )

    // Set the cookie with the orgslug value (both old and new names)
    response.cookies.set({
      name: 'learnhouse_current_orgslug',
      value: orgslug,
      domain: LEARNHOUSE_TOP_DOMAIN == 'localhost' ? '' : `.${LEARNHOUSE_TOP_DOMAIN}`,
      path: '/',
    })
    response.cookies.set({
      name: 'learnhouse_orgslug',
      value: orgslug,
      domain: LEARNHOUSE_TOP_DOMAIN == 'localhost' ? '' : `.${LEARNHOUSE_TOP_DOMAIN}`,
      path: '/',
    })

    return response
  }
}
