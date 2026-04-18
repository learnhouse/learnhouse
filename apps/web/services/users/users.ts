import { getAPIUrl } from '@services/config/config'
import {
  RequestBodyFormWithAuthHeader,
  RequestBodyWithAuthHeader,
  errorHandling,
  getResponseMetadata,
} from '@services/utils/ts/requests'

/**
 * Get user by ID.
 *
 * SECURITY: Requires authentication to prevent user enumeration attacks.
 * The access_token parameter is required.
 */
export async function getUser(user_id: string, access_token: string) {
  const result = await fetch(
    `${getAPIUrl()}users/id/${user_id}`,
    RequestBodyWithAuthHeader('GET', null, null, access_token)
  )
  const res = await errorHandling(result)
  return res
}

/**
 * Get minimal public profile by user ID. Anonymous-accessible.
 *
 * Returns only name, username, avatar — no email, details, or profile.
 */
export async function getUserPublicProfile(user_id: string) {
  const result = await fetch(
    `${getAPIUrl()}users/public/id/${user_id}`,
    RequestBodyWithAuthHeader('GET', null, null)
  )
  const res = await errorHandling(result)
  return res
}

/**
 * Get user by username.
 *
 * SECURITY: Requires authentication to prevent user enumeration attacks.
 * The access_token parameter is required.
 */
export async function getUserByUsername(username: string, access_token: string) {
  const result = await fetch(
    `${getAPIUrl()}users/username/${username}`,
    RequestBodyWithAuthHeader('GET', null, null, access_token)
  )
  const res = await errorHandling(result)
  return res
}

/**
 * Get courses created/contributed by a user.
 *
 * SECURITY: Requires authentication.
 * The access_token parameter is required.
 */
export async function getCoursesByUser(user_id: string, access_token: string) {
  const result = await fetch(
    `${getAPIUrl()}users/${user_id}/courses`,
    RequestBodyWithAuthHeader('GET', null, null, access_token)
  )
  const res = await getResponseMetadata(result)
  return res
}
export async function updateUserAvatar(
  user_uuid: any,
  avatar_file: any,
  access_token: any
) {
  const formData = new FormData()
  formData.append('avatar_file', avatar_file)
  const result: any = await fetch(
    `${getAPIUrl()}users/update_avatar/${user_uuid}`,
    RequestBodyFormWithAuthHeader('PUT', formData, null, access_token)
  )
  const res = await getResponseMetadata(result)
  return res
}
