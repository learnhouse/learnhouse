import 'server-only'
import { notFound } from 'next/navigation'
import { getOrganizationContextInfo } from '@services/organizations/orgs'

/** True when an API error means the org slug doesn't exist. */
export function isOrgNotFound(error: any): boolean {
  return error?.status === 404
}

/**
 * The org for a slug, or the 404 page when the slug is unknown. Any other
 * failure (API down, timeout) is rethrown: it is not the visitor's fault and
 * must not be reported as a missing page.
 */
export async function getOrgOr404(orgslug: string, access_token?: string) {
  try {
    return await getOrganizationContextInfo(orgslug, null, access_token)
  } catch (error) {
    if (isOrgNotFound(error)) notFound()
    throw error
  }
}

/**
 * 404 for an unknown org slug; transient lookup failures are swallowed so the
 * client can still render (and retry) the page.
 */
export async function assertOrgExists(orgslug: string): Promise<void> {
  try {
    await getOrganizationContextInfo(orgslug, null)
  } catch (error) {
    if (isOrgNotFound(error)) notFound()
  }
}
