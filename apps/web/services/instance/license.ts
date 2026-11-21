import { getAPIUrl } from '@services/config/config'
import { RequestBodyWithAuthHeader, errorHandling } from '@services/utils/ts/requests'

export type LicenseNoticeSeverity = 'info' | 'warning' | 'critical'

export interface LicenseNotice {
  code: string
  severity: LicenseNoticeSeverity
  message?: string
  /** Epoch seconds, or null. */
  ends_at?: number | null
}

export type LicenseStatusValue = 'active' | 'grace' | 'inactive' | 'locked' | 'unlicensed'

/**
 * GET /instance/license. Admins on an EE instance get the full status;
 * everyone else gets `{ mode, status, locked }`. SaaS and OSS answer
 * `{ mode, status: 'unlicensed', locked: false, notices: [] }`.
 */
export interface InstanceLicense {
  mode: 'ee' | 'saas' | 'oss'
  status: LicenseStatusValue
  locked: boolean
  reason?: string
  grace_ends_at?: number | null
  license_expires_at?: number | null
  on_lapse?: 'degrade' | 'lock'
  notices?: LicenseNotice[]
}

export async function getInstanceLicense(token: string): Promise<InstanceLicense> {
  const res = await fetch(`${getAPIUrl()}instance/license`, RequestBodyWithAuthHeader('GET', null, null, token))
  return errorHandling(res)
}
