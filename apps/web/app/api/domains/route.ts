import { getDataFromCustomDomainRegistry } from '@services/config/redis';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const cleanDomain = url.searchParams.get('cleanDomain');

  // Return early if cleanDomain is not provided
  if (!cleanDomain) {
    return NextResponse.json({});
  }

  // Retrieve information from the custom domain registry
  const customDomainInfo = await getDataFromCustomDomainRegistry(cleanDomain);

  // If custom domain exists, return the orgslug and domain; otherwise, return an empty object
  if (customDomainInfo) {
    const { orgslug, domain } = customDomainInfo;
    return NextResponse.json({ orgslug, domain });
  }

  return NextResponse.json({});
}
