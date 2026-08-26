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

/** Update the signed-in learner while preserving all existing profile data. */
export async function updateUserProfile(
  user: any,
  profile: Record<string, any>,
  access_token: string
) {
  const payload = {
    username: user.username,
    first_name: user.first_name || '',
    last_name: user.last_name || '',
    email: user.email,
    avatar_image: user.avatar_image || '',
    bio: user.bio || '',
    details: user.details || {},
    profile,
  }

  const result = await fetch(
    `${getAPIUrl()}users/${user.id}`,
    RequestBodyWithAuthHeader('PUT', payload, null, access_token)
  )
  return await errorHandling(result)
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
