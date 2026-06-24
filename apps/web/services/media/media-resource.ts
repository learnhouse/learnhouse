import { getAPIUrl } from '@services/config/config'
import {
  RequestBodyFormWithAuthHeader,
  RequestBodyWithAuthHeader,
  errorHandling,
} from '@services/utils/ts/requests'

/*
 This file includes only POST, PUT, DELETE requests for the Media resource.
 GET requests are called from the frontend using SWR (https://swr.vercel.app/)
 (a GET helper is also exported for server-side fetching)

 NOTE: services/media/media.ts holds the thumbnail-directory helpers and must
 not be overwritten. This file holds the Media resource API service.
*/

/**
 * Build the media file URL for an uploaded media resource.
 *
 * SECURITY: this now points at the authenticated, access-checked API endpoint
 * (GET /api/v1/media/{uuid}/file) — NOT the public storage/CDN URL. The browser
 * sends the session cookie (same-origin), so private-folder files are only
 * served to authorized users, and the storage path is never exposed. The
 * orgUuid/fileId params are kept for signature stability but unused.
 */
export function getMediaFileDirectory(
  _orgUuid?: string,
  mediaUuid?: string,
  _fileId?: string
) {
  // _orgUuid/_fileId are accepted for backward-compatible call sites but no
  // longer used: media is served via the authed endpoint keyed by media_uuid.
  return `${getAPIUrl()}media/${mediaUuid}/file`
}

/**
 * Create a fresh, random share link for a media file. Each call mints a NEW
 * token (the URL is unique every time) and is revocable server-side. The link
 * still enforces the recipient's access — it is not a public capability.
 */
export async function createMediaShareLink(media_uuid: string, access_token: string) {
  const result = await fetch(
    `${getAPIUrl()}media/${media_uuid}/share-link`,
    RequestBodyWithAuthHeader('POST', {}, null, access_token)
  )
  return errorHandling(result) // { token }
}

/** Build the shareable, token-based file URL (random + unique every time). */
export function getMediaShareFileUrl(token: string) {
  return `${getAPIUrl()}media/shared/${token}/file`
}

export async function getOrgMedia(
  org_id: any,
  access_token?: string,
  next?: any
) {
  const result: any = await fetch(
    `${getAPIUrl()}media/org/${org_id}/page/1/limit/100`,
    RequestBodyWithAuthHeader('GET', null, next, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function getMediaById(
  media_uuid: string,
  access_token?: string,
  next?: any
) {
  const result: any = await fetch(
    `${getAPIUrl()}media/${media_uuid}`,
    RequestBodyWithAuthHeader('GET', null, next, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function createMedia(formData: FormData, access_token: any) {
  const result: any = await fetch(
    `${getAPIUrl()}media/`,
    RequestBodyFormWithAuthHeader('POST', formData, null, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function updateMedia(
  media_uuid: string,
  body: any,
  access_token: any
) {
  const result: any = await fetch(
    `${getAPIUrl()}media/${media_uuid}`,
    RequestBodyWithAuthHeader('PUT', body, null, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function deleteMedia(media_uuid: string, access_token: any) {
  const result: any = await fetch(
    `${getAPIUrl()}media/${media_uuid}`,
    RequestBodyWithAuthHeader('DELETE', null, null, access_token)
  )
  const res = await errorHandling(result)
  return res
}
