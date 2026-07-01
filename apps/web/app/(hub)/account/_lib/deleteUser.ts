import { getAPIUrl } from '@services/config/config'
import { RequestBodyWithAuthHeader, errorHandling } from '@services/utils/ts/requests'

/**
 * Permanently delete the authenticated user's account.
 *
 * Backend route: DELETE users/user_id/{user_id}
 * (note the unusual `user_id/` path segment — confirmed at
 * apps/api/src/routers/users.py). `get_current_user` enforces that the
 * caller can only delete their own account.
 *
 * SECURITY: Requires authentication. The access_token is required.
 */
export async function deleteUser(user_id: string | number, access_token: string) {
  const result = await fetch(
    `${getAPIUrl()}users/user_id/${user_id}`,
    RequestBodyWithAuthHeader('DELETE', null, null, access_token)
  )
  const res = await errorHandling(result)
  return res
}
