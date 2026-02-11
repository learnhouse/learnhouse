import {
  getAPIUrl,
  getConfig,
} from './services/config/config'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { stripPort, isSubdomainOf, isSameHost, extractSubdomain, isLocalhost as isLocalhostCheck } from './services/utils/ts/hostUtils'

// Cached instance info from backend (1-hour TTL)
interface InstanceInfo {
  multi_org_enabled: boolean
  default_org_slug: string
  ee_enabled: boolean
  frontend_domain: string
  top_domain: string
}
let _instanceCache: { data: InstanceInfo; ts: number } | null = null
const INSTANCE_CACHE_TTL = 60 * 60 * 1000 // 1 hour

async function getInstanceInfo(): Promise<InstanceInfo> {
  if (_instanceCache && Date.now() - _instanceCache.ts < INSTANCE_CACHE_TTL) {
    return _instanceCache.data
  }

  // Use the same getAPIUrl() that resolveCustomDomain() uses — it already works
  // in production via runtime env vars injected by server-wrapper.js.
  try {
    const apiUrl = getAPIUrl()
    const res = await fetch(`${apiUrl}instance/info`, { signal: AbortSignal.timeout(3000) })
    if (res.ok) {
      _instanceCache = { data: await res.json(), ts: Date.now() }
      return _instanceCache.data
    }
  } catch {
    // Backend unavailable — use defaults
  }
  return { multi_org_enabled: false, default_org_slug: 'default', ee_enabled: false, frontend_domain: 'localhost:3000', top_domain: 'localhost' }
}

// Set instance info cookies on a response so client-side can read them synchronously
function setInstanceCookies(response: NextResponse, info: InstanceInfo) {
  response.cookies.set({ name: 'learnhouse_multi_org', value: String(info.multi_org_enabled), path: '/' })
  response.cookies.set({ name: 'learnhouse_default_org', value: info.default_org_slug, path: '/' })
  response.cookies.set({ name: 'learnhouse_frontend_domain', value: info.frontend_domain, path: '/' })
  response.cookies.set({ name: 'learnhouse_top_domain', value: info.top_domain, path: '/' })
  return response
}

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
function isCustomDomain(fullhost: string | null, domain: string): boolean {
  if (!fullhost) return false
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
    '/robots.txt',
    '/payments/stripe/connect/oauth',
  ],
}

export default async function proxy(req: NextRequest) {
  // Fetch instance config from backend (cached 10 min)
  const instanceInfo = await getInstanceInfo()
  const hosting_mode = instanceInfo.multi_org_enabled ? 'multi' : 'single'
  const default_org = instanceInfo.default_org_slug
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

  // Admin subdomain detection — rewrite to /admin route group
  // Use prefix check as primary (works even when backend fetch fails in Edge Runtime
  // where NEXT_PUBLIC_ env vars are inlined at build time and may be localhost defaults).
  // Fall back to extractSubdomain for correctness when instanceInfo is available.
  const hostbare = stripPort(fullhost)
  const isAdminSubdomain = hostbare?.startsWith('admin.') ||
    (fullhost ? extractSubdomain(fullhost, instanceInfo.frontend_domain) === 'admin' : false)
  if (isAdminSubdomain) {
    const response = NextResponse.rewrite(new URL(`/admin${pathname}${search}`, req.url))
    setInstanceCookies(response, instanceInfo)
    return response
  }
  if (standard_paths.includes(pathname)) {
    // Redirect to the same pathname with the original search params
    return NextResponse.rewrite(new URL(`${pathname}${search}`, req.url))
  }

  if (auth_paths.includes(pathname)) {
    const LEARNHOUSE_DOMAIN = instanceInfo.frontend_domain
    const LEARNHOUSE_TOP_DOMAIN = instanceInfo.top_domain

    // Resolve orgslug: custom domain > subdomain > cookie
    let orgslug: string | undefined
    let customDomain: string | undefined

    // 1. Check for custom domain first
    if (isCustomDomain(fullhost, LEARNHOUSE_DOMAIN)) {
      const resolvedOrg = await getResolvedCustomDomain(fullhost as string)
      if (resolvedOrg) {
        orgslug = resolvedOrg.slug
        customDomain = fullhost as string
      }
    }

    // 2. Try to extract from subdomain
    if (!orgslug && fullhost && !isSameHost(fullhost, LEARNHOUSE_DOMAIN)) {
      const extracted = extractSubdomain(fullhost, LEARNHOUSE_DOMAIN)
      if (extracted && extracted !== 'auth' && extracted !== 'www' && extracted !== 'api' && extracted !== 'admin') {
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

    setInstanceCookies(response, instanceInfo)
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

    // Check custom domain first (fixes bug where sitemap ran before custom domain detection)
    if (isCustomDomain(fullhost, instanceInfo.frontend_domain)) {
      const resolvedOrg = await getResolvedCustomDomain(fullhost as string)
      if (resolvedOrg) {
        orgslug = resolvedOrg.slug
      } else {
        orgslug = default_org as string
      }
    } else if (hosting_mode === 'multi') {
      orgslug = extractSubdomain(fullhost, instanceInfo.frontend_domain) || (default_org as string);
    } else {
      orgslug = default_org as string;
    }

    const sitemapUrl = new URL(`/api/sitemap`, req.url);
    const response = NextResponse.rewrite(sitemapUrl);
    response.headers.set('X-Sitemap-Orgslug', orgslug);
    return response;
  }

  if (pathname === '/robots.txt') {
    let orgslug: string;

    if (isCustomDomain(fullhost, instanceInfo.frontend_domain)) {
      const resolvedOrg = await getResolvedCustomDomain(fullhost as string)
      orgslug = resolvedOrg?.slug || (default_org as string)
    } else if (hosting_mode === 'multi') {
      orgslug = extractSubdomain(fullhost, instanceInfo.frontend_domain) || (default_org as string);
    } else {
      orgslug = default_org as string;
    }

    const robotsUrl = new URL(`/api/robots`, req.url);
    const response = NextResponse.rewrite(robotsUrl);
    response.headers.set('X-Robots-Orgslug', orgslug);
    return response;
  }

  // Custom Domain Detection - check before multi-org mode
  if (isCustomDomain(fullhost, instanceInfo.frontend_domain)) {
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

      setInstanceCookies(response, instanceInfo)
      return response
    }
    // If custom domain not found, fall through to default behavior
  }

  // Multi Organization Mode
  if (hosting_mode === 'multi') {
    // Get the organization slug from the URL
    const LEARNHOUSE_DOMAIN = instanceInfo.frontend_domain
    const LEARNHOUSE_TOP_DOMAIN = instanceInfo.top_domain

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

    setInstanceCookies(response, instanceInfo)
    return response
  }

  // Single Organization Mode
  if (hosting_mode === 'single') {
    // Get the default organization slug
    const LEARNHOUSE_TOP_DOMAIN = instanceInfo.top_domain
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

    setInstanceCookies(response, instanceInfo)
    return response
  }
}
