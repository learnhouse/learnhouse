import { getAPIUrl } from '@services/config/config'
import {
  RequestBodyWithAuthHeader,
  getResponseMetadata,
  swrFetcher,
} from '@services/utils/ts/requests'

// Types
export interface CustomDomain {
  id: number
  domain_uuid: string
  domain: string
  org_id: number
  status: 'pending' | 'verified' | 'active' | 'failed'
  primary: boolean
  verification_token: string
  creation_date: string
  update_date: string
  verified_at: string | null
  last_check_at: string | null
  check_error: string | null
}

export interface CustomDomainCreate {
  domain: string
}

export interface CustomDomainVerificationInfo {
  domain: string
  status: string
  txt_record_host: string
  txt_record_value: string
  cname_record_host: string
  cname_record_value: string
  instructions: string
}

export interface CustomDomainResolveResponse {
  org_id: number
  org_slug: string
  org_uuid: string
}

/**
 * List all custom domains for an organization
 */
export async function listCustomDomains(
  orgId: number,
  accessToken: string
): Promise<CustomDomain[]> {
  const url = `${getAPIUrl()}orgs/${orgId}/domains`
  return swrFetcher(url, accessToken)
}

/**
 * Get a specific custom domain by UUID
 */
export async function getCustomDomain(
  orgId: number,
  domainUuid: string,
  accessToken: string
): Promise<CustomDomain> {
  const url = `${getAPIUrl()}orgs/${orgId}/domains/${domainUuid}`
  return swrFetcher(url, accessToken)
}

/**
 * Add a new custom domain
 */
export async function addCustomDomain(
  orgId: number,
  data: CustomDomainCreate,
  accessToken: string
) {
  const result = await fetch(
    `${getAPIUrl()}orgs/${orgId}/domains`,
    RequestBodyWithAuthHeader('POST', data, null, accessToken)
  )
  const res = await getResponseMetadata(result)
  return res
}

/**
 * Get verification info for a custom domain
 */
export async function getVerificationInfo(
  orgId: number,
  domainUuid: string,
  accessToken: string
): Promise<CustomDomainVerificationInfo> {
  const url = `${getAPIUrl()}orgs/${orgId}/domains/${domainUuid}/verification-info`
  return swrFetcher(url, accessToken)
}

/**
 * Verify a custom domain's DNS configuration
 */
export async function verifyCustomDomain(
  orgId: number,
  domainUuid: string,
  accessToken: string
) {
  const result = await fetch(
    `${getAPIUrl()}orgs/${orgId}/domains/${domainUuid}/verify`,
    RequestBodyWithAuthHeader('POST', null, null, accessToken)
  )
  const res = await getResponseMetadata(result)
  return res
}

/**
 * Delete a custom domain
 */
export async function deleteCustomDomain(
  orgId: number,
  domainUuid: string,
  accessToken: string
) {
  const result = await fetch(
    `${getAPIUrl()}orgs/${orgId}/domains/${domainUuid}`,
    RequestBodyWithAuthHeader('DELETE', null, null, accessToken)
  )
  const res = await getResponseMetadata(result)
  return res
}

/**
 * Resolve a custom domain to an organization (public endpoint)
 */
export async function resolveCustomDomain(
  domain: string
): Promise<CustomDomainResolveResponse | null> {
  try {
    const url = `${getAPIUrl()}orgs/resolve/domain/${encodeURIComponent(domain)}`
    const response = await fetch(url)
    if (!response.ok) {
      return null
    }
    return response.json()
  } catch {
    return null
  }
}
