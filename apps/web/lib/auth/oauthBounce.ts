// Where the Google OAuth callback may bounce an authorization code to.
//
// The callback runs on the platform domain and forwards code+state to the
// origin named in the signed state. Signing only proves we issued the state,
// not that the origin is one of our org sites, so the target must also check
// out as a configured org host before the code leaves this page.

// Slug of an org's platform subdomain (`{slug}.{platformDomain}`, port
// included), or null for any other host. One label deep only.
export function platformOrgSlug(host: string, platformDomain: string): string | null {
  const h = host.toLowerCase()
  const domain = platformDomain.toLowerCase()
  if (!domain || !h.endsWith(`.${domain}`)) return null
  const label = h.slice(0, -(domain.length + 1))
  return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label) ? label : null
}

// API URL that answers 2xx only when `origin` is a configured org site: the
// subdomain of an existing org, or a verified custom domain whose live DNS
// still points at the platform.
export function oauthBounceCheckUrl(origin: URL, platformDomain: string, apiUrl: string): string {
  const slug = platformOrgSlug(origin.host, platformDomain)
  if (slug) return `${apiUrl}orgs/slug/${encodeURIComponent(slug)}`
  return `${apiUrl}orgs/resolve/domain/${encodeURIComponent(origin.hostname)}?for_auth=1`
}
