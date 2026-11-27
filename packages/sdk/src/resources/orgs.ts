import type { HttpCore } from '../core/http'
import type { BaseRequestOptions } from '../core/types'
import type { CustomDomainResolution, Organization } from '../models'

export interface ListMyOrgsOptions extends BaseRequestOptions {
  /** 1-based. Default 1. */
  page?: number
  /** Default 20. */
  limit?: number
}

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
    /**
     * Organizations the signed-in user belongs to.
     * `GET /api/v1/orgs/user/page/{page}/limit/{limit}`
     */
    listMine(options: ListMyOrgsOptions = {}): Promise<Organization[]> {
      const { page = 1, limit = 20, ...rest } = options
      return http.GET('/api/v1/orgs/user/page/{page}/limit/{limit}', {
        ...rest,
        params: { path: { page, limit } },
      })
    },
    /**
     * Join an organization as the signed-in user. Organizations that only
     * take invited members need `inviteCode`.
     * `POST /api/v1/orgs/join`
     */
    join(input: { orgId: number; userId: number; inviteCode?: string }, options?: BaseRequestOptions): Promise<unknown> {
      return http.POST('/api/v1/orgs/join', {
        ...options,
        body: { org_id: input.orgId, user_id: input.userId, invite_code: input.inviteCode ?? null },
      })
    },
    /** Leave an organization. `DELETE /api/v1/orgs/{org_id}/leave` */
    leave(orgId: number, options?: BaseRequestOptions): Promise<unknown> {
      return http.DELETE('/api/v1/orgs/{org_id}/leave', { ...options, params: { path: { org_id: orgId } } })
    },
    /**
     * Which organization a custom domain serves. Public.
     * `GET /api/v1/orgs/resolve/domain/{domain}`
     */
    resolveDomain(domain: string, options?: BaseRequestOptions): Promise<CustomDomainResolution> {
      return http.GET('/api/v1/orgs/resolve/domain/{domain}', { ...options, params: { path: { domain } } })
    },
  }
}

export type OrgsResource = ReturnType<typeof createOrgsResource>
