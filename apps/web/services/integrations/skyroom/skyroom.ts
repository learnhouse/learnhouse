import { getAPIUrl } from '@services/config/config'
import {
  RequestBodyWithAuthHeader,
  errorHandling,
} from '@services/utils/ts/requests'

/*
 Client for the Skyroom live-class integration.

 Backend endpoints (mounted under /api/v1/integrations/skyroom):
   GET    /status
   POST   /{org_id}/live-classes
   GET    /{org_id}/live-classes[?course_id=]
   GET    /{org_id}/live-classes/{liveclass_uuid}
   PUT    /{org_id}/live-classes/{liveclass_uuid}
   DELETE /{org_id}/live-classes/{liveclass_uuid}
   POST   /{org_id}/live-classes/{liveclass_uuid}/join-link

 GETs are exposed here as plain functions so the TanStack Query hooks in
 hooks/queries/useSkyroom.ts can use them as query fns; mutations are called
 imperatively from components.
*/

export interface SkyroomLiveClass {
  id: number
  liveclass_uuid: string
  org_id: number
  course_id: number | null
  activity_id: number | null
  skyroom_room_id: number
  room_name: string
  title: string
  room_url: string | null
  guest_login: boolean
  op_login_first: boolean
  max_users: number | null
  is_active: boolean
  created_by_user_id: number
  creation_date: string
  update_date: string
}

export interface SkyroomLiveClassCreate {
  room_name: string
  title: string
  course_id?: number | null
  activity_id?: number | null
  guest_login?: boolean
  op_login_first?: boolean
  max_users?: number | null
}

export interface SkyroomLiveClassUpdate {
  title?: string
  guest_login?: boolean
  op_login_first?: boolean
  max_users?: number | null
  is_active?: boolean
}

// access: 1 = normal user, 2 = presenter, 3 = operator
export interface SkyroomJoinLinkRequest {
  nickname: string
  user_id?: string
  access?: 1 | 2 | 3
  concurrent?: number
  language?: string
  ttl?: number
}

export async function getSkyroomStatus(
  access_token?: string
): Promise<{ enabled: boolean }> {
  const result = await fetch(
    `${getAPIUrl()}integrations/skyroom/status`,
    RequestBodyWithAuthHeader('GET', null, null, access_token)
  )
  return errorHandling(result)
}

export async function listLiveClasses(
  org_id: number,
  access_token?: string,
  course_id?: number
): Promise<SkyroomLiveClass[]> {
  const qs = course_id !== undefined ? `?course_id=${course_id}` : ''
  const result = await fetch(
    `${getAPIUrl()}integrations/skyroom/${org_id}/live-classes${qs}`,
    RequestBodyWithAuthHeader('GET', null, null, access_token)
  )
  return errorHandling(result)
}

export async function getLiveClass(
  org_id: number,
  liveclass_uuid: string,
  access_token?: string
): Promise<SkyroomLiveClass> {
  const result = await fetch(
    `${getAPIUrl()}integrations/skyroom/${org_id}/live-classes/${liveclass_uuid}`,
    RequestBodyWithAuthHeader('GET', null, null, access_token)
  )
  return errorHandling(result)
}

export async function createLiveClass(
  org_id: number,
  data: SkyroomLiveClassCreate,
  access_token?: string
): Promise<SkyroomLiveClass> {
  const result = await fetch(
    `${getAPIUrl()}integrations/skyroom/${org_id}/live-classes`,
    RequestBodyWithAuthHeader('POST', data, null, access_token)
  )
  return errorHandling(result)
}

export async function updateLiveClass(
  org_id: number,
  liveclass_uuid: string,
  data: SkyroomLiveClassUpdate,
  access_token?: string
): Promise<SkyroomLiveClass> {
  const result = await fetch(
    `${getAPIUrl()}integrations/skyroom/${org_id}/live-classes/${liveclass_uuid}`,
    RequestBodyWithAuthHeader('PUT', data, null, access_token)
  )
  return errorHandling(result)
}

export async function deleteLiveClass(
  org_id: number,
  liveclass_uuid: string,
  access_token?: string
): Promise<{ detail: string }> {
  const result = await fetch(
    `${getAPIUrl()}integrations/skyroom/${org_id}/live-classes/${liveclass_uuid}`,
    RequestBodyWithAuthHeader('DELETE', null, null, access_token)
  )
  return errorHandling(result)
}

export async function createJoinLink(
  org_id: number,
  liveclass_uuid: string,
  data: SkyroomJoinLinkRequest,
  access_token?: string
): Promise<{ url: string }> {
  const result = await fetch(
    `${getAPIUrl()}integrations/skyroom/${org_id}/live-classes/${liveclass_uuid}/join-link`,
    RequestBodyWithAuthHeader('POST', data, null, access_token)
  )
  return errorHandling(result)
}

// A room that exists on the Skyroom account (created inside or outside this
// platform), annotated with whether this org has already imported it.
export interface SkyroomRemoteRoom {
  skyroom_room_id: number
  name: string
  title: string
  status: number
  already_imported: boolean
  liveclass_uuid: string | null
}

export async function listRemoteRooms(
  org_id: number,
  access_token?: string
): Promise<SkyroomRemoteRoom[]> {
  const result = await fetch(
    `${getAPIUrl()}integrations/skyroom/${org_id}/remote-rooms`,
    RequestBodyWithAuthHeader('GET', null, null, access_token)
  )
  return errorHandling(result)
}

export async function importRemoteRoom(
  org_id: number,
  skyroom_room_id: number,
  data: { course_id?: number | null; activity_id?: number | null; title?: string } = {},
  access_token?: string
): Promise<SkyroomLiveClass> {
  const result = await fetch(
    `${getAPIUrl()}integrations/skyroom/${org_id}/remote-rooms/${skyroom_room_id}/import`,
    RequestBodyWithAuthHeader('POST', data, null, access_token)
  )
  return errorHandling(result)
}
