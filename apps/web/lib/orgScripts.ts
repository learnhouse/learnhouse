import 'server-only'
import { headers } from 'next/headers'

// Org scripts are JavaScript written by an org's admins and run on the org's
// pages. On a multi-tenant deployment every platform subdomain shares one
// session cookie (Domain=.{top_domain}), so a script on any org's subdomain
// could act as each visitor in every org they belong to. Scripts therefore only
// run where the session can't reach other orgs: a single-tenant install, or an
// org's custom domain, where cookies are host-only and sessions are bound to
// that org.
//
// The x-lh-* headers are set by the proxy from its own tenant resolution, and
// incoming copies are stripped, so they can't be supplied by the client.
// Without them the answer is no, and so is it when the proxy couldn't reach the
// backend and only guessed the tenancy.
export function orgScriptsAllowed(h: Headers): boolean {
  if (h.get('x-lh-instance-fallback')) return false
  const tenancy = h.get('x-lh-tenancy')
  if (tenancy === 'single') return true
  if (tenancy === 'multi') return Boolean(h.get('x-lh-custom-domain'))
  return false
}

export async function orgScriptsAllowedOnRequest(): Promise<boolean> {
  return orgScriptsAllowed(await headers())
}
