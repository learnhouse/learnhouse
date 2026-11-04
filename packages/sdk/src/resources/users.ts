import type { HttpCore } from '../core/http'
import type { BaseRequestOptions } from '../core/types'
import type { PublicUserProfile, UserSession } from '../models'

export function createUsersResource(http: HttpCore) {
  return {
    /**
     * The current user with org memberships and roles (what the web app loads
     * after sign-in). Fails for anonymous callers.
     * `GET /api/v1/users/session`
     */
    session(options?: BaseRequestOptions): Promise<UserSession> {
      return http.GET('/api/v1/users/session', options)
    },
    /** `GET /api/v1/users/uuid/{user_uuid}` */
    getByUuid(userUuid: string, options?: BaseRequestOptions): Promise<PublicUserProfile> {
      return http.GET('/api/v1/users/uuid/{user_uuid}', {
        ...options,
        params: { path: { user_uuid: userUuid } },
      })
    },
  }
}

export type UsersResource = ReturnType<typeof createUsersResource>
