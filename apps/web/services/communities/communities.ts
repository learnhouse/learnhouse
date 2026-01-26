import { getAPIUrl } from '@services/config/config'
import {
  RequestBodyWithAuthHeader,
  RequestBodyFormWithAuthHeader,
  errorHandling,
  getResponseMetadata,
} from '@services/utils/ts/requests'

export interface Community {
  id: number
  org_id: number
  course_id: number | null
  community_uuid: string
  name: string
  description: string | null
  public: boolean
  moderation_words: string[]
  thumbnail_image: string | null
  creation_date: string
  update_date: string
}

export interface CommunityCreate {
  name: string
  description?: string | null
  public?: boolean
  course_id?: number | null
}

export interface CommunityUpdate {
  name?: string
  description?: string | null
  public?: boolean
  moderation_words?: string[]
}

export interface CommunityRights {
  community_uuid: string
  user_id: number
  is_anonymous: boolean
  permissions: {
    read: boolean
    create: boolean
    update: boolean
    delete: boolean
    create_discussion: boolean
  }
  ownership: {
    is_admin: boolean
    is_maintainer_role: boolean
  }
}

export async function getCommunities(
  org_id: number,
  page: number = 1,
  limit: number = 10,
  next: any,
  access_token?: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}communities/org/${org_id}/page/${page}/limit/${limit}`,
    RequestBodyWithAuthHeader('GET', null, next, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function getCommunity(
  community_uuid: string,
  next: any,
  access_token?: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}communities/${community_uuid}`,
    RequestBodyWithAuthHeader('GET', null, next, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function getCommunityByCourse(
  course_uuid: string,
  next: any,
  access_token?: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}communities/course/${course_uuid}`,
    RequestBodyWithAuthHeader('GET', null, next, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function createCommunity(
  org_id: number,
  data: CommunityCreate,
  access_token: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}communities/?org_id=${org_id}`,
    RequestBodyWithAuthHeader('POST', data, null, access_token)
  )
  const res = await getResponseMetadata(result)
  return res
}

export async function updateCommunity(
  community_uuid: string,
  data: CommunityUpdate,
  access_token: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}communities/${community_uuid}`,
    RequestBodyWithAuthHeader('PUT', data, null, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function deleteCommunity(
  community_uuid: string,
  access_token: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}communities/${community_uuid}`,
    RequestBodyWithAuthHeader('DELETE', null, null, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function linkCommunityToCourse(
  community_uuid: string,
  course_uuid: string,
  access_token: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}communities/${community_uuid}/link-course/${course_uuid}`,
    RequestBodyWithAuthHeader('PUT', null, null, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function unlinkCommunityFromCourse(
  community_uuid: string,
  access_token: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}communities/${community_uuid}/unlink-course`,
    RequestBodyWithAuthHeader('DELETE', null, null, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function getCommunityRights(
  community_uuid: string,
  access_token?: string
): Promise<CommunityRights> {
  const result: any = await fetch(
    `${getAPIUrl()}communities/${community_uuid}/rights`,
    RequestBodyWithAuthHeader('GET', null, null, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function updateCommunityThumbnail(
  community_uuid: string,
  formData: FormData,
  access_token: string
) {
  const result: any = await fetch(
    `${getAPIUrl()}communities/${community_uuid}/thumbnail`,
    RequestBodyFormWithAuthHeader('PUT', formData, null, access_token)
  )
  const res = await getResponseMetadata(result)
  return res
}
