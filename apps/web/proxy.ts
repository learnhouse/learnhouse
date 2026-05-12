import { getAPIUrl } from './services/config/config'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { isLocalhost as isLocalhostCheck } from './services/utils/ts/hostUtils'

// =============================================================================
// Tenancy
// =============================================================================
//
// Three runtime behaviors selected by `instance.tenancy`:
//
//   1. multi (EE-only):   slug.{LEARNHOUSE_DOMAIN} subdomain detection +
//                         per-org custom domains. The detection logic lives in
//                         `./ee/services/tenancy/...` and is dynamic-imported
//                         here — OSS proxy.ts never references subdomain or
//                         custom-domain helpers directly.
//   2. single (localhost): always serves the default org. Host-only cookies.
//   3. single (VPS):       any domain on a self-hosted VPS. Same as #2 — we
//                         trust the incoming Host header.
//
// Modes 2 and 3 share `tenancy === "single"`. The OSS code path returns the
// default org without ever calling subdomain extraction.

interface InstanceInfo {
  multi_org_enabled: boolean
  default_org_slug: string
  mode: 'saas' | 'oss' | 'ee'
  tenancy: 'multi' | 'single'
  frontend_domain: string
  top_domain: string
}

// Cached instance info from backend (30-second TTL)
let _instanceCache: { data: InstanceInfo; ts: number } | null = null
const INSTANCE_CACHE_TTL = 30 * 1000

async function getInstanceInfo(): Promise<InstanceInfo> {
  if (_instanceCache && Date.now() - _instanceCache.ts < INSTANCE_CACHE_TTL) {
    return _instanceCache.data
  }

  try {
    const apiUrl = getAPIUrl()
    const res = await fetch(`${apiUrl}instance/info`, { signal: AbortSignal.timeout(3000) })
    if (res.ok) {
      const raw = await res.json()
      // Older backends only return `multi_org_enabled`; derive `tenancy`.
      const tenancy: 'multi' | 'single' =
        raw.tenancy === 'multi' || raw.multi_org_enabled ? 'multi' : 'single'
      _instanceCache = { data: { ...raw, tenancy }, ts: Date.now() }
      return _instanceCache.data
    }
  } catch {
    // Backend unavailable — use safe defaults
  }
  return {
    multi_org_enabled: false,
    default_org_slug: 'default',
    mode: 'oss' as const,
    tenancy: 'single',
    frontend_domain: 'localhost:3000',
    top_domain: 'localhost',
  }
}

// =============================================================================
// Resolver
// =============================================================================

interface ResolvedTenant {
  slug: string
  customDomain?: string
  source: 'custom-domain' | 'subdomain' | 'cookie' | 'default'
}

/**
 * Resolve the active tenant for this request.
 *
 * In `single` tenancy this is unconditionally the default org — no EE code
 * loaded, no custom-domain lookup, no subdomain extraction. In `multi`
 * tenancy we delegate to the EE resolver via dynamic import; if the import
 * or resolver throws (e.g. EE folder removed at deploy time), we log and
 * fall back to the default org so the site stays up.
 */
async function resolveTenant(req: NextRequest, instance: InstanceInfo): Promise<ResolvedTenant> {
  if (instance.tenancy === 'single') {
    return { slug: instance.default_org_slug, source: 'default' }
  }

  try {
    const mod = await import('./ee/services/tenancy/resolveMulti.middleware')
    return await mod.resolveMultiFromRequest(req, instance)
  } catch (err) {
    console.warn('[proxy] EE multi-tenant resolver unavailable; falling back to default org', err)
    return { slug: instance.default_org_slug, source: 'default' }
  }
}

/**
 * In `multi` tenancy, ask the EE module whether this Host is a custom domain
 * (used by the `/redirect_from_auth` handler). Always false in `single`.
 */
