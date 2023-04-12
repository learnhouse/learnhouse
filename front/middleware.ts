
import { NextRequest, NextResponse } from "next/server";

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
    "/((?!api|_next|fonts|login|signup|examples|[\\w-]+\\.\\w+).*)",
  ],
};


export default function middleware(req: NextRequest) {
  const LEARNHOUSE_DOMAIN = process.env.NEXT_PUBLIC_LEARNHOUSE_DOMAIN;
  const url = req.nextUrl;
  const isSelfHosted = process.env.NEXT_PUBLIC_LEARNHOUSE_SELF_HOSTED === "true" ? true : false
  const hostname = req.headers.get("host") || "learnhouse.app";
  const defaultOrg = isSelfHosted ? process.env.NEXT_PUBLIC_LEARNHOUSE_DEFAULT_ORG : null;
  let currentHost = hostname.replace(`.${LEARNHOUSE_DOMAIN}`, "");

  if (!isSelfHosted && currentHost === LEARNHOUSE_DOMAIN && !url.pathname.startsWith("/organizations")) {
    // Redirect to error page if not self-hosted and on localhost
    const errorUrl = "/error";
    return NextResponse.redirect(errorUrl, { status: 302 });
  }

  if (url.pathname.match(/^\/course\/[^/]+\/activity\/[^/]+\/edit$/)) {
    url.pathname = `/_editor${url.pathname}`;
    return NextResponse.rewrite(url, { headers: { orgslug: currentHost } });
  }

  

  if (isSelfHosted) {
    currentHost =  defaultOrg || currentHost;
  }

  url.pathname = `/_orgs/${currentHost}${url.pathname}`;
  return NextResponse.rewrite(url, { headers: { orgslug: currentHost } });
}
