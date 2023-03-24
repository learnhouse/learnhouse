import { getDefaultOrg, getSelfHostedOption } from "@services/config/config";
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
  const url = req.nextUrl;
  const isSelfHosted = getSelfHostedOption();
  const hostname = req.headers.get("host") || "learnhouse.app";
  let currentHost = hostname.replace(".localhost:3000", "");
  
  if (!isSelfHosted && currentHost === ("localhost:3000")) {
    // Redirect to error page if not self-hosted and on localhost
    const errorUrl = "/error";
    return NextResponse.redirect(errorUrl, { status: 302 });
  }

  if (url.pathname.match(/^\/course\/[^/]+\/activity\/[^/]+\/edit$/)) {
    url.pathname = `/_editor${url.pathname}`;
    return NextResponse.rewrite(url, { headers: { orgslug: currentHost } });
  }

  if (url.pathname.startsWith("/organizations")) {
    url.pathname = url.pathname.replace("/organizations", `/organizations${currentHost}`).replace("localhost:3000", "");
    return NextResponse.rewrite(url);
  }

  if (isSelfHosted) {
    currentHost = getDefaultOrg() || currentHost;
  }

  url.pathname = `/_orgs/${currentHost}${url.pathname}`;
  return NextResponse.rewrite(url, { headers: { orgslug: currentHost } });
}
