import {
  getLEARNHOUSE_DOMAIN_VAL,
  getLEARNHOUSE_TOP_DOMAIN_VAL,
  getDefaultOrg,
  getUriWithOrg,
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
    '/sitemap.xml',
    '/payments/stripe/connect/oauth',
  ],
}

export default async function proxy(req: NextRequest) {
  // #region agent log
  fetch('http://127.0.0.1:7246/ingest/b5809cb2-007a-4cd7-a186-acec190776fc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'middleware.ts:28',message:'Middleware entry',data:{pathname:req.nextUrl.pathname,search:req.nextUrl.search,host:req.headers.get('host')},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
  // #endregion

  // Get initial data
  const hosting_mode = isMultiOrgModeEnabled() ? 'multi' : 'single'
  const default_org = getDefaultOrg()
  const { pathname, search } = req.nextUrl
  const fullhost = req.headers ? req.headers.get('host') : ''
  const cookie_orgslug = req.cookies.get('learnhouse_current_orgslug')?.value
  
  // #region agent log
  fetch('http://127.0.0.1:7246/ingest/b5809cb2-007a-4cd7-a186-acec190776fc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'middleware.ts:36',message:'Path parsed',data:{pathname,search,hosting_mode,default_org},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
  // #endregion

  // Out of orgslug paths & rewrite
  const standard_paths = ['/home']
  const auth_paths = ['/login', '/signup', '/reset', '/forgot']
  
  // #region agent log
  fetch('http://127.0.0.1:7246/ingest/b5809cb2-007a-4cd7-a186-acec190776fc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'middleware.ts:42',message:'Checking auth paths',data:{pathname,isAuthPath:auth_paths.includes(pathname)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
  // #endregion

  if (standard_paths.includes(pathname)) {
    // Redirect to the same pathname with the original search params
    return NextResponse.rewrite(new URL(`${pathname}${search}`, req.url))
  }

  if (auth_paths.includes(pathname)) {
    // #region agent log
    fetch('http://127.0.0.1:7246/ingest/b5809cb2-007a-4cd7-a186-acec190776fc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'middleware.ts:48',message:'Auth path matched, rewriting',data:{pathname,rewriteTo:`/auth${pathname}${search}`},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion

    const response = NextResponse.rewrite(
      new URL(`/auth${pathname}${search}`, req.url)
    )

    // Parse the search params
    const searchParams = new URLSearchParams(search)
    const orgslug = searchParams.get('orgslug')

    if (orgslug) {
      const LEARNHOUSE_TOP_DOMAIN = getLEARNHOUSE_TOP_DOMAIN_VAL()
      response.cookies.set({
        name: 'learnhouse_current_orgslug',
        value: orgslug,
        domain:
          LEARNHOUSE_TOP_DOMAIN == 'localhost' ? '' : LEARNHOUSE_TOP_DOMAIN,
      })
    }
    return response
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

  if (pathname.startsWith('/sitemap.xml')) {
    let orgslug: string;
    
    const LEARNHOUSE_DOMAIN = getLEARNHOUSE_DOMAIN_VAL()
    if (hosting_mode === 'multi') {
      orgslug = fullhost
        ? fullhost.replace(`.${LEARNHOUSE_DOMAIN}`, '')
        : (default_org as string);
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

  // Multi Organization Mode
  if (hosting_mode === 'multi') {
    // Get the organization slug from the URL
    const LEARNHOUSE_DOMAIN = getLEARNHOUSE_DOMAIN_VAL()
    const LEARNHOUSE_TOP_DOMAIN = getLEARNHOUSE_TOP_DOMAIN_VAL()
    const orgslug = fullhost
      ? fullhost.replace(`.${LEARNHOUSE_DOMAIN}`, '')
      : (default_org as string)
    const response = NextResponse.rewrite(
      new URL(`/orgs/${orgslug}${pathname}`, req.url)
    )

    // Set the cookie with the orgslug value
    response.cookies.set({
      name: 'learnhouse_current_orgslug',
      value: orgslug,
      domain: LEARNHOUSE_TOP_DOMAIN == 'localhost' ? '' : LEARNHOUSE_TOP_DOMAIN,
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

    // Set the cookie with the orgslug value
    response.cookies.set({
      name: 'learnhouse_current_orgslug',
      value: orgslug,
      domain: LEARNHOUSE_TOP_DOMAIN == 'localhost' ? '' : LEARNHOUSE_TOP_DOMAIN,
      path: '/',
    })

    return response
  }
}

