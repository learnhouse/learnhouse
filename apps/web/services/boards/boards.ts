import { getAPIUrl } from '@services/config/config'
import {
  RequestBodyWithAuthHeader,
  errorHandling,
} from '@services/utils/ts/requests'

export async function createBoard(
  orgId: number,
  data: { name: string; description?: string; thumbnail_image?: string },
  access_token: string
) {
  const result = await fetch(
    `${getAPIUrl()}boards/?org_id=${orgId}`,
    RequestBodyWithAuthHeader('POST', data, null, access_token)
  )
  return errorHandling(result)
}

export async function getBoards(orgId: number, access_token: string) {
  const result = await fetch(
    `${getAPIUrl()}boards/org/${orgId}`,
    RequestBodyWithAuthHeader('GET', null, null, access_token)
  )
  return errorHandling(result)
}

export async function getBoard(boardUuid: string, access_token: string) {
  const result = await fetch(
    `${getAPIUrl()}boards/${boardUuid}`,
    RequestBodyWithAuthHeader('GET', null, null, access_token)
  )
  return errorHandling(result)
}

export async function updateBoard(
  boardUuid: string,
  data: { name?: string; description?: string; thumbnail_image?: string; public?: boolean },
  access_token: string
) {
  const result = await fetch(
    `${getAPIUrl()}boards/${boardUuid}`,
    RequestBodyWithAuthHeader('PUT', data, null, access_token)
  )
  return errorHandling(result)
}

export async function deleteBoard(boardUuid: string, access_token: string) {
  const result = await fetch(
    `${getAPIUrl()}boards/${boardUuid}`,
    RequestBodyWithAuthHeader('DELETE', null, null, access_token)
  )
  return errorHandling(result)
}

export async function addBoardMember(
  boardUuid: string,
  data: { user_id: number; role?: string },
  access_token: string
) {
  const result = await fetch(
    `${getAPIUrl()}boards/${boardUuid}/members`,
    RequestBodyWithAuthHeader('POST', data, null, access_token)
  )
  return errorHandling(result)
}

export async function addBoardMembersBatch(
  boardUuid: string,
  members: { user_id: number; role: string }[],
  access_token: string
) {
  const result = await fetch(
    `${getAPIUrl()}boards/${boardUuid}/members/batch`,
    RequestBodyWithAuthHeader('POST', { members }, null, access_token)
  )
  return errorHandling(result)
}

export async function removeBoardMember(
  boardUuid: string,
  userId: number,
  access_token: string
) {
  const result = await fetch(
    `${getAPIUrl()}boards/${boardUuid}/members/${userId}`,
    RequestBodyWithAuthHeader('DELETE', null, null, access_token)
  )
  return errorHandling(result)
}

export async function getBoardMembers(
  boardUuid: string,
  access_token: string
) {
  const result = await fetch(
    `${getAPIUrl()}boards/${boardUuid}/members`,
    RequestBodyWithAuthHeader('GET', null, null, access_token)
  )
  return errorHandling(result)
}

export async function updateBoardThumbnail(
  boardUuid: string,
  file: File,
  access_token: string
) {
  const formData = new FormData()
  formData.append('thumbnail', file)
  const result = await fetch(
    `${getAPIUrl()}boards/${boardUuid}/thumbnail`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${access_token}`,
      },
      body: formData,
    }
  )
  return errorHandling(result)
}
