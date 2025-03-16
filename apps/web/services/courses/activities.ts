import { getAPIUrl } from '@services/config/config'
import {
  RequestBodyFormWithAuthHeader,
  RequestBodyWithAuthHeader,
} from '@services/utils/ts/requests'

export async function createActivity(
  data: any,
  chapter_id: any,
  org_id: any,
  access_token: string
) {
  data.content = {}
  // remove chapter_id from data
  delete data.chapterId

  const result = await fetch(
    `${getAPIUrl()}activities/?coursechapter_id=${chapter_id}&org_id=${org_id}`,
    RequestBodyWithAuthHeader('POST', data, null, access_token)
  )
  const res = await result.json()
  return res
}

export async function createFileActivity(
  file: File,
  type: string,
  data: any,
  chapter_id: any,
  access_token: string
) {
  // Send file thumbnail as form data
  const formData = new FormData()
  formData.append('chapter_id', chapter_id)

  let endpoint = ''

  if (type === 'video') {
    formData.append('name', data.name)
    formData.append('video_file', file)
    endpoint = `${getAPIUrl()}activities/video`
  } else if (type === 'documentpdf') {
    formData.append('pdf_file', file)
    formData.append('name', data.name)
    endpoint = `${getAPIUrl()}activities/documentpdf`
  } else {
    // Handle other file types here
  }

  const result: any = await fetch(
    endpoint,
    RequestBodyFormWithAuthHeader('POST', formData, null, access_token)
  )
  const res = await result.json()
  return res
}

export async function createExternalVideoActivity(
  data: any,
  activity: any,
  chapter_id: any,
  access_token: string
) {
  // add coursechapter_id to data
  data.chapter_id = chapter_id
  data.activity_id = activity.id

  const result = await fetch(
    `${getAPIUrl()}activities/external_video`,
    RequestBodyWithAuthHeader('POST', data, null, access_token)
  )
  const res = await result.json()
  return res
}

export async function getActivity(
  activity_uuid: any,
  next: any,
  access_token: string
) {
  const result = await fetch(
    `${getAPIUrl()}activities/${activity_uuid}`,
    RequestBodyWithAuthHeader('GET', null, next, access_token)
  )
  const res = await result.json()
  return res
}

export async function getActivityByID(
  activity_id: any,
  next: any,
  access_token: string
) {
  const result = await fetch(
    `${getAPIUrl()}activities/id/${activity_id}`,
    RequestBodyWithAuthHeader('GET', null, next, access_token)
  )
  const res = await result.json()
  return res
}

export async function deleteActivity(activity_uuid: any, access_token: string) {
  const result = await fetch(
    `${getAPIUrl()}activities/${activity_uuid}`,
    RequestBodyWithAuthHeader('DELETE', null, null, access_token)
  )
  const res = await result.json()
  return res
}

export async function getActivityWithAuthHeader(
  activity_uuid: any,
  next: any,
  access_token: string | null | undefined
) {
  const result = await fetch(
    `${getAPIUrl()}activities/activity_${activity_uuid}`,
    RequestBodyWithAuthHeader('GET', null, next, access_token || undefined)
  )
  const res = await result.json()
  return res
}

export async function updateActivity(
  data: any,
  activity_uuid: string,
  access_token: string
) {
  const result = await fetch(
    `${getAPIUrl()}activities/${activity_uuid}`,
    RequestBodyWithAuthHeader('PUT', data, null, access_token)
  )
  const res = await result.json()
  return res
}
