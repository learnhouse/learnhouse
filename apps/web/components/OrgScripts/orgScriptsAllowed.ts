import { isLocalhost, isSameHost, isSubdomainOf } from '@services/utils/ts/hostUtils'

// In multi tenancy the session cookie is shared by every org subdomain, so a
// script one org runs there could read the session of anyone visiting, from
// any org. Org scripts therefore only run on single-org installs or on the
// org's own custom domain, where cookies are host-only. A missing tenancy
// value counts as shared.
export function orgScriptsAllowedOn(
  hostname: string,
  tenancy: string | undefined,
  platformDomains: Array<string | undefined>,
): boolean {
  if (tenancy === 'single') return true
  if (isLocalhost(hostname)) return false
  return !platformDomains.some(
    (domain) => domain && (isSameHost(hostname, domain) || isSubdomainOf(hostname, domain)),
  )
}
