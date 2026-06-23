import { getAPIUrl } from '@services/config/config'
import { getBackendUrl, getConfig } from '@services/config/config'
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

function getMediaUrl() {
  const mediaUrl = getConfig('NEXT_PUBLIC_LEARNHOUSE_MEDIA_URL')
  if (mediaUrl) {
    return mediaUrl
  } else {
    return getBackendUrl()
  }
}

/**
 * Build the direct media file URL for an uploaded media resource.
 * Mirrors the thumbnail-directory helpers in services/media/media.ts.
 */
export function getMediaFileDirectory(
  orgUuid: string,
  mediaUuid: string,
  fileId: string
) {
  let uri = `${getMediaUrl()}content/orgs/${orgUuid}/media/${mediaUuid}/${fileId}`
  return uri
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
