import { getAPIUrl } from '@services/config/config'
import { RequestBodyWithAuthHeader, errorHandling } from '@services/utils/ts/requests'

/**
 * Permanently delete the authenticated user's account.
 *
 * Backend route: DELETE users/user_id/{user_id}
 * (note the unusual `user_id/` path segment — confirmed at
 * apps/api/src/routers/users.py). `get_current_user` + an RBAC "delete" check
 * enforce that the caller can only delete their own account.
 *
 * The backend cascade (services/users/users.py::delete_user_by_id) also removes
 * everything the user owns: organizations they are the SOLE admin of are deleted
 * outright (which cascades their courses, activities and all other content via
 * FK), the user is dropped from every other org, and every affected member's
 * session cache is invalidated.
 *
 * SECURITY: Requires authentication. The access_token is required.
 */
export async function deleteAccount(user_id: string | number, access_token: string) {
  const result = await fetch(
    `${getAPIUrl()}users/user_id/${user_id}`,
    RequestBodyWithAuthHeader('DELETE', null, null, access_token)
  )
  const res = await errorHandling(result)
  return res
}
