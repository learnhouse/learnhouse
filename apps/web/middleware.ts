import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Admin surfaces (dashboard + course-builder editor) are English/LTR only,
// regardless of the learner-facing locale. Set a header so getServerLocale()
// can force 'en' for these routes and the <html lang dir> renders correctly.
//
// Matching paths:
//   /orgs/{anything}/dash/...   — admin dashboard
//   /editor/...                  — course-builder editor
const ADMIN_PATH_REGEX = /^\/(?:orgs\/[^/]+\/dash|editor)(?:\/|$)/

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const requestHeaders = new Headers(request.headers)

  if (ADMIN_PATH_REGEX.test(pathname)) {
    requestHeaders.set('x-lh-admin-route', '1')
  } else {
    // Ensure the header never leaks across requests.
    requestHeaders.delete('x-lh-admin-route')
  }

  return NextResponse.next({
    request: { headers: requestHeaders },
  })
}

export const config = {
  matcher: [
    // Run on everything except Next.js internals and static assets.
    '/((?!_next/|api/|favicon.ico|runtime-config.js|embed-bg.js|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|css|js|woff2?)$).*)',
  ],
}
