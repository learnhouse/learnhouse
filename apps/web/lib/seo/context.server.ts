import { cache } from 'react'
import { notFound } from 'next/navigation'
import { getOrganizationContextInfo } from '@services/organizations/orgs'
import { isOrgNotFound } from '@/lib/org.server'
import { getOrgLogoMediaDirectory, getOrgOgImageMediaDirectory, getOrgThumbnailMediaDirectory } from '@services/media/media'
import { getServerCanonicalUrl } from './utils.server'
import { getOrgSeoConfig } from './utils'
import { orgLanguage, type OrgSeoConfig } from './meta'

export type SeoContext = {
  org: any
  seo: OrgSeoConfig
  /** Absolute home URL without a trailing slash. */
  base: string
  lang: string
  orgRef: { name: string; url: string; logo?: string; type?: string }
  /** The org's default sharing image, when set (absolute). */
  defaultImage?: string
  url: (path: string) => Promise<string>
  /** The org lookup failed for a transient reason (API down, timeout): no org
   *  data, so metadata degrades and structured data is skipped. */
  degraded?: boolean
}

/** Org, its SEO config and absolute URL helpers, once per request. */
export const getSeoContext = cache(async (orgslug: string): Promise<SeoContext> => {
  let org: any
  try {
    org = await getOrganizationContextInfo(orgslug, { revalidate: 120, tags: ['organizations'] })
  } catch (error) {
    // Unknown slug: the 404 page, not a server error.
    if (isOrgNotFound(error)) notFound()
    // API unreachable: metadata must degrade, never break the page.
    const base = await getServerCanonicalUrl(orgslug, '/')
    return {
      org: null,
      seo: {} as OrgSeoConfig,
      base,
      lang: orgLanguage(null),
      orgRef: { name: '', url: base },
      url: (path: string) => getServerCanonicalUrl(orgslug, path),
      degraded: true,
    }
  }
  const seo = getOrgSeoConfig(org) as OrgSeoConfig
  const base = await getServerCanonicalUrl(orgslug, '/')
  const logo = org?.logo_image ? getOrgLogoMediaDirectory(org.org_uuid, org.logo_image) : undefined
  const defaultImage = seo.default_og_image
    ? getOrgOgImageMediaDirectory(org.org_uuid, seo.default_og_image)
    : org?.thumbnail_image
      ? getOrgThumbnailMediaDirectory(org.org_uuid, org.thumbnail_image)
      : undefined
  return {
    org,
    seo,
    base,
    lang: orgLanguage(org),
    orgRef: { name: org?.name || '', url: base, logo, type: seo.organization_type || undefined },
    defaultImage,
    url: (path: string) => getServerCanonicalUrl(orgslug, path),
  }
})
