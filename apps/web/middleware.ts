import { isInstallModeEnabled } from "@services/install/install";
import { LEARNHOUSE_DOMAIN, getDefaultOrg, isMultiOrgModeEnabled } from "./services/config/config";
import { getLocale } from "./i18n/i18n";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export const config = {
  matcher: [
    /*
     * Match all paths except for:
     * 1. /api routes
     * 2. /_next (Next.js internals)
     * 3. /fonts (inside /public)
     * 4. /examples (inside /public)
     * 5. all root files inside /public (e.g. /favicon.ico)
     */
    "/((?!api|_next|fonts|examples|[\\w-]+\\.\\w+).*)",
  ],
};

export default async function middleware(req: NextRequest) {
  // Get initial data
  const hosting_mode = isMultiOrgModeEnabled() ? "multi" : "single";
  const default_org = getDefaultOrg();
  const pathname = req.nextUrl.pathname;
  const fullhost = req.headers ? req.headers.get("host") : "";

  // i18n middleware
  const locale = getLocale(req);

  // Organizations & Global settings
  if (pathname.startsWith("/organizations")) {
    return NextResponse.rewrite(new URL(`/${locale}${pathname}`, req.url));
  }

  // Install Page
  if (pathname.startsWith("/install")) {
    // Check if install mode is enabled
    const install_mode = await isInstallModeEnabled();
    if (install_mode) {
      return NextResponse.rewrite(new URL(pathname, req.url));
    } else {
      return NextResponse.redirect(new URL(`/${locale}${pathname}`, req.url));
    }
  }

  // Dynamic Pages Editor
  if (pathname.match(/^\/course\/[^/]+\/activity\/[^/]+\/edit$/)) {
    return NextResponse.rewrite(new URL(`/${locale}/editor${pathname}`, req.url));
  }

  // Multi Organization Mode
  if (hosting_mode === "multi") {
    // Get the organization slug from the URL
    const orgslug = fullhost ? fullhost.replace(`.${LEARNHOUSE_DOMAIN}`, "") : default_org;
    return NextResponse.rewrite(new URL(`/${locale}/orgs/${orgslug}${pathname}`, req.url));
  }

  // Single Organization Mode
  if (hosting_mode === "single") {
    // Get the default organization slug
    const orgslug = default_org;
    return NextResponse.rewrite(new URL(`/${locale}/orgs/${orgslug}${pathname}`, req.url));
  }
}
