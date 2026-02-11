import { getUriWithOrg } from '@services/config/config'

export function getCanonicalUrl(orgslug: string, path: string): string {
  return getUriWithOrg(orgslug, path).replace(/\/+$/, '')
}

export function getOrgSeoConfig(org: any) {
  return org?.config?.config?.seo || {}
}

export function buildPageTitle(pageTitle: string, orgName: string, seoConfig: any): string {
  const suffix = seoConfig.default_meta_title_suffix
  if (suffix) return `${pageTitle}${suffix}`
  return `${pageTitle} — ${orgName}`
}
