import { OrderPayload } from '@components/Dashboard/Course/EditCourseStructure/EditCourseStructure'
import { getAPIUrl } from '@services/config/config'
import {
  RequestBodyWithAuthHeader,
  errorHandling,
} from '@services/utils/ts/requests'

/*
 This file includes only POST, PUT, DELETE requests
 GET requests are called from the frontend using SWR (https://swr.vercel.app/)
*/

//TODO : depreciate this function
export async function getCourseChaptersMetadata(
  course_uuid: any,
  next: any,
  access_token: any
) {
  const result = await fetch(
    `${getAPIUrl()}chapters/meta/course_${course_uuid}`,
    RequestBodyWithAuthHeader('GET', null, next, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function updateChaptersMetadata(
  course_uuid: any,
  data: any,
  access_token: any
) {
  const result: any = await fetch(
    `${getAPIUrl()}chapters/course/course_${course_uuid}/order`,
    RequestBodyWithAuthHeader('PUT', data, null, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function updateChapter(
  coursechapter_id: any,
  data: any,
  access_token: any
) {
  const result: any = await fetch(
    `${getAPIUrl()}chapters/${coursechapter_id}`,
    RequestBodyWithAuthHeader('PUT', data, null, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function updateCourseOrderStructure(
  course_uuid: any,
  data: OrderPayload,
  access_token: any
) {
  const result: any = await fetch(
    `${getAPIUrl()}chapters/course/${course_uuid}/order`,
    RequestBodyWithAuthHeader('PUT', data, null, access_token)
  )
  const res = await errorHandling(result)
  return res
}

export async function createChapter(data: any, access_token: any) {
  const result: any = await fetch(
    `${getAPIUrl()}chapters/`,
    RequestBodyWithAuthHeader('POST', data, null, access_token)
  )
  const res = await errorHandling(result)

  return res
}

export async function deleteChapter(coursechapter_id: any, access_token: any) {
  const result: any = await fetch(
    `${getAPIUrl()}chapters/${coursechapter_id}`,
    RequestBodyWithAuthHeader('DELETE', null, null, access_token)
  )
  const res = await errorHandling(result)
  return res
}
