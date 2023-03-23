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

  // Get hostname of request (e.g. demo.vercel.pub, demo.localhost:3000)
  const hostname = req.headers.get("host") || "learnhouse.app";

  /*  You have to replace ".vercel.pub" with your own domain if you deploy this example under your domain.
      You can also use wildcard subdomains on .vercel.app links that are associated with your Vercel team slug
      in this case, our team slug is "platformize", thus *.platformize.vercel.app works. Do note that you'll
      still need to add "*.platformize.vercel.app" as a wildcard domain on your Vercel dashboard. */
  let currentHost =
    process.env.NODE_ENV === "production" && process.env.VERCEL === "1"
      ? hostname.replace(`.vercel.pub`, "").replace(`.platformize.vercel.app`, "")
      : hostname.replace(`.localhost:3000`, "");

  /*  Editor route */
  if (url.pathname.match(/^\/course\/[^/]+\/activity\/[^/]+\/edit$/)) {
    url.pathname = `/_editor${url.pathname}`;
    console.log("editor route", url.pathname);

    return NextResponse.rewrite(url, { headers: { orgslug: currentHost } });
  }

  /*  Organizations route */
  if (url.pathname.startsWith("/organizations")) {
    url.pathname = url.pathname.replace("/organizations", `/organizations${currentHost}`);
    // remove localhost:3000 from url
    url.pathname = url.pathname.replace(`localhost:3000`, "");
    
    
    return NextResponse.rewrite(url);
  }

  console.log("currentHost", url);

  // rewrite everything else to `/_sites/[site] dynamic route
  url.pathname = `/_orgs/${currentHost}${url.pathname}`;

  return NextResponse.rewrite(url, { headers: { olgslug: currentHost } });
}
