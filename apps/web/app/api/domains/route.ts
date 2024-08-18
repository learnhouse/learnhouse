import { getDataFromCustomDomainRegistry } from '@services/config/redis'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const cleanDomain = url.searchParams.get('cleanDomain')

  let orgslug = null

  const InfoFromCustomDomain =
    await getDataFromCustomDomainRegistry(cleanDomain)

  // If custom domain exists, override the orgslug from subdomain
  if (InfoFromCustomDomain) {
    orgslug = InfoFromCustomDomain.orgslug
    return NextResponse.json({
      orgslug: orgslug,
      domain: InfoFromCustomDomain.domain,
    })
  } else {
    return NextResponse.json({})
  }
}
