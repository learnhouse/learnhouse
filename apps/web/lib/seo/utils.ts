import { getUriWithOrg } from '@services/config/config'

/**
 * Sync canonical URL — safe for client components.
 *
 * Resolves via cookies on the client; falls through to a relative path on
 * the server. Server pages emitting `<meta canonical>`, og:url, or JSON-LD
 * URLs should use `getServerCanonicalUrl` from `@/lib/seo/utils.server`
 * instead — it reads tenancy from middleware-injected request headers and
 * works on cold loads where cookies aren't yet visible to RSC.
 */
export function getCanonicalUrl(orgslug: string, path: string): string {
  return getUriWithOrg(orgslug, path).replace(/\/+$/, '')
}

export function getOrgSeoConfig(org: any) {
  return org?.config?.config?.customization?.seo || org?.config?.config?.seo || {}
}

export function buildPageTitle(pageTitle: string, orgName: string, seoConfig: any): string {
  const suffix = seoConfig.default_meta_title_suffix
  if (suffix) return `${pageTitle}${suffix}`
  return `${pageTitle} — ${orgName}`
}

export function buildBreadcrumbJsonLd(items: { name: string; url: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  }
}
