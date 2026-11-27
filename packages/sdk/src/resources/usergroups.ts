import type { HttpCore } from '../core/http'
import type { BaseRequestOptions } from '../core/types'
import type { UserGroupJoinResult, UserGroupMembership } from '../models'

/** The signed-in user's side of user groups (Standard plan or higher on Cloud). */
export function createUserGroupsResource(http: HttpCore) {
  return {
    /** Groups the user belongs to and groups they manage. `GET /api/v1/usergroups/org/{org_id}/mine` */
    listMine(orgId: number, options?: BaseRequestOptions): Promise<UserGroupMembership> {
      return http.GET('/api/v1/usergroups/org/{org_id}/mine', {
        ...options,
        params: { path: { org_id: orgId } },
      }) as unknown as Promise<UserGroupMembership>
    },
    /** Join a group with a join code a manager shared. `POST /api/v1/usergroups/join` */
    join(code: string, options?: BaseRequestOptions): Promise<UserGroupJoinResult> {
      return http.POST('/api/v1/usergroups/join', { ...options, body: { code } }) as unknown as Promise<UserGroupJoinResult>
    },
  }
}

export type UserGroupsResource = ReturnType<typeof createUserGroupsResource>
