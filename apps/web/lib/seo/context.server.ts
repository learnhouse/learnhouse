import { cache } from 'react'
import { getOrganizationContextInfo } from '@services/organizations/orgs'
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
}

/** Org, its SEO config and absolute URL helpers, once per request. */
export const getSeoContext = cache(async (orgslug: string): Promise<SeoContext> => {
  const org = await getOrganizationContextInfo(orgslug, { revalidate: 120, tags: ['organizations'] })
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