async function hostIsCustomDomain(host: string | null, instance: InstanceInfo): Promise<boolean> {
  if (instance.tenancy === 'single' || !host) return false
  try {
    const mod = await import('./ee/services/tenancy/resolveMulti.middleware')
    return mod.isCustomDomain(host, instance.frontend_domain)
  } catch {
    return false
  }
}

/**
 * Detect the admin subdomain (multi tenancy only). In single mode there is no
 * admin subdomain — operators reach admin via /admin path.
 */
async function isAdminSubdomain(host: string | null, instance: InstanceInfo): Promise<boolean> {
  if (instance.tenancy === 'single' || !host) return false
  try {
    const mod = await import('./ee/services/tenancy/resolveMulti.middleware')
    return mod.extractOrgSubdomain(host, instance.frontend_domain) === 'admin'
      // The EE helper filters out reserved subdomains; check raw too:
      || host.split(':')[0] === `admin.${instance.frontend_domain.split(':')[0]}`
      || host.startsWith('admin.')
  } catch {
    return host.startsWith('admin.')
  }
}

// =============================================================================
// Cookies
// =============================================================================

/**
 * Compute the cookie `domain` attribute given the current tenant.
 * - single tenancy → '' (host-only cookie)
 * - multi tenancy + custom domain → '' (host-only cookie)
 * - multi tenancy + apex/subdomain → '.{top_domain}' (cross-subdomain auth)
 * - localhost in either mode → '' (browsers refuse `Domain=.localhost`)
 */
function cookieDomainFor(instance: InstanceInfo, customDomain?: string): string {
  if (instance.tenancy === 'single') return ''
  if (customDomain) return ''
  if (instance.top_domain === 'localhost') return ''
  return `.${instance.top_domain}`
}

function setOrgCookies(
  response: NextResponse,
  resolved: ResolvedTenant,
  instance: InstanceInfo,
) {
  const domain = cookieDomainFor(instance, resolved.customDomain)
  response.cookies.set({
    name: 'LH_org',
    value: resolved.slug,
    domain,
    path: '/',
  })
  if (resolved.customDomain) {
    response.cookies.set({
      name: 'LH_custom_domain',
      value: resolved.customDomain,
      path: '/',
    })
    response.headers.set('x-custom-domain', resolved.customDomain)
  }
}

function setInstanceCookies(response: NextResponse, info: InstanceInfo) {
  response.cookies.set({ name: 'LH_tenancy', value: info.tenancy, path: '/' })
  response.cookies.set({ name: 'LH_default_org', value: info.default_org_slug, path: '/' })
  response.cookies.set({ name: 'LH_frontend_domain', value: info.frontend_domain, path: '/' })
  response.cookies.set({ name: 'LH_top_domain', value: info.top_domain, path: '/' })
  response.cookies.set({ name: 'LH_mode', value: info.mode, path: '/' })
  return response
}

/**
 * Build a request-header bag that propagates tenancy context to downstream
 * Server Components on THIS request. Cookies set in the response only become
 * visible to RSC on the *next* request, so server-side helpers like
 * `getCanonicalUrl` can't rely on them on the first cold load. Reading the
 * `x-lh-*` headers via `next/headers` gives them an immediately-available
 * source of truth.
 */
function tenantRequestHeaders(
  req: NextRequest,
  resolved: ResolvedTenant,
  instance: InstanceInfo,
): Headers {
  const headers = new Headers(req.headers)
  headers.set('x-lh-tenancy', instance.tenancy)
  headers.set('x-lh-org', resolved.slug)
  headers.set('x-lh-top-domain', instance.top_domain)
  headers.set('x-lh-frontend-domain', instance.frontend_domain)
  headers.set('x-lh-mode', instance.mode)
  if (resolved.customDomain) {
    headers.set('x-lh-custom-domain', resolved.customDomain)
  }
  return headers
}

// =============================================================================
// Middleware
// =============================================================================

