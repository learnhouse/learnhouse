import NextAuth from 'next-auth';
import { nextAuthOptions } from 'app/auth/options';
import { NextApiRequest, NextApiResponse } from 'next';
import { NextRequest, NextResponse } from 'next/server';

async function handler(req: NextRequest, res: NextResponse) {
  // Extract cookies from the request
  const cookies = req.cookies;

  // Pass the cookies or other request-specific data to nextAuthOptions
  const options = nextAuthOptions(cookies);

  // Create and return the NextAuth handler with the dynamically generated options
  return await NextAuth(options)(req, res);
}

export { handler as GET, handler as POST };