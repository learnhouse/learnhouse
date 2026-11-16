import { NextRequest } from 'next/server'
import { getOrganizationContextInfo } from '@services/organizations/orgs'
import { getOrgFaviconMediaDirectory, getOrgLogoMediaDirectory, getOrgSquareLogoMediaDirectory } from '@services/media/media'
import { buildManifest } from '@/lib/seo/manifest'
import { orgLanguage, clipDescription } from '@/lib/seo/meta'
import { orgThemeColors } from '@/lib/theme/orgTheme'
import { badRequest, notFoundText, orgslugFrom, publicResponse } from '@/lib/seo/route.server'

/** `/manifest.webmanifest` of the org on this host. */
export async function GET(request: NextRequest) {
  const orgslug = orgslugFrom(request)
  if (!orgslug) return badRequest('Missing org context')
  const org = await getOrganizationContextInfo(orgslug, { revalidate: 3600, tags: ['organizations'] }).catch(() => null)
  if (!org) return notFoundText()
  const general = org?.config?.config?.customization?.general || org?.config?.config?.general || {}
  const favicon = general.favicon_image
  const square = general.square_logo_image
  const icons = [
    square ? { src: getOrgSquareLogoMediaDirectory(org.org_uuid, square), purpose: 'any' } : null,
    favicon ? { src: getOrgFaviconMediaDirectory(org.org_uuid, favicon) } : null,
    org.logo_image ? { src: getOrgLogoMediaDirectory(org.org_uuid, org.logo_image) } : null,
  ].filter(Boolean) as { src: string; purpose?: string }[]
  let themeColor = '#ffffff'
  try {
    themeColor = orgThemeColors(org).brand || themeColor
  } catch {
    // Keep white when the theme can't be read.
  }
  const manifest = buildManifest({ name: org.name, description: clipDescription(org.description || '', 300), lang: orgLanguage(org), themeColor, icons })
  return publicResponse(JSON.stringify(manifest), 'application/manifest+json; charset=utf-8', { maxAge: 3600 })
}
