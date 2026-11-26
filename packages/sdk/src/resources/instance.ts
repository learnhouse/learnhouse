import type { HttpCore } from '../core/http'
import type { BaseRequestOptions } from '../core/types'

/** `instance.info()`: how the instance is deployed. Public. */
export interface InstanceInfo {
  /** `single`: one organization; `multi`: one per subdomain. */
  tenancy: 'single' | 'multi' | (string & {})
  default_org_slug: string
  frontend_domain: string
  top_domain: string
  /** `oss`, `ee` or `saas`. */
  mode: string
  license_locked: boolean
  /** @deprecated Use `tenancy`. */
  multi_org_enabled: boolean
}

export function createInstanceResource(http: HttpCore) {
  return {
    /** `GET /api/v1/instance/info` */
    info(options?: BaseRequestOptions): Promise<InstanceInfo> {
      return http.GET('/api/v1/instance/info', { ...options }) as Promise<InstanceInfo>
    },
  }
}

export type InstanceResource = ReturnType<typeof createInstanceResource>
