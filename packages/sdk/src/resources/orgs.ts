import type { HttpCore } from '../core/http'
import type { BaseRequestOptions } from '../core/types'
import type { Organization } from '../models'

export function createOrgsResource(http: HttpCore) {
  return {
    /** `GET /api/v1/orgs/slug/{org_slug}` */
    get(orgSlug: string, options?: BaseRequestOptions): Promise<Organization> {
      return http.GET('/api/v1/orgs/slug/{org_slug}', { ...options, params: { path: { org_slug: orgSlug } } })
    },
    /** `GET /api/v1/orgs/uuid/{org_uuid}` */
    getByUuid(orgUuid: string, options?: BaseRequestOptions): Promise<Organization> {
      return http.GET('/api/v1/orgs/uuid/{org_uuid}', { ...options, params: { path: { org_uuid: orgUuid } } })
    },
  }
}

export type OrgsResource = ReturnType<typeof createOrgsResource>
