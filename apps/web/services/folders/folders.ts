import { getAPIUrl } from '../config/config'
import {
  RequestBodyWithAuthHeader,
  RequestBodyFormWithAuthHeader,
  errorHandling,
} from '@services/utils/ts/requests'

/*
 This file includes only POST, PUT, DELETE requests
 GET requests are called from the frontend using SWR (https://swr.vercel.app/)
 (GET helpers are also exported here for server-side fetching)
*/

/**
 * Strip the `folder_` prefix from a folder uuid.
 * e.g. removeFolderPrefix('folder_abc') => 'abc'
 */
export function removeFolderPrefix(folder_uuid: string) {
  return folder_uuid.replace('folder_', '')
}

export async function getOrgFolders(
  org_id: any,
  access_token?: string,
  next?: any,
  parentFolderUuid?: string
) {
  const query = parentFolderUuid
    ? `?parent_folder_uuid=${parentFolderUuid}`
    : ''
  const result: any = await fetch(
    `${getAPIUrl()}folders/org/${org_id}/page/1/limit/100${query}`,
    RequestBodyWithAuthHeader('GET', null, next, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function searchLibrary(
  org_id: any,
  q: string,
  access_token?: string,
  next?: any
) {
  const result: any = await fetch(
    `${getAPIUrl()}folders/org/${org_id}/search?q=${encodeURIComponent(q)}`,
    RequestBodyWithAuthHeader('GET', null, next, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function getFolderById(
  folder_uuid: string,
  access_token?: string,
  next?: any
) {
  const result: any = await fetch(
    `${getAPIUrl()}folders/${folder_uuid}`,
    RequestBodyWithAuthHeader('GET', null, next, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function createFolder(folder: any, access_token: any) {
  const result: any = await fetch(
    `${getAPIUrl()}folders/`,
    RequestBodyWithAuthHeader('POST', folder, null, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function updateFolder(
  folder_uuid: string,
  body: any,
  access_token: any
) {
  const result: any = await fetch(
    `${getAPIUrl()}folders/${folder_uuid}`,
    RequestBodyWithAuthHeader('PUT', body, null, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function updateFolderThumbnail(
  folder_uuid: string,
  file: File,
  access_token: any
) {
  const formData = new FormData()
  formData.append('thumbnail', file)
  const result: any = await fetch(
    `${getAPIUrl()}folders/${folder_uuid}/thumbnail`,
    RequestBodyFormWithAuthHeader('PUT', formData, null, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function deleteFolder(folder_uuid: string, access_token: any) {
  const result: any = await fetch(
    `${getAPIUrl()}folders/${folder_uuid}`,
    RequestBodyWithAuthHeader('DELETE', null, null, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function addFolderContent(
  folder_uuid: string,
  resource_uuid: string,
  access_token: any,
  position: number = 0
) {
  const result: any = await fetch(
    `${getAPIUrl()}folders/${folder_uuid}/content?resource_uuid=${resource_uuid}&position=${position}`,
    RequestBodyWithAuthHeader('POST', null, null, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function removeFolderContent(
  folder_uuid: string,
  resource_uuid: string,
  access_token: any
) {
  const result: any = await fetch(
    `${getAPIUrl()}folders/${folder_uuid}/content?resource_uuid=${resource_uuid}`,
    RequestBodyWithAuthHeader('DELETE', null, null, access_token)
  )
  const res = await errorHandling(result)
  return res
}

// ── Library root (Drive-like): content placed directly at the org root ──

export async function getOrgRootItems(
  org_id: any,
  access_token?: string,
  next?: any
) {
  const result: any = await fetch(
    `${getAPIUrl()}folders/org/${org_id}/root`,
    RequestBodyWithAuthHeader('GET', null, next, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function addOrgRootContent(
  org_id: any,
  resource_uuid: string,
  access_token: any,
  position: number = 0
) {
  const result: any = await fetch(
    `${getAPIUrl()}folders/org/${org_id}/content?resource_uuid=${resource_uuid}&position=${position}`,
    RequestBodyWithAuthHeader('POST', null, null, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function removeOrgRootContent(
  org_id: any,
  resource_uuid: string,
  access_token: any
) {
  const result: any = await fetch(
    `${getAPIUrl()}folders/org/${org_id}/content?resource_uuid=${resource_uuid}`,
    RequestBodyWithAuthHeader('DELETE', null, null, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function moveFolderContent(
  folder_uuid: string,
  target_folder_uuid: string,
  resource_uuid: string,
  access_token: any
) {
  const result: any = await fetch(
    `${getAPIUrl()}folders/${folder_uuid}/content/move?target_folder_uuid=${target_folder_uuid}&resource_uuid=${resource_uuid}`,
    RequestBodyWithAuthHeader('POST', null, null, access_token)
  )
  const res = await errorHandling(result)
  return res
}