export const config = {
  matcher: [
    /*
     * Match all paths except for:
     * 1. /api routes
     * 2. /_next (Next.js internals)
     * 3. /fonts (inside /public)
     * 4. Umami Analytics
     * 5. /examples (inside /public)
     * 6. all root files inside /public (e.g. /favicon.ico)
     * 7. /embed (activity embeds)
     */
    '/((?!api|_next|fonts|umami|examples|embed|monitoring|[\\w-]+\\.\\w+).*)',
    '/sitemap.xml',
    '/robots.txt',
    '/payments/stripe/connect/oauth',
    '/podcast/:path*/feed',
  ],
}

export default async function proxy(req: NextRequest) {
  const instance = await getInstanceInfo()
  const { pathname, search } = req.nextUrl
  const fullhost = req.headers.get('host')

  // -------------------------------------------------------------------------
  // 1. Admin subdomain (multi only) → rewrite to /admin route group.
  //    Idempotent: if the path already starts with /admin (e.g. internal nav
  //    uses /admin/organizations so it works in both subdomain and path mode),
  //    don't double-prefix.
  // -------------------------------------------------------------------------
  if (await isAdminSubdomain(fullhost, instance)) {
    const target = pathname === '/admin' || pathname.startsWith('/admin/')
      ? pathname
      : `/admin${pathname}`
    const response = NextResponse.rewrite(new URL(`${target}${search}`, req.url))
    setInstanceCookies(response, instance)
    return response
  }

  // -------------------------------------------------------------------------
  // 1b. Admin path — direct /admin access works in any tenancy mode.
  //     In single mode this is the only way to reach the admin panel; in
  //     multi mode it's an alternative to the admin.{domain} subdomain.
  // -------------------------------------------------------------------------
  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    const response = NextResponse.rewrite(new URL(`${pathname}${search}`, req.url))
    setInstanceCookies(response, instance)
    return response
  }

  // -------------------------------------------------------------------------
  // 2. Standard out-of-org paths
  // -------------------------------------------------------------------------
  if (pathname === '/home') {
    return NextResponse.rewrite(new URL(`${pathname}${search}`, req.url))
  }

  // -------------------------------------------------------------------------
  // 3. Auth pages — resolve tenant for cookie context, rewrite to /auth
  // -------------------------------------------------------------------------
  const authPaths = ['/login', '/signup', '/reset', '/forgot', '/verify-email']
  if (authPaths.includes(pathname)) {
    const resolved = await resolveTenant(req, instance)
    const requestHeaders = tenantRequestHeaders(req, resolved, instance)
    const response = NextResponse.rewrite(
      new URL(`/auth${pathname}${search}`, req.url),
      { request: { headers: requestHeaders } },
    )
    setOrgCookies(response, resolved, instance)
    setInstanceCookies(response, instance)
    return response
  }

  // -------------------------------------------------------------------------
  // 4. Auth callbacks — pass through without org rewrite
  // -------------------------------------------------------------------------
  if (
    pathname.startsWith('/auth/sso/')
    || pathname.startsWith('/auth/callback/')
    || pathname.startsWith('/auth/token-exchange')
  ) {
    const response = NextResponse.rewrite(new URL(`${pathname}${search}`, req.url))
    setInstanceCookies(response, instance)
    return response
  }

  // -------------------------------------------------------------------------
  // 5. Standalone editors / boards — bypass org rewrite
  // -------------------------------------------------------------------------
  if (pathname.match(/^\/course\/[^/]+\/activity\/[^/]+\/edit$/)) {
    return NextResponse.rewrite(new URL(`/editor${pathname}`, req.url))
  }
  if (pathname.startsWith('/board/')) {
    const response = NextResponse.rewrite(new URL(pathname + search, req.url))
    setInstanceCookies(response, instance)
    return response
  }
  if (pathname.startsWith('/editor/playground/')) {
    const response = NextResponse.rewrite(new URL(pathname + search, req.url))
    setInstanceCookies(response, instance)
    return response
  }

  // -------------------------------------------------------------------------
  // 6. Stripe Connect OAuth callback — preserve search params + add orgslug
  // -------------------------------------------------------------------------
  if (req.nextUrl.pathname.startsWith('/payments/stripe/connect/oauth')) {
    const searchParams = req.nextUrl.searchParams
    const orgslug = searchParams.get('state')?.split('_')[0]
    const redirectUrl = new URL('/payments/stripe/connect/oauth', req.url)
    searchParams.forEach((value, key) => {
      redirectUrl.searchParams.append(key, value)
    })
    if (orgslug) {
      redirectUrl.searchParams.set('orgslug', orgslug)
    }
    return NextResponse.rewrite(redirectUrl)
  }

  // -------------------------------------------------------------------------
  // 7. Health check
  // -------------------------------------------------------------------------
  if (pathname.startsWith('/health')) {
    return NextResponse.rewrite(new URL(`/api/health`, req.url))
  }

  // -------------------------------------------------------------------------
  // 8. Auth redirect bridge (cross-domain return path)
  // -------------------------------------------------------------------------
  if (pathname === '/redirect_from_auth') {
    const queryString = req.nextUrl.searchParams.toString()
    const customDomain = req.cookies.get('LH_custom_domain')?.value

    let redirectUrl: URL
    if (customDomain) {
      const protocol = req.nextUrl.protocol + '//'
      redirectUrl = new URL(`${protocol}${customDomain}/`)
    } else {
      redirectUrl = new URL('/', req.url)
    }
    if (queryString) {
      redirectUrl.search = queryString
    }
    return NextResponse.redirect(redirectUrl)
  }

  // -------------------------------------------------------------------------
  // 9. Per-org metadata endpoints (sitemap, robots, podcast feed)
  // -------------------------------------------------------------------------
  if (pathname.match(/^\/podcast\/([^/]+)\/feed$/)) {
    const resolved = await resolveTenant(req, instance)
    const feedUrl = new URL(`/api${pathname}`, req.url)
    const response = NextResponse.rewrite(feedUrl)
    response.headers.set('X-Feed-Orgslug', resolved.slug)
    return response
  }
  if (pathname.startsWith('/sitemap.xml')) {
    const resolved = await resolveTenant(req, instance)
    const sitemapUrl = new URL(`/api/sitemap`, req.url)
    const response = NextResponse.rewrite(sitemapUrl)
    response.headers.set('X-Sitemap-Orgslug', resolved.slug)
    return response
  }
  if (pathname === '/robots.txt') {
    const resolved = await resolveTenant(req, instance)
    const robotsUrl = new URL(`/api/robots`, req.url)
    const response = NextResponse.rewrite(robotsUrl)
    response.headers.set('X-Robots-Orgslug', resolved.slug)
    return response
  }

  // -------------------------------------------------------------------------
  // 10. Apex picker (multi tenancy only) — bare apex root → /home picker
  // -------------------------------------------------------------------------
  if (
    instance.tenancy === 'multi'
    && pathname === '/'
    && fullhost
    && !isLocalhostCheck(fullhost)
    && !(await hostIsCustomDomain(fullhost, instance))
  ) {
    // Only show the picker on the bare apex (not on a subdomain). The
    // resolver returns source==='default' when no subdomain or custom
    // domain matched and we're on the apex.
    const resolved = await resolveTenant(req, instance)
    if (resolved.source === 'default') {
      const response = NextResponse.rewrite(new URL(`/home${search}`, req.url))
      setInstanceCookies(response, instance)
      return response
    }
  }

  // -------------------------------------------------------------------------
  // 11. Tenant-scoped rewrite — the catch-all that puts us under /orgs/{slug}
  // -------------------------------------------------------------------------
  const resolved = await resolveTenant(req, instance)
  const requestHeaders = tenantRequestHeaders(req, resolved, instance)
  const response = NextResponse.rewrite(
    new URL(`/orgs/${resolved.slug}${pathname}`, req.url),
    { request: { headers: requestHeaders } },
  )
  setOrgCookies(response, resolved, instance)
  setInstanceCookies(response, instance)
  return response
}
